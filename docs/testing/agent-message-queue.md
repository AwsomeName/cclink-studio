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

## 2026-11-11：远程单条任务失败后的手动重试

用户功能进度：源码中的空队列失败暂停已修正；尚未发布到用户安装的 0.1.138，也未在真实在线 Agent 上复验本次错误。隔离 Electron 界面验证通过，远端使用 IPC 夹具，不能宣称真实远程执行闭环通过。

验收动作：远程会话只发送一条消息，等它失败，确认输入区恢复“发送”；再次输入消息并按 Enter 或点击发送，新消息应立即进入执行，无需点击“继续队列”。已有后续消息排队时，失败仍暂停队列，不能自动继续或重试失败消息。

根因：远程运行的 `error` 事件无条件设置队列暂停原因，空队列对象又被下一次输入复用。修正为只暂停已有后续排队项；等待发送回执的当前提交项不算后续项，避免错误先于回执到达时再次留下暂停状态。状态与派发继续由既有 CCLink store 和主进程事件拥有，未新增权限或 IPC。

工程准备度与验证结果：

- 新增回归在修复前复现两条失败：普通报错后再次发送未派发、错误先于回执时遗留暂停；修复后通过。
- 队列、远程面板、共用面板和 CCLink store 共 4 个测试文件、52 项测试通过；`pnpm typecheck:web`、受影响 TypeScript ESLint、Prettier 与 diff 检查通过。
- `node scripts/remote-message-queue-smoke.mjs --renderer=http://127.0.0.1:43867` 通过。侧栏 Enter 重试与中间面板点击发送均经过真实输入框、store、队列消费和 preload 通道；确认失败不会自动重试，新提交只派发一次。原有 FIFO、手动暂停/继续、编辑、停止等待和删除回归也通过。
- 证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-wzP1lA/result.json`（`runtimeWasStubbed=true`）；同目录 `remote-failure-ready-right.png`、`remote-failure-ready-center.png` 为报错后恢复发送，`remote-failure-retry-right.png`、`remote-failure-retry-center.png` 为手动重试进入执行。
- 首次复用已有开发 renderer 时，在发出第一条消息前遇到 `Maximum update depth exceeded`；改用独立 renderer，并为夹具补齐现有会话恢复所需的 `listSessions` 响应后通过。本次未修改产品初始化链路，不能据此声明该开发环境异常已修复。

残余边界：发送结果不明确、用户停止跟踪、手动暂停和断线后的队列仍要求核对后继续；本次不处理模型服务自身的 402 响应。

## 2026-11-11：等待选择时直接用文字回复

用户功能进度：源码已支持等待远程提问时直接输入文字回复，也可把已经排队的文字转作当前问题的回答。隔离 Electron 界面已通过；尚未发布到安装版，真实在线 Agent 的本次验收仍待完成。

真人可执行验收动作：

1. 让远程 Agent 提出多项选择，保持选项为空，在输入框输入“先全部停掉，后面需要恢复哪个我再说。”并按 Enter；按钮应显示“直接回复”，回复进入当前问答，不新增待发送项。
2. 确认前原草稿仍在、选项提交与重复发送被禁用；确认失败时显示错误并保留原文，点击“直接回复”可重试；匹配确认后卡片显示“已回答”和文字回复。
3. 若文字已经进入队列，点击该项“用此消息回复”。确认前该项保留且不能编辑或删除；失败仍保留，重试成功后移出队列。确认过程中即使当前轮先结束，也不能把同一条文字再发成普通消息。
4. 当前队列清空后，原任务结束，输入框恢复普通发送；仍有其他待发送项时保留其顺序和暂停状态。历史已回答/结束的问题、新用户回合之前的旧问题不能截走新消息。

工程准备度与证据：

- 相关 7 个测试文件共 137 项通过（问答状态新增最后一项后定向复验 17 项）；覆盖自定义答案原文、匹配问题、提交互斥、失败重试、草稿保护、队列移除、终态/回执乱序、历史问题、账号隔离和主进程答案归一化。`pnpm typecheck`、受影响 ESLint、Prettier 和 diff 检查通过。
- `node scripts/remote-message-queue-smoke.mjs --renderer=http://127.0.0.1:43867` 通过，证据为 `/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-voHMR7/result.json`。侧栏 Enter 直接回复、失败后按钮重试、中间面板队列回复、队列回复失败重试、确认前保留与确认后移除、选项始终未被代选、没有重复普通消息均通过；同目录 `remote-question-reply-pending-*.png` 和 `remote-question-replied-*.png` 记录界面。
- `node scripts/remote-question-smoke.mjs` 原选项回答回归通过：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-question-Wt4m1h/result.json`。缺项提示、单选/多选、超时续接、失败保留选项和新回合确认仍可用。

拷问结论：复用既有 `answerQuestion` 通道与主进程确认，用户原文作为整组问题的自定义答案，不推断选择；不通过停止跟踪、假造取消或新建并行任务绕过等待。提交 UI 状态归现有 CCLink store，问题终态仍由远端与主进程拥有，未修改云端或 Agent runtime。

残余限制：问答回复只支持纯文字；文字回复展示是运行期 UI 状态，不承诺跨重启保留。上述 Electron 验证使用模拟远端，不代表真实模型已继续执行用户指令；本轮未发布。

## 2026-11-11：空闲且空队列时直接发送

用户功能进度：源码已实现远程首条消息直接发送，提交期间不进入待发送列表；右侧和中间面板的隔离 Electron 界面验证通过。用户安装的版本尚未更新，本次未发布，真实在线 Agent 未复验。

真人可执行验收动作与对应夹具结果：

1. 打开空闲的远程会话，确认没有待发送消息，输入文字并按 Enter。首条消息直接提交，按钮显示“发送中…”，等待发送回执时不出现队列卡片；右侧与中间布局均通过。
2. 首条仍在发送或执行时，继续输入两条消息；仅这两条显示在待发送列表中，待真实终态与接受回执均到达后逐条执行。夹具验证保持顺序，没有重复普通消息。
3. 首条提交被拒绝且没有后写草稿或排队消息时，原文字与图片回到输入框，无空队列暂停状态，可直接重试。已有新草稿或后续项时，保留新草稿并将失败消息放回暂停队首；自动化覆盖这些边界。
4. 上轮失败后重新发送、等待选择时直接文字回复及队列转回复，均保留原回归结果。待发送数量为 0 但当前任务仍在执行时，新消息仍排队，不能创建同会话并行任务。

工程准备度与证据：

- 6 个定向测试文件共 83 项通过，其中远程队列 27 项，覆盖首条在所有状态变更中从未进入待发送数组、独立于队列订阅直接提交、新会话原子绑定、回执与终态乱序、草稿和图片恢复、新草稿与后续顺序保护、离线及工作空间切换。
- `pnpm typecheck:web`、本轮受影响 TypeScript 文件 ESLint、代码及 smoke 脚本 Prettier、`git diff --check` 均通过；未运行全仓 `pnpm verify`。
- `node scripts/remote-message-queue-smoke.mjs --renderer=http://127.0.0.1:43867` 通过。证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-7uRDs6/result.json`（`runtimeWasStubbed=true`）；同目录 `remote-first-direct.png`、`remote-direct-right.png`、`remote-direct-center.png` 记录等待回执时无队列卡片与“发送中…”状态，已查看截图。

拷问结论：直接发送是入口行为，复用既有派发器、账号与工作空间校验和主进程终态；没有另建运行状态所有者。空队列的历史暂停不能阻断新的手动消息，有真实后续项的异常暂停仍保留。发送结果不明确时仍须核对历史再重试，不能承诺恰好一次执行。
