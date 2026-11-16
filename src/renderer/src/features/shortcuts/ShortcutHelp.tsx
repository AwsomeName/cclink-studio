import { formatKeyChord, keyChordId } from '@shared/keybindings'
import type { CommandContext } from '../context-actions/context-target'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { resolveEffectiveKeybindings } from './keybinding-resolver'
import { selectShortcutBinding } from './use-shortcut-router'
import { useBrowserFindStore } from '../browser/browser-find-store'
import './shortcut-help.css'

export interface ShortcutHelpContext {
  title: string
  tabId: string | null
  scopes: Set<string>
  editing: boolean
  commandContext: CommandContext
  nativeBrowser: boolean
}

const PRIMARY_COMMANDS = new Set([
  'workbench.save',
  'workbench.find',
  'workbench.showCommands',
  'workbench.newTab',
  'workbench.closeTab',
  'tab.nextTab',
  'tab.prevTab',
  'settings.open',
  'markdown.undo',
  'markdown.redo',
  'markdown.bold',
  'markdown.italic',
  'markdown.strike',
  'markdown.inlineCode',
  'markdown.link',
  'markdown.heading1',
  'markdown.heading2',
  'markdown.paragraph',
  'markdown.bulletList',
  'markdown.orderedList',
  'markdown.taskList',
  'markdown.blockquote',
  'markdown.codeBlock',
  'markdown.insertDateTime',
  'markdown.insertTime',
  'browser.navigate',
  'browser.zoomIn',
  'browser.zoomOut',
])

export function ShortcutHelp({
  context,
  inline = false,
}: {
  context: ShortcutHelpContext | null
  inline?: boolean
}): React.ReactElement | null {
  const commands = useCommandStore((state) => state.commands)
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  const browserShortcutsSynced = useBrowserFindStore(
    (state) => state.shortcutSync.status === 'synced',
  )
  if (!context) return null
  const bindings = resolveEffectiveKeybindings(commands, overrides)
  const rows = commands.flatMap((command) => {
    const scope = command.shortcutPolicy?.scope
    if (!scope || (!PRIMARY_COMMANDS.has(command.id) && scope !== 'agent' && scope !== 'terminal'))
      return []
    if (command.visible && !command.visible(context.commandContext)) return []
    const available = command.enabled?.(context.commandContext) ?? true
    if (available === false || (typeof available === 'object' && !available.enabled)) return []
    const effective = bindings.filter(
      (binding) =>
        binding.commandId === command.id &&
        selectShortcutBinding(bindings, keyChordId(binding.chord), context.scopes, context.editing)
          ?.commandId === command.id,
    )
    if (!effective.length) return []
    return [
      {
        id: command.id,
        label: command.label.replace(/^Markdown：/, ''),
        keys: effective.map((binding) => formatKeyChord(binding.chord, true)).join(' / '),
        group: context.nativeBrowser
          ? command.id === 'workbench.find' && browserShortcutsSynced
            ? '网页内可用'
            : '工作台获得焦点后可用'
          : scope === 'markdown' || scope === 'browser' || scope === 'agent' || scope === 'terminal'
            ? '当前界面'
            : '常用操作',
      },
    ]
  })

  // A passive reference, not a modal: keep editor focus and let the next chord run normally.
  return (
    <aside
      className={`shortcut-help${inline ? ' shortcut-help-inline' : ''}`}
      role="note"
      aria-label={`${context.title}快捷键提示`}
    >
      <header>
        <strong>{context.title} · 主要快捷键</strong>
        <span>松开 ⌘ 收起</span>
      </header>
      <div className="shortcut-help-groups">
        {(context.nativeBrowser
          ? ['网页内可用', '工作台获得焦点后可用']
          : ['当前界面', '常用操作']
        ).map((group) => {
          const items = rows.filter((row) => row.group === group)
          return items.length ? (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {items.map((row) => (
                  <div key={row.id} data-command-id={row.id}>
                    <dt>{row.label}</dt>
                    <dd>
                      <kbd>{row.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null
        })}
      </div>
      <footer>
        设置 → 快捷键可修改绑定
        {context.nativeBrowser
          ? browserShortcutsSynced
            ? ' · 点击地址栏或工具栏可将焦点切回工作台'
            : ' · 网页查找键位尚未同步，请先将焦点移到工作台'
          : ' · 按其他键可直接执行操作'}
      </footer>
    </aside>
  )
}
