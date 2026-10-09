# 视频创作与硬件生产导航拆分方案

> 状态：代码实施完成，开发版自动验收通过；真人重启与正式安装版验收待执行。最后更新：2026-10-09。

## 结论

当前 Activity Bar 的“生产”入口同时渲染视频创作和硬件生产，这是一次为快速接入视频工作台而形成的领域混合，不是架构要求。最小修复是新增一个 renderer 级 `video-creation` 面板，将视频侧栏移入其中；现有 `production` ID 恢复并继续只代表硬件生产。

最终导航在“流程”分组中显示两个独立入口：

| 内部 ID          | 完整名称 | 短标签 | 图标             | 侧栏内容                    |
| ---------------- | -------- | ------ | ---------------- | --------------------------- |
| `video-creation` | 视频创作 | 视频   | 摄像机或场记板   | `PromotionalVideoSidebar`   |
| `production`     | 硬件生产 | 硬件   | 现有芯片检查图标 | `HardwareProductionSection` |

不保留“生产”总入口，也不在同一侧栏内增加“视频／硬件”二级切换。

## 用户验收动作

只有用户在真实 Studio 中完成以下动作，才能声明拆分完成：

1. 打开同时包含 Markdown 和硬件文件的本地工作空间。
2. 点击“视频”，只看到视频工程创建、参数和已有工程；从 Markdown 创建工程并在原生 Tab 打开。
3. 点击“硬件”，只看到硬件扫描、生产包检查、FPC 准备和本地报告。
4. 确认视频入口不触发硬件扫描，硬件入口不加载视频工程列表。
5. 分别停留在“视频”和“硬件”后重启 Studio，恢复到对应侧栏。
6. 在未归档和远程工作空间点击两个入口，看到各自准确的本地工作空间降级提示。
7. 缩短窗口后可以滚动到“视频”和“硬件”，底部“设置”仍可到达。
8. 鼠标右键和 `Shift+F10` 可以打开两个入口的通用 Activity 菜单。
9. 打开内嵌浏览器，确认增加一个入口未破坏原生 View 的边界和顶部保护线。

## 最小实现范围

### Activity Bar

- 在 `ActivityPanel` 中新增 `video-creation`。
- 将 `video-creation` 加入 UI Store 的可见面板允许列表。
- “流程”分组新增“视频”；现有 `production` 的用户名称由“生产”改为“硬件生产”，短标签为“硬件”。
- 为视频新增一枚语义明确的图标；硬件继续使用现有芯片检查图标。
- 更新通用 Activity 命令标签，使鼠标和键盘上下文菜单可以打开两个面板。

### Sidebar

- 新增 `VideoCreationSidebarView`，只渲染 `PromotionalVideoSidebar`。
- 保留 `ProductionSidebarView` 名称并收敛为硬件侧栏，只渲染 `HardwareProductionSection`；不借拆分重命名既有组件。
- 硬件组件继续使用 `alwaysVisible` 和 `defaultExpanded`，避免入口打开后默认折叠或因未识别信号而没有内容。
- 侧栏标题分别为“视频创作”和“硬件生产”。
- 两个入口分别提供准确的非本地工作空间提示，不再共享“未归档不启用生产检测”。

### 状态与兼容

- 保留 `production` ID 给硬件，避免迁移硬件 Context Target、命令和旧工作空间布局状态。
- 旧快照中的 `activePanel: "production"` 升级后仍打开硬件生产，符合该 ID 的原始语义。
- 新快照可以保存并恢复 `activePanel: "video-creation"`。
- 不根据现有 `production` 快照猜测用户上次想看视频还是硬件；系统没有可靠证据。视频工程不会丢失，用户可从新入口继续打开。

### 上下文操作

- `production` Context Target、`production.scan`、`production.inspect`、`production.writeReport` 和 `production.copyStatus` 全部保持硬件专用。
- 视频入口仅使用已有 Activity 通用命令：打开面板、隐藏侧栏、右键与 `Shift+F10`。
- 本轮不新增视频领域 Context Target，不新增“新建视频工程”命令，也不扩展右键菜单框架。

### 明确不改

- 不修改 `.cclink-studio/media-projects/<id>/`、视频工程 Schema 或已有工程数据。
- 不修改 `media-production` Tab 类型、视频 Provider、素材、口播、FFmpeg 或渲染服务。
- 不修改硬件 Store、主进程硬件服务、IPC、MCP 工具或生产报告格式。
- 不新增主进程服务、preload API、权限、持久化文件或 ADR。
- 不借机重排全部 Activity Bar、创建第四个分组、重构 Sidebar 注册框架或重命名媒体领域代码。

## 状态所有权与生命周期

`useUIStore` 继续唯一拥有当前 Activity 面板和侧栏显隐；拆分只增加一个受校验枚举值，不创建第二状态所有者。视频工程继续由 `MediaProjectService` 拥有，硬件扫描继续由现有硬件 Store 和主进程服务拥有。

组件生命周期随入口分离：打开视频入口时不挂载 `HardwareProductionSection`，因此不执行硬件扫描；打开硬件入口时不挂载 `PromotionalVideoSidebar`，因此不订阅或读取视频工程。任一模块失败只影响自身侧栏。

权限面、人工确认点和诊断边界均不变化。视频付费任务、外部素材和硬件下单仍遵守各自原有边界；本次导航拆分不授权任何外部副作用。

## 失败与降级

- 本地工作空间没有硬件信号：硬件侧栏显示扫描结果和提示，不隐藏或替换成视频入口。
- 未归档或远程工作空间：视频提示“视频工程需要本地工作空间”；硬件提示“硬件生产检查需要本地项目文件”。
- 旧布局值无法识别：继续使用 UI Store 现有安全默认值“文件”，不增加新的猜测逻辑。
- 小窗口空间不足：Activity Bar 主区滚动，设置区固定；不缩小到低于 11px 字号。

## 验证与交付门禁

用户功能验证：

- 真实 Electron 中完成本文件“用户验收动作”的 1–9 项，并保存深色、浅色和短窗口截图。
- 运行现有宣发视频专项 smoke，证明创建、保存和重开工程的入口变化没有破坏视频闭环。
- 从新“视频”入口打开 `490501cf` 初版 Schema 形态的视频工程夹具；夹具不含后来新增的 `assets`、`renderSettings` 和 `narration` 字段，以证明真实历史格式不需要迁移即可打开。
- 在“硬件”入口完成真实扫描、检查并写出本地报告，不能只断言组件存在。
- 使用真实 Browser `WebContentsView` 精确比对 renderer 上报区域和原生 View 的 x、y、width、height，并验证顶部保护线；mock 单测不能替代这项检查。

工程准备度：

- Activity Bar 顺序、完整名称、短标签和入口数量测试。
- UI Store 对 `video-creation` 的设置、持久化、工作空间恢复及旧 `production` 兼容测试。
- Sidebar 分流和非本地工作空间降级测试。
- Shell Context Action 对两个 Activity ID 的打开行为测试；现有硬件 `production` Context Target 测试必须保持通过。
- TypeScript、相关 ESLint、定向 Vitest、Activity Bar smoke、媒体生产 smoke 和上下文操作边界检查通过。

未完成真实 Electron 用户动作时，只能声明代码和自动门禁通过，不能声明产品拆分完成。正式安装版未发布时，必须明确用户只能在源码开发版验收。

## 最小性拷问

实施前由独立会话回答以下问题：

1. 是否只需新增一个 `ActivityPanel` 值，而不需要新增 IPC、Schema、主进程服务或持久化格式？
2. 是否有证据要求重命名内部 `production` ID？若没有，应保留它以避免迁移硬件命令和旧布局。
3. 是否能通过条件渲染完成侧栏分离，而不引入通用插件注册、第二 Sidebar owner 或新路由框架？
4. 新视频 Context Target 是否有本轮不可替代的用户动作？若没有，应拒绝新增。
5. 是否误把导航整理扩张成视频工作台、硬件流程或 Activity Bar 的全面重构？
6. 旧 `production` 快照恢复到硬件是否保留了原始语义且不丢数据？
7. 新增入口是否让短窗口或 Browser 原生 View 回归？是否有真实 Electron 证据？

独立审查结论为“需要小幅收缩后实施，整体方案成立”。审查要求已经纳入：不重命名
`ProductionSidebarView`，保留硬件 `alwaysVisible + defaultExpanded`，不扩张无 Markdown 空状态，
并补充初版视频工程格式、硬件扫描/报告以及精确 Browser 原生 View 边界验收。

如果审查发现完成拆分必须触及上述“明确不改”范围，应先提供具体阻塞证据，重新评估方案；不得以顺手重构为理由扩大施工面。

## 实施结果（2026-10-09）

用户功能进度：

- Activity Bar 已显示独立的“视频”和“硬件”入口；视频入口只挂载视频工程侧栏，硬件入口只挂载硬件生产侧栏。
- 真实 Electron smoke 已从“视频”入口列出并打开源自 `490501cf` 的初版 Schema 夹具（不含 `assets`、`renderSettings`、`narration`）；随后在“硬件”入口识别 Gerber 与 BOM、执行检查并写出本地 Markdown 报告。
- 深色、浅色和短窗口证据图已保存到 `docs/design/activity-bar-short-labels/`。
- 真实 Browser `WebContentsView` 的 x、y、width、height 已与 workbench DOM 区域逐项比对，误差不超过 1px，顶部保护线有效。
- 尚未在正式安装版中由真人完成“分别停留在视频／硬件后完整退出并重启 Studio”的验收，因此不把正式产品验收写成已完成。

工程准备度：

- 实现仅修改 renderer 类型、UI Store、Activity Bar、Sidebar、通用上下文命令标签及对应测试；未新增 IPC、Schema、主进程服务、权限、视频 Context Target 或数据迁移。
- 保留 `ProductionSidebarView`、`production` 硬件 Context Target，以及硬件组件的 `alwaysVisible + defaultExpanded`。
- 定向 Vitest、Web TypeScript、相关 ESLint、上下文操作边界检查、Activity Bar 真实 Electron smoke、媒体生产 smoke 和完整 workflow smoke（21/21）均已通过。
