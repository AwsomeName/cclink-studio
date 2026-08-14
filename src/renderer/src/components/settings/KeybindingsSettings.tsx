import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyChord, KeybindingOverride } from '@shared/keybindings'
import { formatKeyChord, isMacPlatform, keyChordId } from '@shared/keybindings'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import {
  clearKeybindingOverride,
  effectiveBindingsForCommand,
  findKeybindingConflicts,
  setKeybindingOverride,
} from '../../features/shortcuts/keybinding-resolver'
import {
  consumeExternalShortcutCapture,
  startShortcutCapture,
  stopShortcutCapture,
  type ShortcutCaptureResult,
} from '../../features/shortcuts/shortcut-capture'

const CAPTURE_TIMEOUT_MS = 30_000

const SCOPE_LABELS = {
  global: '全局',
  workbench: '当前内容',
  editor: '编辑器',
  markdown: 'Markdown',
  terminal: '终端',
  browser: '浏览器',
} as const

interface RecordingState {
  commandId: string
  sessionId: string
}

interface PendingConflict {
  commandId: string
  chord: KeyChord
  conflictIds: string[]
}

export function KeybindingsSettings(): React.ReactElement {
  const commands = useCommandStore((state) => state.commands)
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<RecordingState | null>(null)
  const recordingRef = useRef<RecordingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null)
  const mac = isMacPlatform(typeof navigator === 'undefined' ? '' : navigator.platform)

  const configurableCommands = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return commands
      .filter((command) => command.shortcutPolicy && command.configurable !== false)
      .filter((command) => {
        if (!needle) return true
        return [command.label, command.id, command.category ?? ''].some((value) =>
          value.toLowerCase().includes(needle),
        )
      })
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  }, [commands, query])

  const stopRecording = useCallback(() => {
    const active = recordingRef.current
    stopShortcutCapture()
    recordingRef.current = null
    setRecording(null)
    if (active) {
      void window.cclinkStudio.window
        .setShortcutCaptureGuard({
          sessionId: active.sessionId,
          active: false,
          timeoutMs: CAPTURE_TIMEOUT_MS,
        })
        .catch(() => undefined)
    }
  }, [])

  const saveOverrides = useCallback(
    async (nextOverrides: KeybindingOverride[], successMessage: string): Promise<void> => {
      const success = await updateSettings({ keybindingOverrides: nextOverrides })
      setMessage(success ? successMessage : '保存失败，原快捷键没有改变')
    },
    [updateSettings],
  )

  const handleCaptureResult = useCallback(
    (commandId: string, sessionId: string, result: ShortcutCaptureResult): void => {
      if (recordingRef.current?.sessionId !== sessionId) return
      if (result.kind === 'invalid') {
        setMessage(result.message)
        return
      }

      stopRecording()
      if (result.kind === 'cancel') {
        setMessage('已取消修改')
        return
      }
      if (result.kind === 'clear') {
        void saveOverrides(
          setKeybindingOverride(overrides, commandId, []),
          '已移除这个命令的快捷键',
        )
        return
      }

      const conflicts = findKeybindingConflicts(commands, overrides, commandId, result.chord)
      if (conflicts.length > 0) {
        setPendingConflict({
          commandId,
          chord: result.chord,
          conflictIds: conflicts.map((command) => command.id),
        })
        setMessage(`这个按键已用于“${conflicts.map((command) => command.label).join('、')}”`)
        return
      }
      void saveOverrides(
        setKeybindingOverride(overrides, commandId, [result.chord]),
        '快捷键已保存并立即生效',
      )
    },
    [commands, overrides, saveOverrides, stopRecording],
  )

  const beginRecording = useCallback(
    async (commandId: string): Promise<void> => {
      stopRecording()
      setMessage(null)
      setPendingConflict(null)
      const sessionId = `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const nextRecording = { commandId, sessionId }
      try {
        const guardResult = await window.cclinkStudio.window.setShortcutCaptureGuard({
          sessionId,
          active: true,
          timeoutMs: CAPTURE_TIMEOUT_MS,
        })
        if (!guardResult.success) {
          setMessage('无法安全录制快捷键，请重试')
          return
        }
      } catch {
        setMessage('无法安全录制快捷键，请重试')
        return
      }
      recordingRef.current = nextRecording
      setRecording(nextRecording)
      startShortcutCapture(
        sessionId,
        (result) => handleCaptureResult(commandId, sessionId, result),
        CAPTURE_TIMEOUT_MS,
      )
    },
    [handleCaptureResult, stopRecording],
  )

  useEffect(() => {
    return window.cclinkStudio.window.onShortcutCaptureInput((event) => {
      consumeExternalShortcutCapture(event.sessionId, event.chord)
    })
  }, [])

  useEffect(() => {
    const handleBlur = (): void => {
      if (!recordingRef.current) return
      stopRecording()
      setMessage('窗口失去焦点，已取消录制')
    }
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('blur', handleBlur)
      stopRecording()
    }
  }, [stopRecording])

  const confirmConflict = (): void => {
    if (!pendingConflict) return
    let nextOverrides = overrides
    for (const conflictId of pendingConflict.conflictIds) {
      const conflict = commands.find((command) => command.id === conflictId)
      if (!conflict) continue
      const remaining = effectiveBindingsForCommand(conflict, nextOverrides).filter(
        (binding) => keyChordId(binding) !== keyChordId(pendingConflict.chord),
      )
      nextOverrides = setKeybindingOverride(nextOverrides, conflictId, remaining)
    }
    nextOverrides = setKeybindingOverride(nextOverrides, pendingConflict.commandId, [
      pendingConflict.chord,
    ])
    setPendingConflict(null)
    void saveOverrides(nextOverrides, '快捷键已改绑并立即生效')
  }

  const resetCommand = (commandId: string): void => {
    setPendingConflict(null)
    void saveOverrides(clearKeybindingOverride(overrides, commandId), '已恢复这个命令的默认快捷键')
  }

  return (
    <>
      <div className="keybindings-toolbar">
        <input
          className="settings-select keybindings-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索命令或快捷键"
          aria-label="搜索快捷键"
        />
        <button
          type="button"
          disabled={overrides.length === 0}
          onClick={() => {
            setPendingConflict(null)
            void saveOverrides([], '已恢复全部默认快捷键；其他设置没有改变')
          }}
        >
          全部恢复默认
        </button>
      </div>
      <p className="settings-description keybindings-help">
        点击“修改”后按下新组合键。Escape 取消，Delete 清除。作用范围由命令固定，不能在这里修改。
      </p>
      {message && !pendingConflict && (
        <div className="keybindings-message" role="status">
          {message}
        </div>
      )}
      {pendingConflict && (
        <div className="keybindings-conflict" role="alert">
          <span>{message}</span>
          <button type="button" onClick={confirmConflict}>
            改绑并清除旧命令
          </button>
          <button type="button" onClick={() => setPendingConflict(null)}>
            取消
          </button>
        </div>
      )}
      <div className="settings-group keybindings-list">
        {configurableCommands.map((command) => {
          const policy = command.shortcutPolicy
          if (!policy) return null
          const bindings = effectiveBindingsForCommand(command, overrides)
          const modified = overrides.some((override) => override.commandId === command.id)
          const isRecording = recording?.commandId === command.id
          return (
            <div className="settings-row keybindings-row" key={command.id}>
              <div className="settings-label keybindings-command">
                <span>{command.label}</span>
                <span className="settings-description">
                  {command.id} · {SCOPE_LABELS[policy.scope]}
                  {modified ? ' · 已修改' : ''}
                </span>
              </div>
              <div className="settings-control keybindings-actions">
                <kbd>
                  {isRecording
                    ? '请按下组合键…'
                    : bindings.length > 0
                      ? bindings.map((binding) => formatKeyChord(binding, mac)).join(' / ')
                      : '未设置'}
                </kbd>
                <button type="button" onClick={() => void beginRecording(command.id)}>
                  {isRecording ? '录制中' : '修改'}
                </button>
                <button type="button" disabled={!modified} onClick={() => resetCommand(command.id)}>
                  恢复默认
                </button>
              </div>
            </div>
          )
        })}
        {configurableCommands.length === 0 && (
          <div className="keybindings-empty">没有匹配的可配置命令</div>
        )}
      </div>
    </>
  )
}
