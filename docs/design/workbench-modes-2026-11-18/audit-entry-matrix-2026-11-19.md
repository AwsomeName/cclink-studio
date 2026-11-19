# 全量代码入口复核附表

基线 `7c54acaa`，首版提交 `8d45629e`，本轮整改工作树。以下检查存在性、路由和代码保留；不将静态存在性等同于业务成功。

## ActivityPanel：17 项

| 原 ID                | 核对结果                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| `workspace-home`     | WorkspaceHome 按类型路由；日记/公司实测，电子首页本轮补真实扫描。           |
| `projects`           | ProjectStrip 历史与 WorkspaceOpenSurface 保留。                             |
| `browser`            | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `files`              | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `data-sources`       | DataSourcesPanel 查询留工具；configuration 模式进设置。                     |
| `company-accounts`   | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `company-workspace`  | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `video-creation`     | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `production`         | 原 HardwareProductionSection 保留，并复用于工程首页；非电子类型仍可用。     |
| `terminal`           | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `operations`         | SettingsPage → 网站与账号复用 WebResourcesSidebar；Sidebar 旧路由兼容保留。 |
| `affairs`            | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `article-publishing` | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `sessions`           | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `agent-roles`        | SettingsPage → 角色复用 AgentRolesSidebar；会话挂载入口仍在。               |
| `scheduled-tasks`    | ActivityBar 工具/类型入口和 Sidebar 原路由保留；执行仍由原领域负责。        |
| `cclink`             | 打开项目远程来源、原工具入口和设置远程设备均可达；登录/设备未实测。         |

## TabType：24 项

| 原 ID                 | 核对结果                                                                                |
| --------------------- | --------------------------------------------------------------------------------------- |
| `workspace-home`      | 按 saved settings.type 路由日记/公司/电子/通用。                                        |
| `browser`             | 原生 WebContentsView 与 BrowserToolbar 保留；两版面真实网页验证。                       |
| `editor`              | 正文/源码共享 EditorStore；代码默认源码，Tab 保存打开方式；未保存正文重启恢复实测。     |
| `settings`            | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `preview`             | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `file-preview`        | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `android`             | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `model`               | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `conversation`        | 原 conversationTarget 路由到 WorkbenchAgentConversation；主工作区另一批会话修改待合并。 |
| `remote-conversation` | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `hardware-gerber`     | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `terminal`            | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `terminal-record`     | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `data-source-query`   | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `data-source-result`  | 原兼容类型没有独立内容渲染；实际结果仍在 DataSourceQueryTab。此次未宣称新增独立结果页。 |
| `scheduled-task`      | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `web-resource`        | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `web-affair`          | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `article-publishing`  | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `agent-role`          | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `remote-file`         | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `media-production`    | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `company-accounts`    | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |
| `company-workspace`   | WorkbenchContent 原内容路由保留；Tab/文档持久化仍由原 owner 负责。                      |

## 设置导航：12 项

| 原 ID                | 核对结果                                                   |
| -------------------- | ---------------------------------------------------------- |
| `appearance`         | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `editor`             | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `shortcuts`          | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `connections`        | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `agent-capabilities` | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `model-usage`        | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `components`         | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `browser`            | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `git-backup`         | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `cad`                | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `updates`            | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |
| `about`              | 原设置 section ID 与入口仍存在；新增配置分类没有删除此组。 |

新增设置组为当前项目、网站与账号、角色、数据源连接、远程设备、运行状态与诊断；不将新增分组数作为产品完成度。

## MCP：12 模块逐个与原实现比较

| 模块               | 字面量工具数 | 与基线的比较       | 运行验收范围                                       |
| ------------------ | ------------ | ------------------ | -------------------------------------------------- |
| `agent-device`     | 4            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `android`          | 14           | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `browser`          | 44           | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `cad`              | 8            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `data-source`      | 6            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `editor`           | 6            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `hardware`         | 5            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `image-generation` | 2            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `meshy`            | 5            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `scheduled-task`   | 3            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `web-affairs`      | 11           | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |
| `web-resources`    | 2            | 模块实现逐字节相同 | 工具声明和原注册边界保留；本轮未逐个调用实际执行。 |

## 命令、工作版面和执行 owner

- `bootstrap/commands` 原命令文件保留；公司命令补“当前公司优先”，其余入口迁移没有另建业务执行器。
- `WorkbenchContent.tsx` 本轮修改 editor 分支：Markdown 正文/源码与文本代码使用原两个编辑器；其他内容分发没有删分支。统一工具条位于 Workbench，TabBar 保留标准/专注布局；不再声明整个文件与基线逐字节相同。
- 硬件首页复用原扫描/检查服务。原 Hardware store 增加晚到结果的代次校验，仅保护 renderer 投影。
- 账户/角色/数据源/远程设置复用原组件和服务。凭证、调度、Agent、WebAffair 继续由原领域拥有。
- 关闭运行项目、真实远程、独立窗口和所有专业格式仍需专项真实执行验收；本表不会把“声明/分支保留”标成这些动作全部通过。

## 本轮生命周期补验

- ScheduledTask：原服务/账本/IPC/UI + 确定性模拟生成器，关闭标签/项目后返回原运行，退出后中断，显式重试保留旧历史。
- WebAffair：真实服务建立 waiting-human 节点，关闭/返回/重启不改变原节点 ID 或隐式执行。
- Terminal：真实本机 Shell，关闭视图保留、返回附着同一 session、显式终止。
- Agent：失败/中断会话在汇总可发现，筛选单测通过；真实模型长会话仍待外部集成验收。
- 专项原始结果与实际截图见 [补验报告](../../testing/typed-workspaces-followup-2026-11-19.md)。
