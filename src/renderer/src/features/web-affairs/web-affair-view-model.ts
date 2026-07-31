import type {
  WebAffairNodeExecutor,
  WebAffairNodeStatus,
  WebAffairStatus,
} from '@shared/web-affairs/web-affair-types'

export const WEB_AFFAIR_CHANGED_EVENT = 'cclink:web-affair-changed'

export const WEB_AFFAIR_STATUS_LABELS: Record<WebAffairStatus, string> = {
  draft: '草稿',
  active: '处理中',
  'needs-attention': '需要我处理',
  'waiting-external': '等待外部',
  paused: '已暂停',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
}

export const WEB_AFFAIR_NODE_STATUS_LABELS: Record<WebAffairNodeStatus, string> = {
  blocked: '被前置步骤阻塞',
  ready: '待处理',
  running: '处理中',
  'waiting-human': '需要我处理',
  'waiting-external': '等待外部',
  verifying: '核验中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
}

export const WEB_AFFAIR_EXECUTOR_LABELS: Record<WebAffairNodeExecutor, string> = {
  ai: 'AI',
  user: '用户',
  external: '外部机构/平台',
}
