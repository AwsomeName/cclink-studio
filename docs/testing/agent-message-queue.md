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
