# S3 生命周期与契约治理记录

> 状态：进行中。当前工作包为 S3.1，基线来自 S2 最终提交 `8418572`。

## 结论

S3.1 先关闭运行时生命周期的双清单问题：同一个 `ServiceRegistry` 声明启动与停止，保存在 runtime 中，并负责启动失败回滚、窗口重建和最终退出。IPC 通道仍由人工清理总表维护，这是 S3.2 的明确阻断项；在它被共享 contract 替代前，不得宣称 S3 完成。

## 基线问题

| 问题 | 失败表现 | 根因 | S3 工作包 |
| --- | --- | --- | --- |
| 启动与退出使用两份服务清单 | 新服务容易只启动不释放，失败后残留子进程或 listener | `bootstrap-runtime.ts` 和 `shutdown-runtime.ts` 分别手工声明 | S3.1 |
| 启动中断不回滚 | 后续阶段失败时，已创建窗口和主进程服务继续存活 | registry 只记录注册顺序，不记录已启动阶段 | S3.1 |
| macOS activate 只重建窗口 | 全量 IPC 被清除，但主服务、自动化和 Agent IPC 没有重新注册 | 入口直接调用 `cleanupIpcHandlers()` 和 `createWindowRuntime()` | S3.1 |
| IPC 清理依赖手工通道数组 | 新增或改名通道后可能重复注册或无法清理 | 注册、preload、schema、清理没有单一声明源 | S3.2 |
| 项目切换资源归属分散 | 旧 Browser view、任务、Terminal 或会话可能跨项目残留 | workspace transition 尚未统一拥有资源解绑 | S3.3 |

## S3.1 生命周期声明

启动顺序是依赖顺序，停止和失败回滚严格逆序执行。失败阶段在调用 `start` 前即进入 started 集合，因此其部分初始化资源也会执行配对 `stop`。

| 阶段 | 启动责任 | 停止责任 |
| --- | --- | --- |
| `ipc-runtime` | 建立生命周期锚点 | 所有服务停止后清理 IPC handler/listener |
| `state-services` | Settings、WorkspaceState 加载 | flush WorkspaceState 并释放引用 |
| `window-runtime` | 主窗口、可信 sender、Browser/Android 窗口能力 | 认证子进程、Browser views、设备连接、窗口 |
| `main-process-services` | 本地身份、文件、设置、可选主服务和 IPC | 权限确认、Terminal sessions、主服务引用 |
| `automation-runtime` | Editor、Playwright、MCP、设备工具 | Editor、设备工具、MCP、Playwright |
| `agent-runtime` | 本地 Agent bridge | Agent runtime 和子进程 |

## S3.1 验收

- [x] runtime 只持有一个 `ServiceRegistry`，退出路径不再构造第二份清单。
- [x] 服务按注册顺序启动，按逆序停止；重复 start/stop 幂等。
- [x] 任一启动阶段抛错时，失败阶段与此前阶段均逆序回滚。
- [x] 窗口重建通过同一 registry 完整 stop/start，不再手工清 IPC 后只重建窗口。
- [x] 单个资源释放失败不阻断后续释放。
- [x] 单元测试覆盖顺序、失败回滚、并发幂等和完整重建。
- [x] 当前工作树通过 `pnpm verify`、`pnpm smoke:standalone`、严格认证 smoke。
- [x] 全新 detached worktree 通过锁定安装和相同门禁。
- [x] 远端 CI 通过。

## S3.2 IPC 契约

S3.2a 已将生产 renderer IPC 的实际注册和释放收敛到窗口级 `TrustedIpcRegistrationScope`：handler/listener 注册时立即生成精确 disposer，窗口阶段停止时逆序释放；重复 handler 会在同一 scope 内失败，重复 dispose 幂等。原有 `ipc-cleanup.ts` 人工通道数组已删除，listener 不再通过 `removeAllListeners` 误删其他所有者。

S3.2b 继续把 main/preload 的通道名和运行时 schema 收敛到共享 contract。完成前，通道字符串仍可能在调用端漂移，S3.2 和整个 S3 都不能关闭。

S3.3 再处理项目切换时 Browser view、BrowserTask、Agent conversation 和 Terminal session 的统一解绑及集成测试。

### S3.2a 验收

- [x] 生产 renderer IPC 不存在 guard 之外的裸 `ipcMain.handle/on`。
- [x] 每次 handler/listener 注册同时生成精确 disposer。
- [x] dispose 幂等，单项清理失败不阻断其他通道。
- [x] 删除人工维护的 IPC 清理通道数组。
- [x] 单元测试覆盖 handler、listener、重复注册和重复清理。
- [x] 当前工作树、干净 worktree 和远端 CI 门禁通过。

首次严格认证复验捕获到 clean Google 已到 identifier URL 但 20 秒内仍为 `pending`，门禁立即失败。检查发现 smoke 虽声明 clean 最多三次，却只对 `network-unavailable` 重试；现将 `pending` 纳入同样的有限重试，但最终通过条件仍严格要求 `account-validation-reached`，不会把超时或外部失败降级为成功。

S3.2a 提交为 `d81c21b`，认证门禁修复为 `bd841a8`。当前工作树和全新 detached worktree `/tmp/cclink-studio-s3-ipc-verify.6aEmjj` 均通过 139 个测试文件/828 项测试、standalone 24/24 与严格认证 smoke；detached HEAD 和工作树干净。GitHub Actions run `29805001919` 在 `bd841a8` 完成且结论为 `success`。S3.2a 已关闭，S3.2b 继续。

## 当前门禁证据

2026-07-21 当前工作树：

- `pnpm verify`：139 个测试文件、826 项测试通过，OSS boundary、format、lint、typecheck 和生产构建返回 0。
- `pnpm smoke:standalone`：local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window`：Profile Cookie/localStorage 跨进程持久化通过；干净认证进程到达 Google account validation，CDP 对照被识别为不安全浏览器。

提交 `3030828` 的全新 detached worktree `/tmp/cclink-studio-s3-verify.7gwcNm` 完成 `pnpm install --frozen-lockfile` 后通过相同三组门禁，HEAD 与工作树均干净。GitHub Actions push run `29804363879` 在同一提交上完成且结论为 `success`。

## 拷问

- registry 统一不等于资源已经全部可释放；没有 disposer 的服务必须补契约，不能只把字段设为 `null`。
- 重建测试不能只断言窗口出现，还要证明 Agent、Terminal、Browser IPC 均重新注册且不存在 duplicate handler。
- 项目切换不能借用全应用重启掩盖状态所有权问题；旧资源必须按 workspace ID 明确解绑。
