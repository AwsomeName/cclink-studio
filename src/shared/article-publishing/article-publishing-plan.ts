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

export const TOUTIAO_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label: (
    {
      'open-editor': '从头条草稿箱找回原微头条',
      'verify-account': '核验头条账号与原稿',
      'upload-assets': '逐图上传、确认插入并核验',
      'fill-body': '填写并回读微头条正文',
      'fill-fields': '核验首发、配乐与作品声明',
      'save-draft': '保存并重新核验原微头条',
      publish: '提交这篇微头条一次',
      'verify-publication': '核验微头条平台结果',
    } as Record<string, string>
  )[step.stepId],
}))

export const WEIBO_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label: (
    {
      'open-editor': '打开微博临时编辑器',
      'verify-account': '核验目标 UID 与空白现场',
      'upload-assets': '逐张上传并回读图集',
      'fill-body': '填写并回读微博正文',
      'fill-fields': '核验首行标题与现场',
      'save-draft': '检查当前图文（不代表平台已保存）',
      publish: '提交微博并读取回执',
      'verify-publication': '核验平台实际发布结果',
    } as Record<string, string>
  )[step.stepId],
}))

export const BILIBILI_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label: (
    {
      'open-editor': '打开 B站图文动态发布器',
      'verify-account': '核验 B站 UID 与当前空白现场',
      'upload-assets': '逐张选择、上传并核验动态图片',
      'fill-body': '填写正文并完整回读',
      'fill-fields': '填写独立标题并核验发布设置',
      'save-draft': '复核当前图文（不代表平台已保存）',
      publish: '单次发布 B站动态',
      'verify-publication': '核验动态 ID、作者、全文与逐图结果',
    } as Record<string, string>
  )[step.stepId],
}))

export const ZHIHU_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label:
    step.stepId === 'open-editor'
      ? '从知乎管理页找回原稿'
      : step.stepId === 'fill-fields'
        ? '核验知乎标题与发布设置'
        : step.stepId === 'save-draft'
          ? '核验知乎自动保存'
          : step.label,
}))

export const JUEJIN_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label:
    step.stepId === 'open-editor'
      ? '从掘金草稿箱找回原稿'
      : step.stepId === 'save-draft'
        ? '核验掘金自动保存'
        : step.label,
}))

export const XIAOHONGSHU_ARTICLE_PUBLISHING_PLAN = CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => ({
  ...step,
  label:
    step.stepId === 'open-editor'
      ? '找回小红书原账号本地草稿'
      : step.stepId === 'upload-assets'
        ? '逐张上传并核验笔记图集'
        : step.stepId === 'fill-fields'
          ? '核验小红书标题及公开设置'
          : step.stepId === 'save-draft'
            ? '核验本地自动保存与原笔记'
            : step.stepId === 'publish'
              ? '提交这篇图文笔记'
              : step.stepId === 'verify-publication'
                ? '核验笔记审核与公开结果'
                : step.label,
}))

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
  publishing: Pick<ArticlePublishingState, 'assets' | 'fields' | 'draft'> &
    Partial<Pick<ArticlePublishingState, 'adapterId'>>,
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
  if (publishing.draft?.recovery || publishing.draft?.platformDraftId) {
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
      publishing.adapterId !== 'csdn' ? 'Studio' : 'Agent',
      publishing.adapterId !== 'csdn'
        ? `定位正文图片上传控件：${name}`
        : `打开正文上传面板：${name}`,
      '当前账号、原稿与正文区域通过核验',
      '平台正文上传入口的唯一文件控件可用',
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
      ['xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(publishing.adapterId ?? 'csdn')
        ? '该图平台地址、图集出现次数和顺序与原稿对应，预览加载成功；图集不使用正文内位置或替代文字'
        : publishing.adapterId === 'zhihu'
          ? '该图平台地址、出现次数、顺序、前文位置与原稿一致，且图片加载成功（知乎不保留替代文字）'
          : '该图出现次数、顺序、前文位置、替代文字与原稿一致，且图片加载成功',
      '全部图片通过后核验正文保存；不一致时显示具体图片卡点',
    )
  }
  add(
    'body.verify',
    'fill-body',
    'Studio',
    '回读正文与平台保存',
    '正文填写已派发',
    publishing.adapterId === 'xiaohongshu'
      ? '同稿正文与平台本地草稿库回读一致；图集逐张核验通过'
      : '同稿正文非空、服务端与编辑器正文一致且已保存',
    '检查平台字段；未知时先对账不重填',
  )
  if (publishing.adapterId === 'juejin')
    add(
      'fields.open',
      'fill-fields',
      'Studio',
      '核验掘金发布设置面板',
      '正文及图片已核验',
      '分类、标签、摘要面板可见；未提交文章',
      '逐项核验平台字段，禁止提前点击确定并发布',
    )
  for (const [field, label] of ['zhihu', 'xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(
    publishing.adapterId ?? '',
  )
    ? [['title', '标题']]
    : [
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
    publishing.adapterId !== 'csdn' ? '确认自动保存，无需重复点击' : '触发保存草稿',
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
  if (publishing.adapterId === 'xiaohongshu')
    for (const row of rows) {
      row.action = row.action
        .replace('正文图片', '笔记图集图片')
        .replace('正文位置与加载', '图集顺序与加载')
        .replace('完整正文', '笔记正文')
      row.completion = row.completion
        .replace('位置、顺序、替代文字', '图集顺序')
        .replace('正文位置', '图集顺序')
      if (row.id === 'save.dispatch') {
        row.action = '确认平台本地自动保存，已保存则不再点击暂存离开'
        row.owner = 'Studio'
        row.completion = '本地库已保存同一稿件，无需额外点击；保存结果独立核验'
      }
      if (row.id === 'save.verify')
        row.completion = '同账号本地原稿 ID、标题、完整正文及图集回读一致'
    }
  if (publishing.adapterId === 'weibo' || publishing.adapterId === 'bilibili') {
    const omitted = /^(initial\.|recovery\.)/u
    for (let i = rows.length - 1; i >= 0; i--) if (omitted.test(rows[i].id)) rows.splice(i, 1)
    for (const row of rows) {
      row.entry = row.entry.replace(/原草稿/g, '当前编辑现场').replace(/原 draftId/g, '现场身份')
      row.next = row.next.replace(/平台保存/g, '当前正文回读').replace(/正文保存/g, '正文现场')
      if (row.id === 'page.inspect') {
        row.action = `读取${publishing.adapterId === 'bilibili' ? 'B站' : '微博'}真实 UID 与编辑器`
        row.completion = 'UID 与任务目标一致；正文区域唯一；图集可完整枚举'
      }
      if (row.id === 'body.verify') {
        row.action = '回读当前正文与图集'
        row.completion = '冻结正文与当前文本一致，每张图片地址、顺序与加载一致；不声明平台已保存'
      }
      if (row.id.endsWith('.placement')) {
        row.action = row.action.replace('正文位置', '图集顺序')
        row.completion = '该张图片平台地址、图集顺序与加载已回读核验'
      }
      if (row.id === 'save.dispatch') {
        row.owner = 'Studio'
        row.action = '确认此流程没有可核验的保存动作'
        row.entry = '正文和图集已核验'
        row.completion = '不派发保存，不编造草稿 ID 或 saved'
        row.next = '重新读取当前图文现场'
      }
      if (row.id === 'save.verify') {
        row.action = '复核当前图文现场'
        row.entry = '当前 UID 和 Runtime 一致'
        row.completion = '正文和逐图仍与冻结稿一致；页面关闭后不保证可恢复'
        row.next = '核对本任务提交授权'
      }
      if (row.id === 'publish.preflight') {
        row.entry = '当前图文已核验；具体提交动作已授权'
        row.completion = '本任务明确授权；同一 UID、冻结正文、逐图和公开设置均通过；从未派发提交'
      }
    }
  }
  if (publishing.adapterId === 'bilibili') {
    const dispatch = rows.find((row) => row.id === 'publish.dispatch')!
    dispatch.action = '点击原生发布入口一次'
    dispatch.completion = '入口已点击；可能打开首次规范弹窗，不等于已经提交'
    dispatch.next = '识别首次规范确认分支，或读取直接提交回执'
    add(
      'bilibili.agreement.inspect',
      'publish',
      'Studio',
      '识别首次动态规范确认分支',
      '本次授权发布入口已点击；同一 Runtime 与提交观察器仍有效',
      '读到原生规范 iframe、标题和唯一确认按钮，或已取得直接提交回执',
      '首次规范分支复核同稿后确认；已有提交请求时禁止再发送',
    )
    add(
      'bilibili.agreement.confirm',
      'publish',
      'Studio',
      '首次规范确认并发送',
      '实际存在原生规范弹窗；同账号、正文、标题、逐图复核通过；尚无提交请求',
      '唯一确认按钮已点击一次；不代表提交成功；无此分支时跳过',
      '读取同稿提交回执；取消、页面改代或结果未知时不得再次确认',
    )
    add(
      'bilibili.submission.observation',
      'publish',
      'Studio',
      '保留确认派发与请求观察事实',
      '本次发布入口的派发闸门已通过；观察器只属于当前操作',
      '主进程记录确认是否已尝试、是否观察到创建请求以及监听结束状态',
      '只在原 Runtime 与原观察器仍有效时继续；历史记录不授予重发权限',
    )
    add(
      'bilibili.submission.receipt',
      'publish',
      'Studio',
      '核验动态创建请求与平台回执',
      '已点击发布入口或首次确认；原生请求观察器已在点击前绑定',
      '唯一请求的正文、逐图地址和顺序对应，响应 code=0 且动态 ID 可核验',
      '只读打开该动态核验公开全文与逐图；无回执时保持未知，不重发',
    )
    add(
      'bilibili.visibility.verify',
      'fill-fields',
      'Studio',
      '读取动态可见范围的当前选中项',
      '同账号发布器；必要时 Agent 打开设置和可见范围菜单',
      '原生菜单所有用户可见为 is-active，且仅自己可见未选中；不是依据菜单文案存在',
      '不可读时打开当前签发的设置入口；私密或矛盾时停止，不能自动切换',
    )
    const nativeRows = rows.filter((row) => row.id.startsWith('bilibili.'))
    for (const row of nativeRows) rows.splice(rows.indexOf(row), 1)
    rows.splice(
      rows.findIndex((row) => row.id === 'save.dispatch'),
      0,
      ...nativeRows.filter((row) => row.checkpointId === 'fill-fields'),
    )
    rows.splice(
      rows.findIndex((row) => row.id === 'publish.dispatch') + 1,
      0,
      ...nativeRows.filter((row) => row.checkpointId === 'publish'),
    )
  }
  if (publishing.adapterId === 'toutiao') {
    for (const row of rows) {
      if (row.id.endsWith('.placement')) row.action = row.action.replace('正文位置', '图集顺序')
      if (row.id === 'save.dispatch') row.action = '点击存草稿一次'
      if (row.id === 'save.verify')
        row.completion =
          '从平台原稿回读同一账号、draftId、完整正文和逐图结果；不凭编辑器存在判断保存'
      if (row.id === 'body.verify') {
        row.action = '回读当前微头条正文与图集'
        row.completion = '冻结正文逐字一致；每张图的顺序、平台地址和加载结果可核验'
      }
    }
    for (const [field, label] of [
      ['exclusive', '头条首发'],
      ['music', '配乐'],
      ['declaration', '作品声明'],
    ]) {
      if (field === 'music')
        add(
          'toutiao.music.dispatch',
          'publish',
          'Agent',
          '关闭当前配乐选项',
          '最后保存或恢复完成；当前配乐已勾选，且 Studio 签发唯一关联标签',
          '关闭动作已返回；不等于配乐状态已核验',
          '回读原生复选框；已关闭时跳过点击，不能反向开启',
        )
      add(
        `toutiao.${field}.verify`,
        field === 'music' ? 'publish' : 'fill-fields',
        'Studio',
        field === 'declaration' ? '读取作品声明当前选择' : `读取并核验${label}`,
        field === 'music' ? '保存或恢复完成；每次提交前重新读取当前文档' : '原账号与草稿一致',
        field === 'music'
          ? '当前配乐 checked=false；不沿用保存前或上个文档的值'
          : field === 'declaration'
            ? '完整读到各声明选项的真实勾选状态，不替代作品真实性审核'
            : '读取控件实际状态；不可读或与任务要求冲突则停止',
        '设置未核验通过前禁止提交',
      )
    }
    const nativeRows = rows.filter((row) => row.id.startsWith('toutiao.'))
    for (const row of nativeRows) rows.splice(rows.indexOf(row), 1)
    rows.splice(
      rows.findIndex((row) => row.id === 'save.dispatch'),
      0,
      ...nativeRows.filter((row) => row.checkpointId === 'fill-fields'),
    )
    rows.splice(
      rows.findIndex((row) => row.id === 'publish.preflight'),
      0,
      ...nativeRows.filter((row) => row.checkpointId === 'publish'),
    )
  }
  return rows
}
