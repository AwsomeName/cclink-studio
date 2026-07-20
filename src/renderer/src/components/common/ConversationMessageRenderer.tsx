import type { AgentMessage, ContentBlock } from '../../types'
import { IconCheck, IconClipboard, IconError, IconThinking, IconTool } from './Icons'
import { openFileRangeResource } from '../../features/markdown/markdown-navigation'
import { copyTextToClipboard } from '../../utils/clipboard'
import { useToastStore } from './Toast'

type ToolContentBlock = Extract<ContentBlock, { type: 'tool_use' | 'tool_result' }>
type ThinkingContentBlock = Extract<ContentBlock, { type: 'thinking' }>

type ContentRenderUnit =
  | { type: 'block'; block: ContentBlock }
  | { type: 'tool_group'; blocks: ToolContentBlock[] }
  | { type: 'thinking_group'; blocks: ThinkingContentBlock[] }

export function ConversationMessageRenderer({
  message,
}: {
  message: AgentMessage
}): React.ReactElement {
  const units = buildContentRenderUnits(message.content)
  const copyText = getMessageCopyText(message)

  const handleCopyMessage = async (): Promise<void> => {
    try {
      await copyTextToClipboard(copyText)
      useToastStore.getState().show('已复制整条消息', 'success')
    } catch (error) {
      useToastStore.getState().show(`复制失败: ${String(error)}`, 'error')
    }
  }

  return (
    <div className={`agent-message ${message.role} ${message.isStreaming ? 'streaming' : ''}`}>
      {copyText && (
        <button
          type="button"
          className="agent-message-copy-btn"
          onClick={() => void handleCopyMessage()}
          title="复制整条消息"
          aria-label="复制整条消息"
        >
          <IconClipboard size={12} />
        </button>
      )}
      {units.map((unit, index) => (
        <ContentRenderUnitRenderer
          key={index}
          unit={unit}
          isStreaming={message.isStreaming === true}
        />
      ))}
      {message.resources && message.resources.length > 0 && (
        <div className="message-resource-list">
          {message.resources.map((resource) => (
            <button
              key={resource.id}
              type="button"
              className="message-resource-chip"
              onClick={() => openFileRangeResource(resource)}
              title={resource.detail}
            >
              {resource.label}
            </button>
          ))}
        </div>
      )}
      {message.isStreaming && <span className="streaming-cursor" />}
    </div>
  )
}

export function getMessageCopyText(message: AgentMessage): string {
  if (message.rawText.trim()) return message.rawText

  return message.content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'thinking':
          return block.thinking
        case 'tool_use':
          return `${productToolLabel(block.name)}\n${formatToolInput(block.input)}`
        case 'tool_result':
          return block.content
      }
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export function buildContentRenderUnits(blocks: ContentBlock[]): ContentRenderUnit[] {
  const units: ContentRenderUnit[] = []
  let pendingTools: ToolContentBlock[] = []
  let pendingThinking: ThinkingContentBlock[] = []

  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    units.push({ type: 'tool_group', blocks: pendingTools })
    pendingTools = []
  }
  const flushThinking = (): void => {
    if (pendingThinking.length === 0) return
    units.push({ type: 'thinking_group', blocks: pendingThinking })
    pendingThinking = []
  }

  for (const block of blocks) {
    if (block.type === 'tool_use' || block.type === 'tool_result') {
      flushThinking()
      pendingTools.push(block)
      continue
    }

    if (block.type === 'thinking') {
      flushTools()
      pendingThinking.push(block)
      continue
    }

    flushTools()
    flushThinking()
    units.push({ type: 'block', block })
  }

  flushTools()
  flushThinking()
  return units
}

function ContentRenderUnitRenderer({
  unit,
  isStreaming,
}: {
  unit: ContentRenderUnit
  isStreaming: boolean
}): React.ReactElement {
  if (unit.type === 'tool_group') {
    return <ToolExecutionGroup blocks={unit.blocks} isStreaming={isStreaming} />
  }
  if (unit.type === 'thinking_group') {
    return <ThinkingGroup blocks={unit.blocks} />
  }

  return <ContentBlockRenderer block={unit.block} />
}

export function ContentBlockRenderer({ block }: { block: ContentBlock }): React.ReactElement {
  switch (block.type) {
    case 'text':
      return (
        <div className="content-text">
          {block.text.split('\n').map((line, index) => (
            <span key={index}>
              {line}
              {index < block.text.split('\n').length - 1 && <br />}
            </span>
          ))}
        </div>
      )

    case 'thinking': {
      const thinkingPreview = previewText(block.thinking, 56) || '查看推理摘要'
      return (
        <details className="content-thinking">
          <summary>
            <IconThinking size={12} />
            <span>思考摘要</span>
            <em>{thinkingPreview}</em>
          </summary>
          <div className="thinking-content">{block.thinking}</div>
        </details>
      )
    }

    case 'tool_use': {
      const toolLabel = productToolLabel(block.name)
      const toolInputPreview = previewText(JSON.stringify(block.input), 72)
      return (
        <details className="content-tool-use">
          <summary className="tool-summary">
            <IconTool size={12} />
            <span>{toolLabel}</span>
            <em>{toolInputPreview || '无参数'}</em>
          </summary>
          <div className="tool-detail">
            <div className="tool-raw-name">{block.name}</div>
            <pre className="tool-input">{formatToolInput(block.input)}</pre>
          </div>
        </details>
      )
    }

    case 'tool_result': {
      const resultLabel = block.is_error ? '工具失败' : '工具完成'
      const resultPreview =
        previewText(block.content, 92) || (block.is_error ? '执行失败' : '执行成功')
      return (
        <details className={`content-tool-result ${block.is_error ? 'error' : 'success'}`}>
          <summary>
            {block.is_error ? <IconError size={12} /> : <IconCheck size={12} />}
            <span>{resultLabel}</span>
            <em>{resultPreview}</em>
          </summary>
          <div className="tool-result-content">{block.content}</div>
        </details>
      )
    }
  }
}

function ThinkingGroup({ blocks }: { blocks: ThinkingContentBlock[] }): React.ReactElement {
  const joined = blocks.map((block) => block.thinking).join('\n\n')
  const preview = previewText(joined, 72) || '查看推理摘要'

  return (
    <details className="content-thinking content-thinking-group">
      <summary>
        <IconThinking size={12} />
        <span>思考摘要</span>
        <em>
          {blocks.length > 1 ? `${blocks.length} 段 · ` : ''}
          {preview}
        </em>
      </summary>
      <div className="thinking-content">
        {blocks.map((block, index) => (
          <div key={index} className="thinking-segment">
            {block.thinking}
          </div>
        ))}
      </div>
    </details>
  )
}

export function getToolExecutionSummary(blocks: ToolContentBlock[]): {
  actionCount: number
  completedCount: number
  failedCount: number
  pendingCount: number
} {
  const toolUses = blocks.filter((block) => block.type === 'tool_use')
  const results = new Map(
    blocks
      .filter((block) => block.type === 'tool_result')
      .map((block) => [block.tool_use_id, block]),
  )
  let completedCount = 0
  let failedCount = 0
  let pendingCount = 0
  for (const toolUse of toolUses) {
    const result = results.get(toolUse.id)
    if (!result) pendingCount += 1
    else if (result.is_error) failedCount += 1
    else completedCount += 1
  }
  return {
    actionCount: toolUses.length || blocks.length,
    completedCount,
    failedCount,
    pendingCount,
  }
}

function ToolExecutionGroup({
  blocks,
  isStreaming,
}: {
  blocks: ToolContentBlock[]
  isStreaming: boolean
}): React.ReactElement {
  const summary = getToolExecutionSummary(blocks)
  const preview = blocks
    .slice(0, 3)
    .map((block) =>
      block.type === 'tool_use'
        ? productToolLabel(block.name)
        : block.is_error
          ? '工具失败'
          : '工具完成',
    )
    .join('、')

  return (
    <details className="content-tool-group">
      <summary>
        <IconTool size={12} />
        <span>执行过程</span>
        <em>
          {summary.actionCount} 个动作
          {summary.completedCount > 0 ? ` · ${summary.completedCount} 完成` : ''}
          {summary.failedCount > 0 ? ` · ${summary.failedCount} 失败` : ''}
          {summary.pendingCount > 0
            ? ` · ${summary.pendingCount} ${isStreaming ? '等待结果' : '未完成'}`
            : ''}
          {preview ? ` · ${preview}` : ''}
        </em>
      </summary>
      <div className="tool-group-rows">
        {blocks.map((block, index) => (
          <ToolExecutionRow
            key={index}
            block={block}
            isPending={
              block.type === 'tool_use' &&
              !blocks.some(
                (candidate) =>
                  candidate.type === 'tool_result' && candidate.tool_use_id === block.id,
              )
            }
            isStreaming={isStreaming}
          />
        ))}
      </div>
    </details>
  )
}

function ToolExecutionRow({
  block,
  isPending,
  isStreaming,
}: {
  block: ToolContentBlock
  isPending: boolean
  isStreaming: boolean
}): React.ReactElement {
  if (block.type === 'tool_use') {
    return (
      <details className={`tool-group-row tool-group-row-use ${isPending ? 'pending' : ''}`}>
        <summary>
          <IconTool size={12} />
          <span>{productToolLabel(block.name)}</span>
          <em>
            {isPending ? `${isStreaming ? '等待结果' : '未完成'} · ` : ''}
            {previewText(JSON.stringify(block.input), 72) || '无参数'}
          </em>
        </summary>
        <div className="tool-detail">
          <div className="tool-raw-name">{block.name}</div>
          <pre className="tool-input">{formatToolInput(block.input)}</pre>
        </div>
      </details>
    )
  }

  if (block.type === 'tool_result') {
    return (
      <details
        className={`tool-group-row tool-group-row-result ${block.is_error ? 'error' : 'success'}`}
      >
        <summary>
          {block.is_error ? <IconError size={12} /> : <IconCheck size={12} />}
          <span>{block.is_error ? '工具失败' : '工具完成'}</span>
          <em>{previewText(block.content, 92) || (block.is_error ? '执行失败' : '执行成功')}</em>
        </summary>
        <div className="tool-result-content">{block.content}</div>
      </details>
    )
  }

  return <div className="tool-result-content">未知工具事件</div>
}

function formatToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function previewText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function productToolLabel(name: string): string {
  const normalized = name
    .replace(/^mcp__cclink_studio__/, '')
    .replace(/^mcp__[^_]+__/, '')
    .replace(/^cclink_studio__/, '')

  const labels: Record<string, string> = {
    browser_navigate: '浏览器导航',
    browser_get_tab_info: '读取标签页信息',
    browser_click: '点击页面',
    browser_fill: '填写表单',
    browser_screenshot: '截取页面',
    browser_extract: '提取页面信息',
    browser_scroll: '滚动页面',
    browser_wait: '等待页面',
    fs_read_file: '读取文件',
    fs_write_file: '写入文件',
    terminal_run: '运行命令',
  }

  return labels[normalized] ?? normalized.replace(/_/g, ' ')
}
