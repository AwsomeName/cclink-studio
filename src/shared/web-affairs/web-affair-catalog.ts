import type { WebAffairCatalog } from './web-affair-types'

/**
 * Catalog entries are versioned hints. They never own affair instances or runtime state.
 * Unknown sites always retain the generic-web/human fallback.
 */
export const WEB_AFFAIR_CATALOG: WebAffairCatalog = {
  atomicNodes: [
    {
      id: 'requirements-check',
      version: 1,
      title: '确认办理要求',
      description: '核对主体、入口、截止时间、账号和结果判据。',
      nodeType: 'verification',
      executor: 'user',
      successCriteria: ['办理范围和主体已确认', '目标网站与账号已绑定'],
    },
    {
      id: 'material-preparation',
      version: 1,
      title: '准备并核对材料',
      description: '检查本地材料是否存在、是否变更以及是否需要人工确认。',
      nodeType: 'human-task',
      executor: 'user',
      successCriteria: ['所需材料均可用', '变更材料已经重新确认'],
    },
    {
      id: 'web-form',
      version: 1,
      title: '填写网页表单',
      description: '使用事务绑定的 Profile 进入目标网页并填写可撤销字段。',
      nodeType: 'web-task',
      executor: 'ai',
      successCriteria: ['页面字段与事务输入一致', '提交前已经重新读取页面状态'],
    },
    {
      id: 'final-confirmation',
      version: 1,
      title: '确认并提交',
      description: '展示主体、账号、URL、字段和文件，由用户确认不可逆提交。',
      nodeType: 'web-task',
      executor: 'user',
      successCriteria: ['用户已查看并确认最终动作', '提交结果有可验证证据'],
    },
    {
      id: 'external-review',
      version: 1,
      title: '等待外部审核',
      description: '结束当前运行，到期创建新的检查 Attempt。',
      nodeType: 'wait-external',
      executor: 'external',
      successCriteria: ['保存官方状态和观察时间', '通过、驳回或继续等待状态明确'],
    },
    {
      id: 'result-archive',
      version: 1,
      title: '归档结果证据',
      description: '保存回执、申请号或官方结果摘要。',
      nodeType: 'verification',
      executor: 'user',
      successCriteria: ['结果证据可追溯', '事务最终状态明确'],
    },
  ],
  templates: [
    {
      id: 'generic-web-affair',
      version: 1,
      title: '通用网页事务',
      description: '适用于未知网站的准备、填写、确认、等待与归档流程。',
      nodeCatalogIds: [
        'requirements-check',
        'material-preparation',
        'web-form',
        'final-confirmation',
        'external-review',
        'result-archive',
      ],
    },
    {
      id: 'web-query-and-verify',
      version: 1,
      title: '网页查询与核验',
      description: '适用于查询办理进度、核验状态并归档证据。',
      nodeCatalogIds: ['requirements-check', 'web-form', 'result-archive'],
    },
  ],
  adapters: [
    {
      id: 'generic-web',
      version: 1,
      originPattern: '*',
      capabilities: ['entry'],
      fallback: 'human',
    },
  ],
}
