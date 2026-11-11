# ADR 0022：本地新会话默认 Codex，保留 Claude Code

- 状态：accepted（用户明确要求；真实验收结果另记）
- 日期：2026-11-10
- 取代 ADR 0012 中 Claude 必备启动基线、新会话默认 Claude 及禁止复用本机 Codex 文件登录的条款。

## 用户验收

打开本地工作空间，新建会话看到 Codex，发送消息得到真实流式回复；通过 Studio 工具读取工作空间文件；取消运行后可继续；重启可恢复会话。新建空会话可选择 Claude Code，继续仅使用 Studio 的 Claude API Key。旧会话不自动换引擎。

## 决策与边界

使用本机官方 `codex app-server` 的 stdio 接口，增加固定 `local-codex` backend，不扩展任意 Agent Registry。复用现有 Thread、AgentRuntime、run、权限 broker 和 MCP ToolHost；Codex thread ID 只是受主进程信任记录约束的恢复引用。旧 ACP 绑定仍可读取，不静默迁移。

新会话的选择器只提供 Codex（默认）与 Claude Code（备选），不再提供 Codex ACP。
历史 ACP 会话仍显示真实绑定；尚未建立原生 Session 的失败会话可主动切换为 Codex。
从主进程接受发送、开始准备运行起，既有 run 所有权即禁止重叠发送或恢复请求替换后端，
不能等到后端进程连接后才锁定。

Codex 自己读取本机文件登录；Studio 不复制或展示 token，不修改全局配置、不执行登录/退出。强制文件凭证存储，macOS 子进程拒绝访问系统钥匙串和本机 Claude 凭证。已有 Codex 登录只存在钥匙串时明确失败，不能迁移钥匙串。外部 MCP、插件、hooks、原生浏览器和自动多 Agent 不继承到 Studio 运行；只接受当前运行的 Studio MCP 会话。权限不允许扩大为 Full Access 或持久策略批准。

账号来源进一步限定为 Codex 的 ChatGPT 文件登录与官方 OpenAI 提供商：清理继承的 API Key
和 API 端点环境变量，启动前检查实际账号类型和有效配置，不接受 API Key、免认证提供商或
自定义认证端点。原生线程返回的提供商也必须为 OpenAI。检查失败只停止 Studio 的运行，
不通过强制登录参数、logout 或修改配置来切换本机账号。桌面 App 当前所选账号与这份文件
登录是否一致必须另行核对，不能仅凭 CLI 存在就声称一致。

默认选择影响新本地交互会话，以及每次创建独立会话的本地定时任务运行（2026-11-11 补齐）。
定时任务复用 `NEW_LOCAL_AGENT_RUNTIME_BINDING`，不继承当前聊天 Tab 的引擎，不修改任务定义、
revision、digest 或历史运行。旧聊天数据缺失绑定继续解释为 Claude Code。Claude 缺失或未配置
Key 只影响 Claude 会话；显式选择 Codex 的聊天不自动切换账号。用户随后授权自主任务自动
选择可用 Agent；定时任务和其他 main-owned 新任务按 [ADR 0023](0023-automatic-task-agent-selection.md)
在执行前选择 Codex 或已配置的 Claude，并记录选择原因。非 Agent 工作台保持可用。定时任务仍禁用原生工具，只开放受资源路径校验的
`editor_read/list`，产物由 Studio 创建和核验；调度和启用状态仍由 `ScheduledTaskService` 拥有。

首次启动失败且尚未建立原生 Session 的会话允许用户主动重选 Agent，保留失败消息和历史。
UI 与主进程分别验证可切换条件，已有 Session 或活动运行仍禁止迁移。安装与登录诊断复用
同一个原生启动入口，仅执行有界的只读探测；不通过探测发送模型请求或修改登录。

进程、请求计时器、MCP session、流监听均按 run 创建并在完成、失败、取消时销毁；重启由既有会话信任记录校验再恢复。诊断不输出环境、凭证或原始 app-server stderr。验证覆盖真实本机 Codex、真实 Electron、工具授权拒绝、取消、恢复、旧绑定和 Claude 隔离回归。发布与其他平台真实验收不在本轮范围。
