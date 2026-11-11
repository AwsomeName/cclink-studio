import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PROVIDER_PRESETS,
  getPresetBaseUrl,
  type AppSettings,
  type Provider,
} from '@shared/ipc/settings'
import { SUPPORTED_AGENT_PROVIDERS } from '@shared/settings-constants'
import type { CredentialMetadata, CredentialServiceStatus } from '@shared/ipc/credentials'
import type { ClaudeRuntimeSelection } from '@shared/claude-runtime'
import { CODEX_DIAGNOSTIC_LABELS } from '@shared/codex-runtime'
import { useAgentStore } from '../../stores/agent-store'
import { useUIStore } from '../../stores/ui-store'
import { captureActiveWorkspaceTarget } from '../../stores/workspace-store'
import { createConversationRuntimeForWorkspace } from '../../features/agent-conversations/view-model'
import { focusAgentComposer } from '../../features/markdown/markdown-navigation'
import { IconDatabase, IconRobot } from '../common/Icons'

const SERVICES = [
  {
    id: 'claude',
    name: 'Claude Code',
    group: 'Agent 模型',
    credential: 'agent:default',
    description: '通过 API Key 连接模型服务，供 Claude Code 会话使用。',
    usage: '用于 Claude Code 会话。保存不会切换默认 Codex；新建会话时选择 Claude Code 使用。',
  },
  {
    id: 'meshy',
    name: 'Meshy',
    group: '图像、3D 与素材',
    credential: 'extension:meshy:default',
    description: '连接 Meshy，用于生成 3D 资产。',
    usage: '用于 Meshy 3D 生成，与 Agent 模型密钥相互独立。',
  },
  {
    id: 'jimeng',
    name: '即梦',
    group: '图像、3D 与素材',
    credential: 'extension:jimeng:default',
    description: '填写火山引擎 Access Key ID 和 Secret Access Key。',
    usage: '用于即梦图像生成；两个字段需一起保存。',
  },
  {
    id: 'pexels',
    name: 'Pexels',
    group: '图像、3D 与素材',
    credential: 'extension:pexels:default',
    description: '搜索带来源信息的图片和视频。',
    usage: '用于素材搜索，不用于生成模型。',
  },
  {
    id: 'github',
    name: 'GitHub',
    group: '开发服务',
    credential: 'git:github',
    description: '配置 GitHub 账号和 Token，供 Git 备份使用。',
    usage: '账号认证通过不代表具有目标仓库写入权限；仓库选择仍在 Git 备份中完成。',
  },
  {
    id: 'datasource',
    name: '数据源',
    group: '开发服务',
    credential: '',
    description: '每个数据源有独立的地址和认证方式。',
    usage: '在数据源连接中编辑用户名、密码或 Token，凭证由本机统一管理。',
  },
] as const
export type ConnectionServiceId = (typeof SERVICES)[number]['id']

export function connectionServiceFromSection(section?: string): ConnectionServiceId {
  if (section === 'image-generation') return 'meshy'
  const service = section?.split(':')[1]
  return SERVICES.find((item) => item.id === service)?.id ?? 'claude'
}

function connectionIdentity(
  settings: AppSettings,
  metadata: CredentialMetadata[],
  id: ConnectionServiceId,
): string {
  const credential = SERVICES.find((item) => item.id === id)?.credential
  return JSON.stringify([
    metadata.find((item) => item.id === credential)?.updatedAt,
    id === 'claude'
      ? [
          settings.provider,
          settings.apiBaseUrl,
          settings.modelName,
          settings.claudeRuntimeSource,
          settings.claudeCodePath,
          settings.claudeManagedVersion,
        ]
      : settings.gitBackupUsername,
  ])
}

function runtimeSelection(settings: AppSettings): ClaudeRuntimeSelection {
  if (settings.claudeRuntimeSource === 'custom')
    return { source: 'custom', customPath: settings.claudeCodePath }
  if (settings.claudeRuntimeSource === 'managed')
    return { source: 'managed', version: settings.claudeManagedVersion }
  return { source: settings.claudeRuntimeSource }
}

interface Props {
  initialService: ConnectionServiceId
  settings: AppSettings
  metadata: CredentialMetadata[]
  storageStatus: CredentialServiceStatus | null
  onRefresh: () => Promise<void>
  onComponents: () => void
  runtimeSettings: ReactNode
  storageSettings: ReactNode
}

export function ApiConnectionsSettings(props: Props): React.ReactElement {
  const [service, setService] = useState(props.initialService)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexMessage, setCodexMessage] = useState(
    '使用本机 Codex 的 ChatGPT 登录；无需填写 API Key。',
  )
  useEffect(() => {
    setService(props.initialService)
  }, [props.initialService])
  useEffect(() => {
    const refresh = (): void => {
      if (!busy) void props.onRefresh()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [busy, props.onRefresh])

  const select = (next: ConnectionServiceId): void => {
    if (next === service || busy) return
    if (dirty && !window.confirm('放弃尚未保存的输入并切换服务？已保存的配置保持不变。')) return
    setDirty(false)
    setService(next)
  }

  return (
    <section className="api-connections" aria-label="API Key 与连接">
      <header className="connections-header">
        <div>
          <h1>API Key 与连接</h1>
          <p>选择要用的服务，填入密钥，再验证是否可用。</p>
        </div>
        <span>本机全局</span>
      </header>
      <div className="connections-account">
        <IconRobot size={24} />
        <div>
          <div className="connections-title-line">
            <strong>Codex</strong>
            <span className="connections-badge">默认 Agent</span>
            <span className="connections-badge">账号登录</span>
          </div>
          <p role="status">{codexMessage}</p>
        </div>
        <button
          type="button"
          className="settings-secondary-btn"
          disabled={codexBusy}
          onClick={async () => {
            setCodexBusy(true)
            try {
              const result = await window.cclinkStudio.diagnostics.probeCodex()
              setCodexMessage(`${CODEX_DIAGNOSTIC_LABELS[result.state]} · ${result.message}`)
            } catch {
              setCodexMessage('本机登录检查失败，请稍后重试或查看诊断日志。')
            } finally {
              setCodexBusy(false)
            }
          }}
        >
          {codexBusy ? '检查中…' : '检查登录'}
        </button>
      </div>
      <div className="connections-layout">
        <nav className="connections-services" aria-label="选择服务">
          {SERVICES.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || SERVICES[index - 1].group !== item.group) && (
                <div className="connections-service-group">{item.group}</div>
              )}
              <button
                type="button"
                disabled={busy}
                aria-pressed={service === item.id}
                className={service === item.id ? 'active' : ''}
                onClick={() => select(item.id)}
              >
                {item.name}
                <small>
                  {item.id === 'datasource'
                    ? '按连接管理'
                    : props.storageStatus === null
                      ? '正在读取…'
                      : props.metadata.some(
                            (record) => record.id === item.credential && record.configured,
                          )
                        ? '已保存'
                        : '未配置'}
                </small>
              </button>
            </div>
          ))}
        </nav>
        <ConnectionForm
          key={service}
          {...props}
          service={service}
          setBusy={setBusy}
          setDirty={setDirty}
        />
      </div>
      <p className="connections-storage-note">
        <IconDatabase size={14} />
        密钥以明文保存在本机，不随工作空间同步。配置服务不需要登录 CCLink。
      </p>
      <details className="connections-advanced">
        <summary>存储与高级管理</summary>
        <fieldset className="connections-storage-controls" disabled={busy}>
          {props.storageSettings}
        </fieldset>
      </details>
    </section>
  )
}

type Feedback = {
  kind: 'saved' | 'verified' | 'error' | 'deleted'
  message: string
  identity?: string
  runtimeMissing?: boolean
}

function ConnectionForm({
  service,
  settings,
  metadata,
  storageStatus,
  onRefresh,
  onComponents,
  runtimeSettings,
  setBusy: reportBusy,
  setDirty: reportDirty,
}: Props & {
  service: ConnectionServiceId
  setBusy: (busy: boolean) => void
  setDirty: (dirty: boolean) => void
}): React.ReactElement {
  const item = SERVICES.find((entry) => entry.id === service)!
  const [provider, setProvider] = useState(settings.provider)
  const [url, setUrl] = useState(
    settings.apiBaseUrl || getPresetBaseUrl(settings.provider, 'anthropic'),
  )
  const [model, setModel] = useState(settings.modelName)
  const [username, setUsername] = useState(settings.gitBackupUsername)
  const [secret, setSecret] = useState('')
  const [secondSecret, setSecondSecret] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const edited = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      reportBusy(false)
      reportDirty(false)
    }
  }, [reportBusy, reportDirty])
  const configured = metadata.some((record) => record.id === item.credential && record.configured)
  const identity = connectionIdentity(settings, metadata, service)
  const connectionChanged =
    service === 'claude' &&
    (provider !== settings.provider ||
      url !== (settings.apiBaseUrl || getPresetBaseUrl(settings.provider, 'anthropic')) ||
      model !== settings.modelName)
  const targetChanged =
    service === 'claude' &&
    (provider !== settings.provider ||
      url !== (settings.apiBaseUrl || getPresetBaseUrl(settings.provider, 'anthropic')))
  const dirty = Boolean(
    secret ||
    secondSecret ||
    connectionChanged ||
    (service === 'github' && username !== settings.gitBackupUsername),
  )
  const writable = storageStatus?.status === 'ready'
  const valid =
    (configured || Boolean(secret.trim())) &&
    (!targetChanged || Boolean(secret.trim())) &&
    (service !== 'jimeng' || (Boolean(secret.trim()) && Boolean(secondSecret.trim()))) &&
    (service !== 'github' || Boolean(username.trim())) &&
    (service !== 'claude' || Boolean(url.trim() && model.trim()))
  const verified =
    writable &&
    !dirty &&
    configured &&
    feedback?.kind === 'verified' &&
    feedback.identity === identity
  const canTest = service === 'claude' || service === 'github'
  const status = !storageStatus
    ? '正在读取…'
    : !writable
      ? '凭证不可用'
      : dirty
        ? '有未保存修改'
        : verified
          ? '验证通过'
          : feedback?.kind === 'error'
            ? '操作未完成'
            : configured
              ? '已保存 · 未验证'
              : '未配置'
  useEffect(() => {
    reportDirty(dirty)
  }, [dirty, reportDirty])
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), 30_000)
    return () => clearTimeout(timer)
  }, [visible])
  // Hydrate asynchronously loaded settings without overwriting a user's draft.
  useEffect(() => {
    if (edited.current) return
    setProvider(settings.provider)
    setUrl(settings.apiBaseUrl || getPresetBaseUrl(settings.provider, 'anthropic'))
    setModel(settings.modelName)
    setUsername(settings.gitBackupUsername)
    // Deliberately keyed to authoritative settings, not every edit in the draft.
  }, [settings.provider, settings.apiBaseUrl, settings.modelName, settings.gitBackupUsername])

  const change = (action: () => void): void => {
    edited.current = true
    action()
    setFeedback(null)
  }
  const busyState = (value: boolean): void => {
    setBusy(value)
    reportBusy(value)
  }
  const notify = (value: Feedback): void => {
    if (mounted.current) setFeedback(value)
  }
  const checked = <T extends { success: boolean; error?: string }>(result: T): T => {
    if (!result.success) throw new Error(result.error || '操作失败，请重试。')
    return result
  }

  const perform = async (verify: boolean): Promise<void> => {
    busyState(true)
    setFeedback(null)
    let saved = false
    let runtimeWarning: string | undefined
    try {
      if (dirty || !configured) {
        if (service === 'claude') {
          const result = checked(
            await window.cclinkStudio.settings.saveClaudeConnection({
              provider,
              apiBaseUrl: url,
              modelName: model,
              ...(secret.trim() ? { apiKey: secret.trim() } : {}),
            }),
          )
          if (result.settings) {
            setProvider(result.settings.provider)
            setUrl(result.settings.apiBaseUrl)
            setModel(result.settings.modelName)
          }
          runtimeWarning = result.runtimeWarning
          if (result.runtimeWarning)
            notify({ kind: 'saved', message: result.runtimeWarning, runtimeMissing: true })
        } else if (service === 'github') {
          checked(
            await window.cclinkStudio.gitBackup.saveAccount({
              username,
              ...(secret.trim() ? { token: secret.trim() } : {}),
            }),
          )
        } else {
          checked(
            await window.cclinkStudio.credentials.set({
              id: item.credential,
              kind: 'api-key',
              fields:
                service === 'jimeng'
                  ? { accessKeyId: secret.trim(), secretAccessKey: secondSecret.trim() }
                  : { apiKey: secret.trim() },
            }),
          )
        }
        saved = true
        edited.current = false
        if (mounted.current) {
          setSecret('')
          setSecondSecret('')
          setVisible(false)
        }
        await onRefresh()
      }
      if (!verify) {
        notify({
          kind: 'saved',
          message:
            runtimeWarning ||
            '已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。',
          runtimeMissing: Boolean(runtimeWarning),
        })
        return
      }
      const currentSettings = await window.cclinkStudio.settings.getAll()
      const currentMetadata =
        checked(await window.cclinkStudio.credentials.listMetadata()).metadata ?? []
      const testedIdentity = connectionIdentity(currentSettings, currentMetadata, service)
      let verification: Feedback
      if (service === 'claude') {
        const response = checked(
          await window.cclinkStudio.settings.testClaudeModelConnection(
            runtimeSelection(currentSettings),
          ),
        )
        const result = response.result
        if (!result) throw new Error('连接测试未返回结果，请重试。')
        verification = result.success
          ? {
              kind: 'verified',
              identity: testedIdentity,
              message: `${result.message} · ${result.model} · ${result.durationMs}ms${result.totalCostUsd === undefined ? '' : ` · $${result.totalCostUsd.toFixed(4)}`}`,
            }
          : {
              kind: 'error',
              message: `${result.code}：${result.message}`,
              runtimeMissing: result.code === 'RUNTIME_UNAVAILABLE',
            }
      } else {
        const result = await window.cclinkStudio.gitBackup.testAccount()
        verification = result.success
          ? {
              kind: 'verified',
              identity: testedIdentity,
              message: result.message || 'GitHub 账号认证通过。目标仓库的写入权限需在备份时确认。',
            }
          : {
              kind: 'error',
              message: result.error || result.message || 'GitHub 认证失败，请检查 Token 和网络。',
            }
      }
      await onRefresh()
      notify(verification)
    } catch (error) {
      notify({
        kind: 'error',
        message: `${saved ? '配置已保存，但后续操作未完成。' : ''}${error instanceof Error ? error.message : '操作失败，请检查存储和连接状态。'}`,
      })
      await onRefresh()
    } finally {
      if (mounted.current) busyState(false)
    }
  }

  const remove = async (): Promise<void> => {
    busyState(true)
    try {
      checked(
        service === 'claude'
          ? await window.cclinkStudio.settings.clearSecret('apiKey')
          : await window.cclinkStudio.credentials.remove(item.credential),
      )
      if (mounted.current) {
        setSecret('')
        setSecondSecret('')
        setVisible(false)
        setConfirmRemove(false)
        edited.current = false
        setFeedback(null)
      }
      await onRefresh()
      notify({ kind: 'deleted', message: '密钥已删除，相关功能需要重新配置；非敏感连接设置保留。' })
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : '删除失败，请重试。',
      })
    } finally {
      if (mounted.current) busyState(false)
    }
  }

  const startClaude = (): void => {
    const { ref } = captureActiveWorkspaceTarget()
    if (ref.kind === 'remote') {
      notify({ kind: 'error', message: '这是本机 Claude 配置，请先切换到本地工作空间再新建会话。' })
      return
    }
    useAgentStore.getState().createConversation({
      runtime: createConversationRuntimeForWorkspace(ref),
      runtimeBinding: { kind: 'claude-code' },
      activate: true,
    })
    useUIStore.getState().showAgentChat()
    requestAnimationFrame(focusAgentComposer)
  }

  return (
    <div className="connections-detail">
      <div className="connections-detail-heading">
        <h2>{item.name}</h2>
        {service !== 'datasource' && (
          <span className={`connections-status ${verified ? 'success' : ''}`} role="status">
            {verified ? '✓ ' : ''}
            {busy ? '处理中…' : status}
          </span>
        )}
      </div>
      <p className="connections-description">{item.description}</p>
      {service === 'datasource' ? (
        <>
          <p className="connections-description">{item.usage}</p>
          <button
            type="button"
            className="settings-secondary-btn"
            onClick={() => useUIStore.getState().showPanel('data-sources')}
          >
            管理数据源连接
          </button>
        </>
      ) : (
        <>
          <fieldset className="connections-form" disabled={busy || !writable}>
            {service === 'claude' && (
              <label>
                模型服务商
                <select
                  value={provider}
                  onChange={(event) =>
                    change(() => {
                      const next = event.target.value as Provider
                      setProvider(next)
                      setUrl(getPresetBaseUrl(next, 'anthropic'))
                      setModel(next === 'custom' ? '' : PROVIDER_PRESETS[next].defaultModel)
                      setSecret('')
                    })
                  }
                >
                  {SUPPORTED_AGENT_PROVIDERS.map((key) => (
                    <option key={key} value={key}>
                      {PROVIDER_PRESETS[key].label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {service === 'github' && (
              <label>
                GitHub 用户名
                <input
                  value={username}
                  maxLength={39}
                  autoComplete="off"
                  onChange={(event) => change(() => setUsername(event.target.value))}
                />
              </label>
            )}
            <label>
              {service === 'jimeng'
                ? 'Access Key ID'
                : service === 'github'
                  ? '访问 Token'
                  : 'API Key'}
              <span className="connections-secret-input">
                <input
                  type={visible ? 'text' : 'password'}
                  value={secret}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={8192}
                  placeholder={configured ? '已保存 · 输入新密钥以替换' : '输入服务商提供的密钥'}
                  onChange={(event) => change(() => setSecret(event.target.value))}
                />
                <button
                  type="button"
                  className="settings-secondary-btn"
                  aria-label={visible ? '隐藏输入的密钥' : '显示输入的密钥'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? '隐藏' : '显示'}
                </button>
              </span>
            </label>
            {service === 'jimeng' && (
              <label>
                Secret Access Key
                <input
                  type={visible ? 'text' : 'password'}
                  value={secondSecret}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={8192}
                  placeholder="与 Access Key ID 一起填写"
                  onChange={(event) => change(() => setSecondSecret(event.target.value))}
                />
              </label>
            )}
            <p className="connections-field-note">
              {targetChanged
                ? '服务商或地址已变更，请重新填写对应的 Key。保存成功前保留原配置。'
                : '只用于当前服务；保存成功后清空明文输入。'}
            </p>
            {service === 'claude' && (
              <>
                <label>
                  API 地址
                  <input
                    value={url}
                    type="url"
                    maxLength={2048}
                    spellCheck={false}
                    placeholder="服务商提供的 Anthropic 兼容地址"
                    onChange={(event) => change(() => setUrl(event.target.value))}
                  />
                </label>
                <p className="connections-field-note">
                  当前 Claude Code 仅支持 Anthropic 兼容接口。
                </p>
                <label>
                  模型名称
                  <input
                    value={model}
                    maxLength={256}
                    spellCheck={false}
                    placeholder="服务商支持的模型 ID"
                    onChange={(event) => change(() => setModel(event.target.value))}
                  />
                </label>
              </>
            )}
          </fieldset>
          <p className="connections-usage">{item.usage}</p>
          {!writable && (
            <p className="connections-feedback error" role="alert">
              {storageStatus?.status === 'conflict'
                ? '凭证文件已被外部修改。请在“存储与高级管理”重新加载后再保存。'
                : storageStatus?.message ||
                  (storageStatus
                    ? '本地凭证存储不可写，请检查存储状态。'
                    : '正在读取本地凭证状态…')}
            </p>
          )}
          <div className="connections-actions">
            {canTest && (
              <button
                type="button"
                className="connections-primary"
                disabled={busy || !writable || !valid}
                onClick={() => void perform(true)}
              >
                {busy ? '处理中…' : dirty || !configured ? '保存并验证' : '验证连接'}
              </button>
            )}
            <button
              type="button"
              className={canTest ? 'settings-secondary-btn' : 'connections-primary'}
              disabled={busy || !writable || !valid || !dirty}
              onClick={() => void perform(false)}
            >
              {canTest ? '仅保存' : '保存密钥'}
            </button>
            {configured && (
              <button
                type="button"
                className="connections-delete"
                disabled={busy || !writable}
                onClick={() => setConfirmRemove(true)}
              >
                删除密钥
              </button>
            )}
          </div>
          <p className="connections-field-note">
            {service === 'claude'
              ? '验证使用当前运行环境和模型发送一次最小请求，可能产生少量费用。'
              : canTest
                ? '验证只检查账号认证，不创建或修改远端仓库。'
                : '当前无独立连接测试。保存只代表密钥已记录，请到对应功能实际使用。'}
          </p>
          {feedback && (
            <div
              className={`connections-feedback ${feedback.kind === 'error' ? 'error' : verified ? 'success' : ''}`}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
            >
              <strong>
                {verified
                  ? '验证通过'
                  : feedback.kind === 'verified'
                    ? '配置已变更，请重新验证'
                    : feedback.kind === 'error'
                      ? '操作未完成'
                      : feedback.kind === 'deleted'
                        ? '已删除'
                        : '已保存'}
              </strong>
              <p>
                {feedback.kind !== 'verified' || verified
                  ? feedback.message
                  : '之前的验证结果不适用于当前配置。'}
              </p>
              {verified && service === 'claude' && (
                <button type="button" className="settings-secondary-btn" onClick={startClaude}>
                  新建 Claude Code 会话
                </button>
              )}
              {feedback.runtimeMissing && (
                <button type="button" className="settings-secondary-btn" onClick={onComponents}>
                  前往组件管理
                </button>
              )}
            </div>
          )}
          {confirmRemove && (
            <div className="connections-remove-confirm" role="alert">
              <strong>删除 {item.name} 的密钥？</strong>
              <p>{item.name} 后续调用将需要重新配置；其他服务和已有文件保留。</p>
              <div className="connections-actions">
                <button
                  type="button"
                  className="settings-danger-btn"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  确认删除
                </button>
                <button
                  type="button"
                  className="settings-secondary-btn"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {service === 'claude' && (
            <details className="connections-advanced">
              <summary>运行环境与兼容设置</summary>
              <fieldset className="connections-storage-controls" disabled={busy}>
                {runtimeSettings}
              </fieldset>
              <button type="button" className="settings-secondary-btn" onClick={onComponents}>
                安装或管理运行组件
              </button>
            </details>
          )}
        </>
      )}
    </div>
  )
}
