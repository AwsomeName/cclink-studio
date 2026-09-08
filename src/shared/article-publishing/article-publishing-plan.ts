import type {
  ArticlePublishingResumePolicy,
  ArticlePublishingState,
} from './article-publishing-types'

export interface ArticlePublishingPlanStep {
  stepId: string
  label: string
  resumePolicy: ArticlePublishingResumePolicy
}

export const CSDN_ARTICLE_PUBLISHING_PLAN = [
  { stepId: 'open-editor', label: '打开 CSDN 编辑页', resumePolicy: 'reconcile-then-run' },
  { stepId: 'verify-account', label: '核验账号与页面', resumePolicy: 'reconcile-then-run' },
  { stepId: 'upload-assets', label: '上传并核验正文图片', resumePolicy: 'skip-if-verified' },
  { stepId: 'fill-body', label: '填写并核验正文', resumePolicy: 'reconcile-then-run' },
  { stepId: 'fill-fields', label: '填写平台字段', resumePolicy: 'reconcile-then-run' },
  { stepId: 'save-draft', label: '保存并复核草稿', resumePolicy: 'reconcile-then-run' },
  { stepId: 'publish', label: '执行常规单篇发布', resumePolicy: 'reconcile-then-run' },
  { stepId: 'verify-publication', label: '核验文章结果', resumePolicy: 'reconcile-then-run' },
] as const satisfies readonly ArticlePublishingPlanStep[]

export interface ArticlePublishingDetailDefinition {
  id: string
  checkpointId: string
  owner: 'Studio' | 'Agent' | '用户'
  action: string
  entry: string
  completion: string
  next: string
}

/** Definitions only. Results are written by WebAffair from real execution boundaries. */
export function articlePublishingDetailDefinitions(
  publishing: Pick<ArticlePublishingState, 'assets' | 'fields' | 'draft'>,
): ArticlePublishingDetailDefinition[] {
  const rows: ArticlePublishingDetailDefinition[] = []
  const add = (
    id: string,
    checkpointId: string,
    owner: ArticlePublishingDetailDefinition['owner'],
    action: string,
    entry: string,
    completion: string,
    next: string,
  ) => rows.push({ id, checkpointId, owner, action, entry, completion, next })
  add(
    'account.resolve',
    'open-editor',
    'Studio',
    '解析账号与登录 Profile',
    '任务已保存、账号未归档',
    '账号与唯一 Profile 已解析；复用已有登录',
    '取得可见账号 Tab',
  )
  add(
    'tab.acquire',
    'open-editor',
    'Studio',
    '取得当前工作空间的账号 Tab',
    '账号与 Profile 已解析',
    '可见 Tab 与账号、工作空间绑定一致',
    '按新建或恢复分支打开页面',
  )
  if (publishing.draft?.recovery) {
    add(
      'recovery.management',
      'open-editor',
      'Studio',
      '打开管理页与草稿箱',
      '原 draftId 存在、恢复租约有效',
      '读到受支持管理页及草稿箱入口',
      '核验管理页账号',
    )
    add(
      'recovery.account',
      'open-editor',
      'Studio',
      '核验管理页真实账号',
      '管理页可读',
      '真实账号等于原任务账号',
      '按原 draftId 定位，找不到即停止',
    )
    add(
      'recovery.locate',
      'open-editor',
      'Studio',
      '按原 draftId 找到唯一草稿',
      '管理页账号一致',
      '草稿箱唯一候选 ID 与原稿一致',
      '打开候选草稿',
    )
    add(
      'recovery.open',
      'open-editor',
      'Studio',
      '打开找到的原草稿',
      '唯一原稿候选',
      '实际导航完成',
      '复核账号、ID、标题、保存状态',
    )
    for (const [field, label] of [
      ['account', '账号'],
      ['id', 'draftId'],
      ['title', '标题'],
      ['saved', '保存状态'],
    ])
      add(
        `recovery.verify.${field}`,
        'open-editor',
        'Studio',
        `复核原稿${label}`,
        '原稿页面可读；改代后重新取证',
        `实际${label}与原任务一致`,
        '四项全部通过后准备 Runtime',
      )
  } else {
    add(
      'editor.open',
      'open-editor',
      'Studio',
      '打开新建编辑器',
      '本任务没有原 draftId 或未知首次保存',
      '导航到支持的新建入口',
      '检查账号和编辑区域',
    )
    for (const [target, label] of [
      ['title', '冻结标题'],
      ['body', '建稿短占位'],
      ['save', '首次保存'],
    ]) {
      add(
        `initial.${target}.dispatch`,
        'open-editor',
        'Agent',
        `派发${label}`,
        '当前页面检查通过；一次性副作用已预写',
        '派发闸门通过，动作结果仍待核验',
        '读取页面或首次保存响应；未知不重建',
      )
    }
    add(
      'initial.anchor',
      'open-editor',
      'Studio',
      '核验首次保存响应与新 draftId',
      '本任务首次保存已派发',
      '真实保存响应返回数字 ID，并从管理页复核原稿',
      '准备 Runtime 与后续正文步骤',
    )
  }
  add(
    'runtime.ready',
    'open-editor',
    'Studio',
    '绑定并核对 Runtime',
    '页面就绪；恢复时原稿已核验',
    'Agent/BrowserTask/View/Page 与写入许可一致',
    '首次只读检查；改代则重新绑定核验',
  )
  add(
    'page.inspect',
    'verify-account',
    'Studio',
    '读取当前页面账号与草稿事实',
    '当前精确 Runtime 已绑定',
    '适配器读回页面类型、账号、ID、标题和保存状态',
    '定位正文与平台字段',
  )
  add(
    'body.locate',
    'fill-body',
    'Studio',
    '定位正文编辑区域',
    '当前页面检查通过',
    '唯一受支持正文 selector 与对应 iframe 可读',
    '只允许向已定位的正文区域写入',
  )
  for (const asset of publishing.assets.filter((a) => a.kind === 'local')) {
    const name = `${asset.displayPath.split('/').pop()}（正文引用 ${asset.occurrences.length} 处）`
    add(
      `asset.${asset.id}.inspect`,
      'upload-assets',
      'Studio',
      `检查图片 ${name}`,
      '原草稿与当前页面证据有效',
      '该图片已核验、可上传或需人工对账',
      '已完成跳过；未知由用户确认存在/缺失',
    )
    add(
      `asset.${asset.id}.open`,
      'upload-assets',
      'Agent',
      `打开正文上传面板：${name}`,
      '当前账号、原稿与正文区域通过核验',
      'CSDN 正文上传面板已打开，唯一文件控件可用',
      '只选择该冻结文件；不使用封面或反馈上传入口',
    )
    add(
      `asset.${asset.id}.dispatch`,
      'upload-assets',
      'Agent',
      `上传图片 ${name}`,
      '此图片缺失已核验，上传授权已预写',
      '仅此资产上传已派发',
      '回读对应图片，不把工具返回当上传成功',
    )
    add(
      `asset.${asset.id}.verify`,
      'upload-assets',
      'Studio',
      `核验图片 ${name}`,
      '图片已上传或结果未知',
      '页面对应图片已读回，或用户明确确认存在',
      '下一张图；未知时显示图片供用户判断',
    )
  }
  add(
    'body.dispatch',
    'fill-body',
    'Agent',
    '填写完整正文',
    '图片已处理；正文区域与原草稿许可有效',
    '正文填写动作已派发',
    '等待正文回读与平台保存',
  )
  for (const asset of publishing.assets.filter((a) => a.kind === 'local')) {
    add(
      `asset.${asset.id}.placement`,
      'fill-body',
      'Studio',
      `核验正文位置与加载：${asset.displayPath.split('/').pop()}`,
      '完整正文已按冻结 Markdown 与已核验平台图片填写',
      '该图出现次数、顺序、前文位置、替代文字与原稿一致，且图片加载成功',
      '全部图片通过后核验正文保存；不一致时显示具体图片卡点',
    )
  }
  add(
    'body.verify',
    'fill-body',
    'Studio',
    '回读正文与平台保存',
    '正文填写已派发',
    '同稿正文非空、服务端与编辑器正文一致且已保存',
    '检查平台字段；未知时先对账不重填',
  )
  for (const [field, label] of [
    ['title', '标题'],
    ['summary', '摘要'],
    ['tags', '标签'],
    ['category', '分类'],
    ['cover', '封面'],
  ]) {
    add(
      `field.${field}.inspect`,
      'fill-fields',
      'Studio',
      `读取${label}`,
      '编辑器与账号核验通过',
      '读取唯一字段当前值；不支持时明确阻塞',
      '与冻结字段比较',
    )
    add(
      `field.${field}.dispatch`,
      'fill-fields',
      'Agent',
      `填写${label}`,
      '字段需要修改且当前 selector 有效',
      '此字段写入已派发',
      '回读同一字段',
    )
    add(
      `field.${field}.verify`,
      'fill-fields',
      'Studio',
      `核验${label}`,
      '已读取或填写该字段',
      '字段实际值与任务值一致',
      '下一字段；不匹配则停止字段完成回报',
    )
  }
  add(
    'save.dispatch',
    'save-draft',
    'Agent',
    '触发保存草稿',
    '字段已核验；无未知保存；已有自动保存可省略点击',
    '一次保存已派发，或已核验自动保存无需额外点击',
    '核验同稿保存结果',
  )
  add(
    'save.verify',
    'save-draft',
    'Studio',
    '核验保存结果',
    '保存已派发或需要对账',
    '原账号、draftId、标题与明确 saved 一致',
    '发布前复核，保存不代表发布',
  )
  add(
    'publish.preflight',
    'publish',
    'Studio',
    '复核发布目标与有界授权',
    '正文、图片、字段和保存已核验',
    '当前原稿和发布控件通过权限及副作用闸门',
    '只派发一次；人工专属卡点暂停',
  )
  add(
    'publish.dispatch',
    'publish',
    'Agent',
    '提交单篇发布',
    '具体账号、文章已获发布授权；预写凭证有效',
    '发布已派发，尚未确认公开结果',
    '只核验结果，不再次发布',
  )
  for (const asset of publishing.assets.filter((a) => a.kind === 'local')) {
    add(
      `asset.${asset.id}.published`,
      'verify-publication',
      'Studio',
      `核验公开页图片：${asset.displayPath.split('/').pop()}`,
      '已提交发布，只读打开同账号文章结果',
      '公开正文对应图片的地址、顺序、位置与加载结果核验通过',
      '全部图片与文章结果通过才完成；结果未知只核验，不重发',
    )
  }
  add(
    'publication.verify',
    'verify-publication',
    'Studio',
    '核验平台公开结果',
    '发布已派发或结果未知',
    '唯一公开文章的账号、标题和 URL 已核验',
    '完成事务；未知只查询管理页',
  )
  return rows
}
