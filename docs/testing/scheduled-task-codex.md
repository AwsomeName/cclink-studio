# 定时任务默认 Codex 回归

日期：2026-11-11。关联 [ADR 0022](../decisions/0022-codex-default-local-runtime.md)。

## 用户能力与验收结果

修复后的源码构建中，在未配置 Studio Claude API Key、已有本机 Codex 文件登录的条件下，
定时任务可以通过 Codex 读取工作空间资料并生成 Markdown。真实 Electron 自动验收已覆盖
“立即运行”、打开生成文件和到点触发。用户原有“每日简报”及已安装版本未在本轮重跑或更新，
不能把隔离工作空间的结果写成该任务已恢复。

真人复验动作：

1. 启动包含本修复的 Studio，保持本机 Codex 已登录，无需配置 Claude API Key。
2. 在本地工作空间放入带唯一标记的 `source.md`，新建定时任务，要求读取该文件并生成 Markdown。
3. 保存到一个尚不存在的文件名，点击“立即运行”，确认运行完成且打开的文件包含该标记。
4. 再创建一个几分钟后的单次任务，使用另一个文件名，在 Studio 保持运行时等待到点，确认
   运行历史显示自动触发且产物可打开。
5. 重试已有任务前确认目标文件不存在；create-only 仍会拒绝覆盖已有文件。历史失败记录不会
   因本修复自动重跑。

自动验收：`node scripts/scheduled-task-codex-smoke.mjs`，使用独立 userData 和临时工作空间，
实际调用本机 Codex，不复制登录凭证，不操作用户正式任务。

- 手动运行 `971eafd0-392f-4db8-92de-88c0fc127dac`：`completed`，生成并打开 `reports/manual.md`。
- 到点运行 `1883989a-b0d2-492e-b4d9-2fa6e04f6ba3`：`completed`，`trigger=scheduled`，生成
  `reports/scheduled.md`。
- 两次主进程查询均为 `runtimeBinding.kind=codex`，有真实原生 Session，流事件含 `editor_read`；
  产物包含只存在于测试资料中的标记。
- 本机临时证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-scheduled-codex-WIAYzU`，
  包含 `result.json` 和 UI 截图。临时测试工作空间已清理。

## 根因、边界与工程验证

新聊天通过 `bindConversationRuntime` 显式选择 Codex，定时任务此前直接进入
`AgentRuntime.sendMessage`，遗漏绑定，因而使用旧 Claude 默认后端并触发 API Key 检查。
修复在定时任务主进程入口复用 `NEW_LOCAL_AGENT_RUNTIME_BINDING`，不修改旧聊天的兼容默认值，
不新增设置、持久化状态、IPC 或调度 owner。运行开始前继续拒绝配置切换及重复运行。

定时任务仍禁用原生工具，仅开放 `editor_read/list`，由现有 ToolHost 校验资源路径；产物仍由
Studio 按 create-only 写入并核验。按用户随后授权的 ADR 0023，启动检测发现 Codex 不可用时可
选择已配置的 Claude；选定后不换 Agent 重跑。聊天 Tab 的 Agent 选择不影响独立的后台任务。
新策略的跨任务验收见 [自动 Agent 选择](automatic-task-agent-selection.md)。

通过的工程门禁：

- Agent 会话绑定、运行生命周期、定时任务服务/runner/持久化/IPC、权限 broker 和 ToolHost：
  首轮 102 项单测通过，覆盖无 Claude Key、已选定 Codex 的运行失败不重试、重复启动、越界读取和禁用 Terminal。
- `pnpm build`（含前后端类型检查）通过；变更的 TypeScript 文件 ESLint、格式检查通过。
- `node scripts/scheduled-task-fallback-smoke.mjs` 通过：真实 Electron 配合拒绝事件的 Codex
  协议 fixture，验证失败仍记为 failed、模板保存并可打开、正文不混入拒绝信息、重复点击受限。
  此项不调用真实模型，不代表真实服务会产生该拒绝。

没有重新运行全量 `pnpm verify`，没有发布安装包；定时任务完全退出后不运行、网络或额度失败、
Codex 未安装/未登录等原有边界不变。本轮不承诺历史任务补跑或用户原有资料的内容质量。
