# 远程会话重启恢复回归

## 用户能力与当前结论

用户验收动作：重新启动 Studio，打开已有远程工作空间，在右侧会话列表看到原普通会话，
切到“查看已归档会话”看到归档记录，再打开普通会话读取原消息。关闭面板、切换工作空间、
重连和异常退出后重新启动，都不应使已落盘历史因缺少 UI 加载入口而消失。

2026-11-10 已在独立数据目录的真实 Electron 中通过这条历史读取路径；远端网络为离线夹具，
未登录真实账号，未向真实 Agent 发送任务。故障 Mac 尚未安装本轮修复，不能宣称该电脑已经恢复。

## 事故证据与根因

- 用户反馈 macOS / Studio 0.1.134 报错退出后，远程普通会话与归档列表均为空。
- 故障 Mac 主文件和备份各约 7.1 MB；只读统计证明主文件含 31 个会话，当前
  `endpointId + workspaceId` 精确匹配 3 个普通会话和 2 个归档会话。
- 另有 2026-09-20 的约 16 MB `.corrupt-*` 文件；它不是本次故障已确认的原因。
- `ffc2da38` 将会话导航移到右侧时，从 App 移除了 `ConversationQuickSwitcher`。
  远程 `loadSessions` 的唯一 UI 生命周期入口仍留在该旧组件，新的列表与控制器只读取
  renderer store。重启后 store 为空，磁盘历史没有被请求。
- 原始报错退出的原因尚未确定；框架报告中本机 Claude 路径缺失只直接解释本地 Agent / Scheduler
  降级，不证明远程历史损坏。

## 修复边界

- `useRemoteConversationRestore` 在 App 的工作空间恢复完成后挂载，响应远程工作空间切换、
  连接恢复和登录恢复。独立于列表、聊天面板及旧顶部组件，释放时清理订阅和未开始的加载。
- 继续调用原 `CclinkStore.loadSessions`、IPC 和主进程 `CclinkRemoteService`。主进程仍是
  远程会话事实所有者；renderer 只展示投影。离线时可读取主进程的既有历史，不新增权限。
- 本地 / 全局工作空间不因该 hook 初始化远程服务；不修改 Agent 或云端。
- 同时保留排查中确认的数据保护修复：缺失主文件先读取备份，格式或版本异常不返回伪空状态；
  两份快照都不可读时保留原文件并报告恢复错误，阻止空内存快照覆盖磁盘。
  该错误不关闭远程连接、文件访问或能力探测；会话列表显示错误而非“暂无会话”。
- 16 MB 读取上限保持不变；超限历史的分片保存 / 大文件迁移不在本轮范围，不能宣称此问题已解决。
  尚未落盘的最后一段流式输出也不属于本次恢复保证。

## 工程验证

```bash
pnpm exec vitest run src/renderer/src/bootstrap/use-remote-conversation-restore.test.ts \
  src/main/cclink-remote/runtime-state-store.test.ts \
  src/main/cclink-remote/cclink-remote-service.test.ts \
  src/renderer/src/stores/cclink-store.test.ts
pnpm typecheck
node scripts/remote-conversation-restore-smoke.mjs --renderer=http://localhost:5173
```

Smoke 需要运行中的开发 renderer 和已有 Electron main / preload 构建。脚本使用独立 profile，
从当前源码构建远程服务和存储模块，测试真实 IPC 与磁盘；不向 renderer 注入会话或调用
`loadSessions`，由 App 的真实生命周期触发加载。工程结果：

- 93 项相关单测通过；覆盖无面板恢复、离线读取、项目切换、重连、订阅释放、失败保护。
- 另有 23 项远程 IPC、控制器和旧切换组件测试通过，总计 116 项。
- TypeScript 检查及变更文件 ESLint 通过。
- Electron 中 3 个普通 / 2 个归档会话及正文可见；切换工作空间后只显示对应历史。
- 强制 `SIGKILL` 后重新启动同一隔离 profile，再打开远程工作空间，普通 / 归档记录和正文仍可见。
- 模拟历史读取失败时展示错误，不同时声称“当前远程项目暂无会话”。

## 故障电脑验收（待执行）

1. 先保留 `~/Library/Application Support/CCLink Studio/cclink-remote` 的本地备份。
2. 安装包含本轮修复的版本，打开原设备和远程工作空间。
3. 核对至少 3 个普通、2 个归档记录，打开原会话核对消息；不要用旧 `.corrupt-*` 文件覆盖主文件。
4. 正常重启后重复检查。真实账号上的恢复结果需另行记录；工程夹具不替代这一步。
