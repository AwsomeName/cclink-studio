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

## 后续边界

S3.2 必须把 IPC 通道名、参数 schema、trusted sender、preload 调用和 disposer 收敛到共享声明，删除 `ipc-cleanup.ts` 的人工通道数组。S3.3 再处理项目切换时 Browser view、BrowserTask、Agent conversation 和 Terminal session 的统一解绑及集成测试。两项完成前，S3 保持进行中。

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
