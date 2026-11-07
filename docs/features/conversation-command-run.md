# 本地 Claude 消息命令运行

## 用户验收目标

用户在本地 Claude 对话的命令代码块点击“运行”，无需自己创建 Terminal 或粘贴命令：

1. `pwd` 在消息所属工作空间目录执行，保持当前工作台不变；“查看终端”可以接回原进程。
2. 长命令通过既有权限确认后在后台继续输出；切换视图不会终止进程。
3. `read`、`sudo` 等已知交互命令自动打开 Terminal；运行时出现密码、输入或选择提示也会打开对应 Terminal。
4. 用户在真实 Terminal 中输入并继续程序；密码原始键盘输入不持久化，也不发送给 Agent。
5. 重复点击、消息重渲染、renderer 重载不会重新执行同一个代码块；原 session 可继续查看。
6. 用户拒绝、启动失败或工作空间目录失效时，明确显示原因，不能在其他目录执行。

## 实现边界

- 只向绑定本地工作空间的 Claude 会话提供入口；远程会话、Codex ACP、全局无目录会话不开放。
- 支持闭合的 `sh/bash/zsh/shell` fence；无语言标签及缩进代码块只保守识别常见命令开头。
  非 shell 代码、控制字符、超长命令、未闭合 fence 不运行；消息生成中禁用按钮。
- 工具栏调用唯一 `terminal.runConversationCodeBlock` command。动作重新从消息定位代码块，
  不把来自按钮的命令字符串当成事实源。归属与 cwd 来自该会话，不读取当前 Terminal 的 cwd。
- 使用既有生命周期登记、`submitCommand`、权限确认、PTY adapter 和审计，不增加后台执行服务。
  `TerminalSessionRegistry/TerminalSessionStore` 拥有执行状态与代码块来源；renderer 只缓存投影。
- 一个代码块关联一个专用 session。并发提交在主进程拒绝；已启动的代码块按钮变为“查看终端”。
  不向其他正在运行的交互终端注入命令。拒绝确认的 idle session 可以再次请求运行。
- 消息入口至少采用本地风险确认策略，保留更严格的只读/逐条确认和 denylist。
  多行、shell 替换等简化分类器不能证明只读的代码走 unknown 确认。
- 执行前及确认后核验目录；代码块命令不得静默截断。多行命令作为一个 shell 输入提交。
- Terminal 视图挂载只 attach 已获准启动的消息 session，不能绕过命令确认启动它。
- 关闭视图与终止进程继续复用 Terminal 的既有规则；App 重启后的旧 session 只作为记录查看。
  不自动重跑，不自动恢复 Agent 的后续任务。

## 可观测性和限制

“查看终端”只表示已有执行现场，不表示命令成功。命令、来源、工作空间、权限、输出和
启动错误可从 Terminal session/审计核验；不会把 PTY 存活误认为命令成功。

自动接管由已知交互命令或输出中的常见提示触发，只改变视图，不代填输入或接受协议。
任意程序的自定义无提示输入等待无法由 PTY 输出可靠推断，此时用户仍可点“查看终端”接管。
如果用户已切换到其他工作空间，只通知其切回查看，不强制切换或将命令迁移到当前工作空间。

## 验证入口

- 真实 Electron UI + 真实 PTY：`node scripts/conversation-command-smoke.mjs`。
- 该脚本使用隔离 App profile、临时工作空间和固定 Claude 消息样本，点击真实按钮并输入，
  不 mock Terminal/IPC，也不修改用户的 Claude 凭证或接受真实系统许可。
- 交互程序覆盖普通输入和关闭回显的密码输入；验收不要求提供系统密码。
- 自动化证据和人工视图复核结果记录在本次交付说明中。

## 2026-11-07 验收记录

隔离的真实 Studio 窗口、生产 IPC 和本地 PTY 验收通过；消息采用固定样本，不调用付费模型。
以下均由实际 UI 点击/终端输入及主进程 session 记录交叉核验：

| 用户操作 | 实测结果 |
| --- | --- |
| 查看生成中、未闭合及 TypeScript 代码块 | 不允许运行 |
| 双击 `pwd`，再点“查看终端” | 只启动一次，在对话目录执行，后台不抢视图，接回同一 PTY |
| 运行持续输出的 Python 程序并允许一次 | 后台输出完成，当前视图不切换 |
| 程序运行后输出 `Enter code:` | 自动展示 Terminal，键盘输入 `READY` 后得到 `ACK=READY` |
| 程序用 `getpass` 请求密码 | 自动展示 Terminal，输入后继续；session 记录不含原始密码 |
| 运行没有提示文字的 `read` | 自动打开 Terminal，输入后继续 |
| 拒绝写入命令 | 没有创建进程或执行命令 |
| 权限等待期间移走工作空间目录，再允许 | 启动失败、无进程，不回退到其他目录；显示失败原因 |
| 重载 renderer 后查看原代码块 | 恢复原 session，命令历史仍只有一次 |

工程门禁：24 个受影响测试文件、158 项测试通过；TypeScript、受影响 ESLint、
上下文操作边界和 `git diff --check` 通过。未进行正式打包发布。

截图保存在本机 `.cache/acceptance/conversation-command-run-2026-11-07/`，
包括 `background-command.png`、`interactive-command.png`、`failed-command.png` 和
`verified-studio.png`。界面截图已检查；本轮没有输入真实系统密码或接受 Xcode 许可协议。

### 提交前复核

在独立工作树复核本命令功能与同批保存状态修改：边界、格式、Lint 通过，
全量 429 个测试文件、3,642 项测试通过、10 项跳过，web/node 类型检查和构建通过。
全量门禁发现工具栏专用命令误放菜单目录后，已移至既有 Agent bootstrap；
保留 context-only 及菜单 owner 的严格维护校验，未新增菜单或权限。

重新执行真实 Electron + PTY 的 9 项烟测全部通过，证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-command-run-smoke-oJtuM6`。
首次复核无提示 read 用例过早以 PTY running 判断视图已激活；测试改为等待目标 Tab
及真实 xterm 输入框出现，再核对自动展示与实际键盘输入。产品的启动、权限和视图逻辑
没有因此改写，超时仍失败，没有注入等待后伪造成功。
Markdown 保存状态的独立验收及已知定时任务草稿缺陷见 `document-autosave.md`。
本次不代表远程、ACP 或任意自定义交互提示识别已通过，不自动运行消息命令。
