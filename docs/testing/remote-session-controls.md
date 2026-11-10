# 远程会话列表、停止与删除验收

## 用户验收动作

1. 在已登录、已配对的在线远程项目中打开 Agent 会话列表，将列表宽度缩到 180–200px。
   长标题应单行省略，状态与操作保持在列表内；行高约 60px。当前会话和已归档会话都可搜索。
2. 用测试会话启动可取消的长任务。运行时应显示“响应中”，列表和输入框均有“停止”。
   点击停止后只显示远端接受请求，收到任务结束事件后才变为空闲；已排队的后续消息保持暂停。
3. 空闲会话点击“删除”，应出现包含会话标题与影响范围的确认区；点击取消不得发送删除请求。
   确认后，只有在线远端同步证明会话已移除，Studio 才清理本地历史、草稿、队列及关联会话 Tab。
   重启并重新连接后该会话不得出现。运行中会话必须先停止再删除。
4. 断开远端连接后尝试删除，历史和确认区必须保留并提示失败；重连后可以重试。
   归档/恢复继续可用，搜索和拖入工作台行为保持不变。

## 实现边界

- `CclinkRemoteService` 继续拥有远程会话与执行状态。renderer 仅保存按钮提交、确认与展示状态。
- 停止复用 Agent 已有 `cancel_generation`，指定 `target_request_id`，并核对
  `cancel_generation_ack` 的会话、目标和状态。接受回执不代表任务已经结束。
- 删除复用 `session_delete`；由于协议没有删除 ACK，以新的 `session_sync_response` 核验。
  删除校验失败、离线或超时均保留本地历史，诊断分别记录 `agent.stop` / `session.delete`。
- 主进程校验 workspace/session 归属，串行保护同一会话的控制操作和发送；IPC 使用可信 renderer
  守卫及既有严格 workspace/session schema。不修改远程 Agent、云服务、权限模式或本地能力。
- 同步读取 `active_turn`，防止重连后运行任务显示为空闲；过期快照不得覆盖在等待期间开始/结束的任务。

## 工程验证与尚未验收项

```bash
pnpm build
pnpm exec vitest run src/main/cclink-remote/remote-session-controls.test.ts src/renderer/src/features/cclink-remote/remote-session-controls.test.ts
node scripts/remote-session-controls-smoke.mjs
```

Smoke 要求开发 renderer 已运行（默认 `http://localhost:5173`，可用 `--renderer=` 指定）。
它启动隔离的 Electron/profile，使用当前 service/store/preload，仅替换远端传输，验证长标题、
180/200/280px 列宽、停止回执与结束事件的区别、删除取消、离线保留、重试成功、归档恢复。
不读取、停止或删除用户真实会话。输出目录包含截图。

2026-11-11：上述隔离 Electron 链路通过，200px 栏宽实测行高 60px、内容宽度 200px，180/280px 亦无按钮越界；历史恢复 smoke 的强制退出恢复、工作空间切换、重连、不可读历史提示通过。真实在线 Agent 的取消、删除及重启核验仍需按上面的用户动作验收，不能以 fixture 通过替代。
