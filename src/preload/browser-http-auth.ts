import { ipcRenderer } from 'electron'
import {
  BROWSER_HTTP_AUTH_RESPONSE_CHANNEL,
  type BrowserHttpAuthRendererResponse,
} from '../shared/ipc/browser-http-auth'

window.addEventListener('DOMContentLoaded', () => {
  const requestId =
    document.querySelector<HTMLMetaElement>('meta[name="cclink-http-auth-request-id"]')?.content ??
    ''
  const form = document.querySelector<HTMLFormElement>('#auth-form')
  const username = document.querySelector<HTMLInputElement>('#username')
  const password = document.querySelector<HTMLInputElement>('#password')
  const insecureConfirmation = document.querySelector<HTMLInputElement>('#allow-insecure')
  const submit = document.querySelector<HTMLButtonElement>('#submit')
  const cancel = document.querySelector<HTMLButtonElement>('#cancel')
  const status = document.querySelector<HTMLElement>('#status')
  if (!requestId || !form || !username || !password || !submit || !cancel || !status) return

  let settled = false
  const updateSubmitState = (): void => {
    submit.disabled = settled || Boolean(insecureConfirmation && !insecureConfirmation.checked)
  }
  const respond = async (response: BrowserHttpAuthRendererResponse): Promise<void> => {
    if (settled) return
    settled = true
    updateSubmitState()
    username.disabled = true
    password.disabled = true
    cancel.disabled = true
    status.textContent = response.action === 'submit' ? '正在验证凭证…' : '正在取消…'
    try {
      await ipcRenderer.invoke(BROWSER_HTTP_AUTH_RESPONSE_CHANNEL, response)
    } catch {
      settled = false
      username.disabled = false
      password.disabled = false
      cancel.disabled = false
      status.textContent = '无法提交，请关闭窗口后重试。'
      updateSubmitState()
    }
  }

  insecureConfirmation?.addEventListener('change', updateSubmitState)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!username.value || submit.disabled) return
    void respond({
      action: 'submit',
      requestId,
      username: username.value,
      password: password.value,
      allowInsecure: insecureConfirmation?.checked ?? false,
    })
  })
  cancel.addEventListener('click', () => {
    void respond({ action: 'cancel', requestId })
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void respond({ action: 'cancel', requestId })
  })
  updateSubmitState()
  if (insecureConfirmation) cancel.focus()
  else username.focus()
})
