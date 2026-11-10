# 默认本地 Codex 验收

日期：2026-11-10。实现决策见 [ADR 0022](../decisions/0022-codex-default-local-runtime.md)。

## 用户功能进度

本机真实 Electron + 已安装的 Codex 已验证新会话默认选择、流式对话、Studio 工具读写、同一原生
Session 重启恢复、停止后继续发送，以及 Claude Code 备选入口。没有发布安装包，另一台电脑
仍需安装包含这些修改的版本。浏览器、Android、数据源等完整业务流程未在本轮逐项验收。

真人可执行步骤：

1. 打开 Studio 的一个本地工作空间，新建会话；输入框的 Agent 选择器应显示 Codex。
2. 在工作空间准备 `marker.md`，让 Agent 通过 Studio 工具读取，再创建 `result.md`；核对文件内容。
3. 关闭并重启 Studio，继续询问上一轮内容；保持原会话与 Codex 绑定。
4. 让 Agent 输出较长回答，点击停止；停止完成后发送一条新消息，应正常回复。
5. 新建空会话，在 Agent 选择器中选择「Claude Code（备选）」。配置 Studio 的 Claude API Key
   后可使用；缺少或无效 Key 应报错，不回退到本机 Claude 订阅。首条消息后绑定锁定，已有
   Claude 会话不自动迁移为 Codex。

实际验收使用 Playwright 操作真实 Studio 窗口、真实本机 Codex 模型调用和独立临时工作空间，
不是 mock Agent。目录选择器返回测试文件夹，后续读写经过实际工作空间授权链路。

| 场景                   | 实际结果                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| 新建本地会话           | Codex 默认被选中；原生流式回复成功                                |
| Studio MCP 读写        | `editor_read` 读取固定标记，`editor_write` 创建文件且磁盘内容正确 |
| 重启恢复               | 原生 Codex thread ID 完全一致；继续回复前文标记                   |
| 停止与后续发送         | 真实回答被取消，run 进入 cancelled，后续消息成功                  |
| Claude 备选            | 空会话可选择；认证隔离 UI 回归另行通过                            |
| 拒绝原生命令及补丁删除 | 请求进入 Studio 权限 broker，被拒绝后测试文件仍存在               |

UI 证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-ui-uJC9Ly`。
包含 `result.json`、`codex-read.png`、`claude-choice.png` 和重启前后测试事件。
Claude 回归见 [Claude 登录隔离](claude-auth-isolation.md)。

## 工程准备度

- 本机验证版本：`codex-cli 0.167.0-alpha.3.2`，macOS arm64。
- 全量单测基线：437 个文件通过，3712 项通过、12 项跳过；随后新增的恢复状态与配置隔离用例
  按受影响范围复跑。真实 Codex smoke 额外执行，不计入默认跳过项的验证结果。
- 真实后端验证涵盖 Studio MCP、销毁并重建 backend 后恢复、命令删除拒绝、补丁删除拒绝。
- 生命周期用例覆盖无登录、外部 MCP、作用域收窄、过期审批、停止清理和恢复失败不换 Session。
- 启动期间其他 Agent 的状态指纹不能清空已保存的 Codex Session；更改 Claude 凭证不能撤销
  Codex 的主进程 Session 信任记录。同一 Runtime 的不兼容指纹仍使旧 Session 失效。
- 类型检查、构建、ESLint、凭证边界与上下文操作边界检查通过。

复跑（真实 Codex 调用会消耗当前账号额度）：

```bash
CCLINK_CODEX_REAL_SMOKE=1 pnpm exec vitest run src/main/agent-core/backends/local-codex-backend.test.ts
pnpm build
node scripts/codex-default-ui-smoke.mjs
node scripts/claude-auth-isolation-ui-smoke.mjs
```

## 边界与未完成项

Codex 自己使用本机文件登录和模型配置，并保存原生 Session。Studio 不复制登录 token、不修改
全局配置、不执行登录或退出。因此它与本机 Codex 共用账号额度和原生会话目录，不承诺对其他
同用户进程不可见。它不读取 Claude 订阅登录。只有钥匙串登录、缺少 CLI 或不兼容权限策略时
明确失败，不静默切换 Claude，也不降低保护条件。

### 同日复查

- 按实际 Studio 启动代码调用 `account/read`：账号类型 `chatgpt`，凭证存储 `file`，提供商
  `openai`，无 API Key/自定义 API 端点环境变量，无 CODEX_HOME 覆盖。没有读取或输出 token。
- 这证明当前使用本机 Codex 的 ChatGPT 文件登录；桌面 App 的账号界面被工具访问限制阻止，
  未直接比对当前选中的桌面账号。不能把两者无条件等同。[官方认证文档](https://learn.chatgpt.com/docs/auth)
  区分文件、钥匙串及进程内凭证，因此其他电脑仍需按实际登录来源验收。
- 修正认证范围：默认后端只接受 ChatGPT 登录、官方提供商与官方账号端点；继承的
  `OPENAI_API_KEY`、`CODEX_API_KEY`、`OPENAI_BASE_URL` 被移除。API Key/自定义提供商
  明确失败，不通过修改全局登录来纠正。
- 修正原生补丁路径检查遗漏：同时验证源路径与重命名目标，解析符号链接，批准前再次校验。
  工作空间外目标、符号链接逃逸和未知补丁类型均拒绝。
- 真实后端复跑通过；删除审批用例已改用产品默认的 `auto-except-destructive` 模式。
  同时补测替代认证拒绝、默认模式删除确认，以及真实目录和符号链接路径边界。
- 复查后 96 项受影响测试通过，真实后端 smoke 3 项通过；真实 Electron 的默认选择、读写、
  同一原生 Session 重启恢复、停止再发送与 Claude 备选均再次通过。窗口证据目录：
  `/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-ui-dsSnUc`。

### DeepSeek 备用配置交叉验收

随后在真实窗口保存 DeepSeek API Key 并切换 Claude Code，验证了连接测试、Studio 文件
读写及相同原生 Session 重启恢复。保存和清除 Claude Key 均不改变新会话的 Codex 默认值；
配置期间 Codex 实际读取文件成功，清除后仍正常回答。

此轮发现并修复了 editor_read 错误路径参数被静默忽略导致超时的问题；真实 Codex 已验证
即时错误提示后的参数纠正和成功读取。没有改变文件访问权限或 Claude 的认证隔离。
完整步骤、原始事件与断言修正说明见 [真实 DeepSeek 验收](claude-auth-isolation.md#同日真实-deepseek-备用方案验收)。

手动压缩和运行中补充尚未开放；原生模型的自动上下文管理仍由 Codex 负责。其他平台和不同
Codex 版本未经本轮真实验收。权限策略返回值与 MCP 隔离在每次 run 启动时校验，失败即停止。
严格确认模式仅开放 Studio MCP 工具，禁用会自行放行可信只读命令的 Codex 原生执行器；
需要原生命令的严格确认任务使用 Claude Code 备选。权限模式切换须等当前运行结束，或先停止；
不会在原生执行器仍使用旧策略时显示已应用新策略。

集成接口依据 [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。原生补丁在
`untrusted` 策略下请求用户授权的行为同时以真实拒绝用例和
[官方实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/safety.rs)核对。

### 同日新会话 MCP HTTP 502 回归

用户在 0.1.136 新建本地 Codex 会话时，`thread/start` 因 `cclink_studio` 的 initialize
请求返回 HTTP 502 失败。Studio MCP 本身没有 502 响应路径；真实 app-server 在继承 HTTP
代理且 `NO_PROXY/no_proxy` 未包含 loopback 时复现了相同错误。当前系统代理单独使用时未复现；
未取得故障发生时安装版进程的环境快照，因此不能断言当时具体由哪个启动器注入代理。

修复仅在 `codexEnvironment()` 返回的子进程环境中合并两种大小写的现有排除项，补齐
`127.0.0.1,localhost,::1`，并同时设置 `NO_PROXY/no_proxy`。保留模型服务所用代理，不修改
系统设置或全局 Codex 配置，不关闭 Studio MCP、不放宽权限，也不切换认证或 Runtime。

用户功能验收：在真实 Electron 启动环境中显式设置 HTTP/HTTPS/ALL_PROXY 为本机现有代理，
两种 `no_proxy` 均故意遗漏 loopback，执行以下步骤：

1. 打开临时本地工作空间并新建 Codex 会话，让它通过 `editor_read` 读取 `marker.md`。
   实际返回 `STUDIO_CODEX_UI_8624`，界面显示工具完成。
2. 通过 `editor_write` 创建 `result.md`，磁盘内容包含 `CODEX_WRITE_OK`。
3. 重启后继续询问前文，原生 thread ID 相同，正确回答上一轮写入标记。
4. 停止正在输出的回复，再发送消息；取消状态及后续回复均正常。

真实窗口 smoke 全部通过，证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-ui-Eovkeg`，包含截图、事件与
`result.json`。这是源码构建的验收结果；本次未发布或替换用户已安装的 0.1.136。

工程验证：6 项代理用例（其中 2 项使用真实 app-server 与 ToolHost、无模型调用）、12 项
生命周期用例和 2 项后端单元测试通过；原有完整真实后端用例未重复执行。代理回归先在旧代码
复现 HTTP 502，修复后完成真实握手和工具发现，故障代理收到的 loopback 请求为零。类型检查、
构建、受影响文件 ESLint/格式检查与凭证边界检查通过。

同一工作区另有并行的 Codex 诊断修改，因此以上构建和窗口验收在 `7379831c` 加本次代理修复的
独立工作树中完成，不代表其他并行改动已通过验证。回归入口：

```bash
CCLINK_CODEX_REAL_SMOKE=1 pnpm exec vitest run src/main/agent-core/backends/codex-proxy-environment.test.ts
```

### 同日 0.1.137 本机 Codex 与 ACP 路由不一致回归

用户反馈输入框显示「Codex／本机 Codex」，但 13:06:17 的框架日志明确在
`LocalAcpBackend.sendMessage` 报缺少 OpenAI API Key。本机 Codex 只读登录探测通过不能证明
该次消息走了本机 Codex；这份日志也不包含失败消息的会话 ID、发送绑定和重叠事件，不能据此
归因于用户选错。前一轮只处理 HTTP 502，未关闭这个独立的 ACP 错误。

已用主进程回归用例复现：明确指定 `codex` 的发送进入 `beginRun` 异步准备期后，重叠的旧 ACP
发送可以先替换后端，再因重复运行被拒绝；最初的 Codex 请求随后进入 ACP 并报缺少 Key。
旧恢复请求也能在这个窗口更换绑定。这证明代码存在可产生相同症状的缺陷，尚不能证明用户
当时具体由哪一个重叠事件触发。

修复复用 `AgentRuntimeStateStore` 的运行所有权，在修改绑定前拒绝重复发送，并阻止准备期
切换后端或整体配置。新会话菜单移除 ACP，只保留本机 Codex 和 Claude Code 备选；历史绑定
保持可读。失败且没有 Session 的旧 ACP 会话，主动切换后清理空队列的暂停状态，可直接重发；
已有排队消息仍需检查，已有原生 Session 仍禁止换引擎。

用户功能验收（真实 Electron、实际本机 Codex 调用，隔离临时数据）：

1. 新建本地会话，打开运行环境菜单：Codex 默认选中，没有 Codex ACP 选项。
2. 发送「只回复 NATIVE_DEFAULT_OK，不使用工具。」：收到真实回复，主进程绑定为 `codex`。
3. 加载保存的旧 ACP 绑定，未配置其 Key 时发送失败且没有建立 Session；选择「Codex（默认）」
   后立即重发读取 `marker.md` 的请求：同一会话实际调用 `editor_read` 并返回文件标记。

以上在 `593dbdf0` 加本轮源码修复的独立工作树中通过。证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-routing-SIkZBu`，
包含 `result.json`、`native-default.png`、`acp-failed.png` 和 `acp-recovered.png`。
未发布新版本，未替换用户安装的 0.1.137，不能宣称其安装版已修复。

提交前全量回归还检查了取消期间的重复发送：提前拒绝仍返回占用中的真实 Run ID，保持原有取消与工具排空诊断；运行准备期和 `beginRun` 复用同一状态所有者查询活动运行。

工程验证：运行绑定、主进程所有权、会话信任、ACP 失败恢复、消息队列和发送参数共 61 项用例
通过；IPC 与更新生命周期相关回归另有 23 项通过。类型检查、构建、受影响文件 ESLint、
凭证边界检查通过。真实窗口验收入口（会消耗当前本机 Codex 账号额度）：

```bash
pnpm build
node scripts/codex-runtime-routing-ui-smoke.mjs
```
