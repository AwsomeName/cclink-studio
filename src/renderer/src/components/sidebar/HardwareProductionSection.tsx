import { useEffect, useState } from 'react'
import type {
  FpcShapeContext,
  HardwareRiskLevel,
  HardwareReportConclusion,
} from '@shared/ipc/hardware'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import { useAgentStore, useFsStore, useHardwareStore, useTabStore } from '../../stores'
import { createConversationRunController } from '../../features/agent-conversations/conversation-run-controller'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconMonitor,
  IconRefresh,
} from '../common/Icons'

function conclusionLabel(conclusion: HardwareReportConclusion): string {
  switch (conclusion) {
    case 'ready':
      return '可进入报价'
    case 'quote-only':
      return '可报价，需复核'
    case 'blocked':
      return '阻塞'
  }
}

function riskLabel(level: HardwareRiskLevel): string {
  switch (level) {
    case 'blocking':
      return '阻塞'
    case 'warning':
      return '风险'
    case 'info':
      return '提示'
  }
}

function summarizeFpcShapeContext(context: FpcShapeContext): string {
  const outline = context.outline
  const outlineText = outline?.outlineCandidates[0]
    ? [
        `外形层：${outline.entry}`,
        `外形尺寸：${outline.outlineCandidates[0].bounds.width.toFixed(2)} × ${outline.outlineCandidates[0].bounds.height.toFixed(2)} ${outline.unit}`,
        `外形置信度：${Math.round(outline.outlineCandidates[0].confidence * 100)}%`,
      ].join('\n')
    : '外形层：尚未可靠识别'

  const structuralText =
    context.structuralArtifacts.length > 0
      ? context.structuralArtifacts
          .slice(0, 8)
          .map((artifact) => {
            const size = artifact.metadata?.bounds?.size
            const sizeText = size
              ? `，尺寸 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} ${artifact.metadata?.unit ?? 'unknown'}`
              : ''
            return `- ${artifact.displayName}：${artifact.canPreview ? '可预览' : '不可预览'}，${artifact.message}${sizeText}`
          })
          .join('\n')
      : '- 未识别到结构件'

  return [
    `准备状态：${context.readiness}`,
    outlineText,
    '',
    '结构件：',
    structuralText,
    '',
    '需要向用户确认的问题：',
    ...(context.questions.length > 0
      ? context.questions.map((question) => `- ${question}`)
      : ['- 暂无']),
    '',
    '建议下一步：',
    ...(context.nextActions.length > 0
      ? context.nextActions.map((action) => `- ${action}`)
      : ['- 暂无']),
  ].join('\n')
}

function buildFpcShapeAgentPrompt(workspacePath: string, context: FpcShapeContext): string {
  return [
    '请开始“让 AI 带我完成 FPC 排线形状调整”的准备流程。',
    '',
    `工作空间：${workspacePath}`,
    '',
    '你已经拿到 CCLink Studio 生成的只读 FPC 改形状上下文摘要：',
    '',
    summarizeFpcShapeContext(context),
    '',
    '请按以下方式推进：',
    '1. 先用人能听懂的话总结当前 FPC 外形、结构件约束和不确定性。',
    '2. 如果缺少装配坐标、对齐点、固定区域或目标修改尺寸，先向我提问，不要假装知道。',
    '3. 不要修改任何 Gerber、STEP、STL、源工程或生产文件。',
    '4. 如果需要更细的外形点线数据，再调用 hardware_read_gerber_layer_geometry。',
    '5. 在我确认固定区域和目标后，再进入下一步“生成改版意图”，不要直接生成修改文件。',
  ].join('\n')
}

export function HardwareProductionSection({
  workspacePath,
  workspaceRef,
  alwaysVisible = false,
  defaultExpanded = false,
}: {
  workspacePath: string
  workspaceRef: WorkspaceRef
  alwaysVisible?: boolean
  defaultExpanded?: boolean
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const openTab = useTabStore((s) => s.openTab)
  const createConversation = useAgentStore((s) => s.createConversation)
  const renameConversation = useAgentStore((s) => s.renameConversation)
  const setInput = useAgentStore((s) => s.setInput)
  const refreshDir = useFsStore((s) => s.refreshDir)
  const summary = useHardwareStore((s) => s.summary)
  const report = useHardwareStore((s) => s.report)
  const loading = useHardwareStore((s) => s.loading)
  const inspecting = useHardwareStore((s) => s.inspecting)
  const preparingFpcShapeContext = useHardwareStore((s) => s.preparingFpcShapeContext)
  const savingReport = useHardwareStore((s) => s.savingReport)
  const error = useHardwareStore((s) => s.error)
  const scanWorkspace = useHardwareStore((s) => s.scanWorkspace)
  const inspectProductionPackage = useHardwareStore((s) => s.inspectProductionPackage)
  const prepareFpcShapeContext = useHardwareStore((s) => s.prepareFpcShapeContext)
  const writeProductionReportMarkdown = useHardwareStore((s) => s.writeProductionReportMarkdown)
  const clear = useHardwareStore((s) => s.clear)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const workspaceKey = workspaceRefKey(workspaceRef)
  const sameWorkspace = summary?.workspacePath === workspacePath
  const hasHardwareSignals = sameWorkspace && summary.hasHardwareSignals

  useEffect(() => {
    void scanWorkspace(workspacePath)
    return () => clear()
  }, [workspacePath, scanWorkspace, clear])

  if (!alwaysVisible && !loading && !error && !sameWorkspace) return null
  if (!alwaysVisible && !loading && !error && sameWorkspace && !summary.hasHardwareSignals) {
    return null
  }

  const gerberCount = sameWorkspace ? summary.counts['gerber-package'] : 0
  const bomCount = sameWorkspace ? summary.counts.bom : 0
  const centroidCount = sameWorkspace ? summary.counts.centroid : 0
  const riskCount = report?.risks.length ?? summary?.risks.length ?? 0
  const primaryGerberPath =
    report?.gerber?.filePath ?? (sameWorkspace ? summary.primaryGerberPackage?.path : undefined)
  const outlineLayerCount = report?.gerber?.layerHints.outline.length ?? 0
  const copperLayerCount = report?.gerber?.layerHints.copper.length ?? 0
  const drillLayerCount = report?.gerber?.layerHints.drill.length ?? 0

  const writeReport = async (): Promise<string | null> => {
    const result = await writeProductionReportMarkdown(workspacePath)
    if (!result) return null
    await refreshDir(workspacePath).catch(() => undefined)
    openTab({
      type: 'editor',
      title: result.filePath.split('/').pop() ?? '硬件检查报告.md',
      icon: '📝',
      filePath: result.filePath,
    })
    return result.filePath
  }

  const openHardwareCheckSession = async (): Promise<void> => {
    const reportFilePath = await writeReport()
    const conversationId = createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef,
      },
      activate: true,
    })
    renameConversation(conversationId, '硬件生产检查')
    setInput(
      [
        '请基于当前硬件项目做生产前检查。',
        `工作空间：${workspacePath}`,
        reportFilePath ? `已有检查报告：${reportFilePath}` : '请先调用硬件检查工具生成报告。',
        '重点检查 Gerber、BOM、坐标文件、源工程缺失、位号不一致和嘉立创打样风险。',
        '不要自动下单、付款或修改电路板；所有高风险动作必须先让我确认。',
      ].join('\n'),
      conversationId,
    )
    openTab({
      type: 'conversation',
      title: '硬件生产检查',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef,
        },
        sessionId: conversationId,
      },
    })
  }

  const openFpcShapeSession = async (): Promise<void> => {
    const context = await prepareFpcShapeContext(workspacePath)
    if (!context) return
    const prompt = buildFpcShapeAgentPrompt(workspacePath, context)
    const conversationId = createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef,
      },
      activate: true,
    })
    renameConversation(conversationId, 'FPC 形状调整')
    openTab({
      type: 'conversation',
      title: 'FPC 形状调整',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef,
        },
        sessionId: conversationId,
      },
    })
    await createConversationRunController({ conversationId }).send(prompt)
  }

  const openGerberLayers = (): void => {
    if (!primaryGerberPath) return
    openTab({
      type: 'hardware-gerber',
      title: 'Gerber 层',
      icon: '🧩',
      hardwareGerber: {
        workspacePath,
        packagePath: primaryGerberPath,
      },
    })
  }

  return (
    <div
      className="sidebar-section hardware-production-section"
      data-context-target="production"
      tabIndex={-1}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!workspaceKey) return
        showContextMenu({
          target: { kind: 'production', workspaceKey, workspacePath },
          x: event.clientX,
          y: event.clientY,
          focusReturn: event.currentTarget,
        })
      }}
      onKeyDown={(event) => {
        if (!workspaceKey || !isContextMenuKeyboardEvent(event.nativeEvent)) return
        event.preventDefault()
        event.stopPropagation()
        showContextMenu(
          buildKeyboardContextMenuInput(
            { kind: 'production', workspaceKey, workspacePath },
            event.currentTarget,
          ),
        )
      }}
    >
      <button
        className={`sidebar-section-header sidebar-section-header-button ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        硬件生产
      </button>

      {!expanded && (
        <button
          className="project-panel-row project-panel-row-compact"
          onClick={() => setExpanded(true)}
          disabled={loading}
        >
          <IconMonitor size={14} />
          <span className="project-panel-row-main">
            <span className="project-panel-row-title">
              {loading ? '扫描硬件项目中' : hasHardwareSignals ? '检测到硬件生产文件' : '硬件扫描'}
            </span>
            <span className="project-panel-row-meta">
              {hasHardwareSignals
                ? `Gerber ${gerberCount} · BOM ${bomCount} · 坐标 ${centroidCount}`
                : '未发现硬件生产信号'}
            </span>
          </span>
        </button>
      )}

      {expanded && (
        <>
          <div className="project-panel-empty compact">
            {loading
              ? '正在扫描当前工作空间...'
              : hasHardwareSignals
                ? `Gerber ${gerberCount} · BOM ${bomCount} · 坐标 ${centroidCount} · 风险 ${riskCount}`
                : '当前工作空间暂未发现硬件生产文件'}
          </div>

          {report && (
            <div className={`hardware-report-status ${report.conclusion}`}>
              {conclusionLabel(report.conclusion)}
            </div>
          )}

          {report?.gerber && (
            <div className="hardware-layer-summary">
              <span>外形 {outlineLayerCount}</span>
              <span>铜层 {copperLayerCount}</span>
              <span>钻孔 {drillLayerCount}</span>
            </div>
          )}

          {(report?.risks ?? summary?.risks ?? []).slice(0, 4).map((risk) => (
            <div
              key={`${risk.level}:${risk.title}:${risk.detail}`}
              className={`hardware-risk ${risk.level}`}
            >
              <div className="hardware-risk-title">
                {riskLabel(risk.level)} · {risk.title}
              </div>
              <div className="hardware-risk-detail">{risk.detail}</div>
              <div className="hardware-risk-next">{risk.nextAction}</div>
            </div>
          ))}

          {error && <div className="project-panel-empty">{error}</div>}

          <div className="project-panel-quick-actions">
            <button
              className="project-panel-quick-action"
              onClick={() => void scanWorkspace(workspacePath)}
              disabled={loading || inspecting || savingReport}
              title="重新扫描硬件项目"
            >
              <IconRefresh size={14} />
              扫描
            </button>
            <button
              className="project-panel-quick-action"
              onClick={() => void inspectProductionPackage(workspacePath)}
              disabled={loading || inspecting || savingReport || !hasHardwareSignals}
              title="检查 Gerber / BOM / 坐标"
            >
              <IconFile size={14} />
              {inspecting ? '检查中' : '检查'}
            </button>
          </div>

          <div className="project-panel-quick-actions project-panel-quick-actions-single">
            <button
              className="project-panel-quick-action"
              onClick={() => void writeReport()}
              disabled={loading || inspecting || savingReport || !hasHardwareSignals}
              title="保存并打开硬件检查报告"
            >
              <IconFile size={14} />
              {savingReport ? '保存中' : '报告'}
            </button>
            <button
              className="project-panel-quick-action"
              onClick={() => void openFpcShapeSession()}
              disabled={
                loading ||
                inspecting ||
                savingReport ||
                preparingFpcShapeContext ||
                !hasHardwareSignals
              }
              title="准备 FPC 改形状上下文并交给 Agent"
            >
              <IconMonitor size={14} />
              {preparingFpcShapeContext ? '准备中' : '改形状'}
            </button>
            <button
              className="project-panel-quick-action"
              onClick={openGerberLayers}
              disabled={loading || inspecting || savingReport || !primaryGerberPath}
              title="查看 Gerber 层和原始内容"
            >
              <IconFile size={14} />层
            </button>
            <button
              className="project-panel-quick-action"
              onClick={() => void openHardwareCheckSession()}
              disabled={loading || inspecting || savingReport || !hasHardwareSignals}
              title="创建硬件生产检查会话"
            >
              <IconMonitor size={14} />
              会话
            </button>
          </div>
        </>
      )}
    </div>
  )
}
