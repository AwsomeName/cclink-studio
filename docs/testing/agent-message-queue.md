# 会话消息队列验收记录

日期：2026-10-19（Asia/Shanghai）。范围与用户操作见[产品规格](../features/agent-message-queue.md)。

## 用户功能进度

隔离 Studio 开发实例中已验证：执行中连续按 Enter 排队、显示顺序、移回输入框编辑、删除，以及右侧/居中面板布局。窄面板同时显示停止与排队按钮，运行环境标签不再逐字换行。

Claude Code 真实模型验收通过：

1. 在本地空工作空间发送“请只回复 QUEUE_ONE，不调用工具。”。
2. 在第一轮执行期间继续发送 QUEUE_TWO、QUEUE_THREE 两条同类消息，界面显示两项待发送。
3. 不再手动发送，等待三轮执行结束。
4. 实际得到 `QUEUE_ONE → QUEUE_TWO → QUEUE_THREE`，每条用户消息与对应助手回复交替出现，最终 `runStatus=completed` 且队列清空。

真实运行证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-message-queue-TK0MwC/result.json`（`runtimeWasStubbed=false`），同目录 `queue-side.png` 记录第一轮执行时的两项队列。

默认 UI smoke 证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-message-queue-fRjwig/result.json`（`runtimeWasStubbed=true`）；对应 side/center 截图验证可见操作。该 smoke 通过实际输入框入队，用替身发送 API 验证发送控制器，不冒充真实模型执行。

首次真实测试的等待判断过早结束；将等待改为显式读取运行状态、队列长度和消息数量，并强制验证三条真实助手回复后重跑通过。

尚未验收：Codex ACP 真实模型、CCLink 远程消息队列、真人现场操作。停止/失败暂停、工作空间隔离、重启缺图阻断与容量边界由自动化覆盖，不能据此声称这些场景都已完成人工验收。

## 工程准备度

- TypeScript web/node 检查通过。
- 相关文件 ESLint 通过。
- 会话控制器、队列、持久化、store、面板与 bootstrap 的定向回归通过。
- 隔离 Electron 的默认 UI smoke 和 `--real-runtime` smoke 均通过。
- 本轮未运行全仓 `pnpm verify`，未打包发版；以上结论限于受影响的工程门禁与上述实际用户动作。

## 残余边界

队列编辑后重新发送会排到队尾。重启只恢复文字和引用，图片需重新添加；恢复队列默认暂停。进程崩溃时不能承诺消息恰好执行一次，手动继续前应核对消息历史。现有权限和敏感操作确认仍由 Runtime 执行。


## 2026-11-05：共用输入区与远程队列

### 用户功能进度

本地现在可以在真实 Studio 连续提交三条消息，看到后两条进入队列，再按顺序自动执行。远程输入区与队列代码已接通，并通过真实 Electron 界面 + 远程 IPC 夹具验证；未登录真实在线 Agent，不宣称远程模型执行闭环通过。用户已明确本轮先不登录，后续实际使用再反馈。

真人复验动作：

1. 打开本地会话，发送“请只回复 QUEUE_ONE，不调用工具。”。
2. 第一轮执行时，分别输入相同要求的 QUEUE_TWO 和 QUEUE_THREE，逐条按 Enter；输入框上方应出现两项待发送。
3. 不再点击发送，等待三轮回复。实际记录显示用户/助手消息交替出现，回复依次包含 `QUEUE_ONE → QUEUE_TWO → QUEUE_THREE`，最终 `runStatus=completed` 且队列清空。
4. 运行中同时可见“停止”和“加入队列”；空草稿只禁用发送，停止保持可用。待发送项支持编辑、删除、暂停和继续。
5. 远程复验需要登录后选择在线设备与工作空间，重复三条纯文本动作；“停止等待”仅停止 Studio 跟踪，保留暂停队列，不能视作远端取消。

本地真实模型证据（`runtimeWasStubbed=false`）：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-message-queue-cDjqWG/result.json`，同目录 `queue-side.png`。

本地编辑、删除、右侧/居中布局的 Electron UI 夹具证据（`runtimeWasStubbed=true`）：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-message-queue-Itm7ON/result.json`。

远程 Electron + IPC 夹具证据（`runtimeWasStubbed=true`）：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-QBQD0L/result.json`，同目录 `remote-queue-side.png` 与 `remote-queue-center-paused.png`。实际操作真实输入框、共用面板、CCLink store、队列消费及原 preload 通道，夹具按明确操作发出远程终态；三条回复、暂停当前轮后的接续、编辑后重新入队、停止等待后保留暂停项及删除均通过。该证据不代表腾讯 IM 或真实远端模型通过。

### 工程准备度

- `pnpm typecheck`（web/node）、受影响代码 ESLint 与 Prettier 检查、`git diff --check` 均通过。7 个定向测试文件共 65 项回归通过；本地真实模型 smoke、本地 UI smoke 与远程 Electron IPC 夹具 smoke 均通过。
- 远程定向回归覆盖真实终态驱动、先完成后接受的竞态、重复草稿及图片隔离、新建会话原子绑定、跨会话/端点/工作空间隔离、失败/断线/停止跟踪暂停、归档、容量、订阅释放和账号切换。
- 新增 `scripts/remote-message-queue-smoke.mjs`：默认使用隔离 Electron 和远程 IPC 夹具；显式 `--real` 模式需要已登录实例的 CDP 地址和 RemoteWorkspaceRef。不会读取或复制凭证文件。
- UI 验证发现并修复了发送区外层 `aria-disabled` 将空草稿时的停止按钮一并标成不可用的问题。按钮现在分别表达自身可用状态。
- 本次提交前补跑全仓 `pnpm verify`：424 个测试文件、3597 项通过，10 项按原条件跳过；补齐了图片上传进度监听迁移后的 IPC 事件清单。
- 隔离远程 Electron IPC 夹具复验通过（`runtimeWasStubbed=true`）：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-gSR19X/result.json`。本次未打包或发布。

### 残余边界与 /grilling

- 远程真实在线三轮执行按用户要求留待实际使用验证；本地 Codex ACP 真实模型亦未在本轮验证。
- 远程队列与远程输入草稿仍为进程内状态，切换会话和收起面板保留，退出应用或账号后不恢复；不能宣传为与本地跨重启恢复能力完全一致。
- 编辑后重新入队排到队尾。异常暂停必须保留，不能以断线重连、发送接受或 session 列表中的 idle 自动认定上一轮完成。
- “停止等待”不取消远端执行；人工继续前应核对远端状态。发送结果不明确时，应核对历史再重试，不能承诺恰好一次执行。
