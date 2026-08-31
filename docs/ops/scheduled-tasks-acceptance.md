# 定时任务验收记录

> 日期：2026-08-31
> 基线：当前 `main` 加工作树增量
> 当前范围：M8.1–M8.2 首版核心闭环 + 定时任务 Git 共享
> 产品事实源：`docs/features/scheduled-tasks.md`

## 当前结论

用户现在可以在工作空间创建、保存、启停和重新打开定时任务；可以立即运行已保存
revision，也可以在 CCLink Studio 存活期间到点自动生成经过校验的 Markdown，并从任务
Tab 查看历史、取消运行和打开产物。

当前源码还允许在定时任务 Tab 中使用统一 `workbench.save`（默认 `Cmd/Ctrl+S`）保存任务
定义；输入框聚焦时仍生效，保存保持当前本机启用/暂停状态，不触发立即运行。

CCLink Studio 完全退出后不会执行任务。真实 App 自动验收已证明到点前退出不会生成
文件，受控 App 进程已停止，重启后单次 occurrence 显示 missed，运行时诊断报告
`systemScheduler=none`。

首版核心闭环已进入真人验收，不在人工矩阵签字前声明正式交付。尚待人工确认的重点是
双工作空间切换、键盘/屏幕阅读器、磁盘故障文案，以及系统进程查看器中的跨平台残留检查。

Git 共享增量已经允许用户在 A 把任务显式设为随项目共享，经自己的 Git 流程带到 B；B 默认
暂停，明确确认当前 revision 与 execution digest 后才运行。A 更新或删除后，B 的旧确认失效，
未来运行停止，但 B 的本机历史保留。自动验收已覆盖两个隔离 userData 和不同绝对路径；尚未在
两台物理电脑上由真人复核 Git 凭证、UI 可读性和真实等待到点体验。

## 真实 App 自动验收

执行：

```bash
pnpm smoke:scheduled-tasks
```

结果：通过。

最近一次证据摘要：

```text
manual=74acc200-a66d-45aa-91c2-e2756e353cb0
agentQuery=scheduled_task_list
automatic=d94e4620-92ed-43c5-b1e3-5df45bec89cd
cancelled=56c0dc4e-060f-4399-b077-8b8289410871
denied=31a759da-35a6-4e9d-9646-d1f5ff3941d0
missed=478b1431-7823-43db-a9e6-432888c43cc7
artifact=.cclink-studio/scheduled-task-results/task-cdd49693-98b5-481b-9970-b4ca6b2e1a09-2026-08-31-1916-74acc200-a66d-45aa-91c2-e2756e353cb0.md
systemScheduler=none
```

脚本使用隔离 `userData` 和临时工作空间启动真实 Electron，完成：

1. 从 Activity Bar 空侧栏创建任务，保存并在本机启用。
2. 点击“立即运行”，通过真实本机 Agent 生成非空 Markdown。
3. 核对 run 固定 revision、产物路径、字节数、摘要和写后内容。
4. 从运行历史点击产物，在真实编辑器 Tab 打开文件。
5. 暂停、重载、搜索和筛选，核对 definition/activation 分离与逻辑 Tab 去重。
6. 提交工作空间外输出目录，确认 IPC schema 拒绝路径穿越。
7. 运行要求 Terminal 的任务，确认结构化失败且没有产物。
8. 启动后立即取消任务，确认 cancelled，后续没有迟到产物。
9. 创建 4 秒后单次任务，关闭任务 Tab 后仍由 App 到点触发并生成 Markdown。
10. 再创建 4 秒后任务，到点前完全停止 Studio；等待后确认没有文件。
11. 确认受控 Studio 进程已停止；重启后 occurrence 恢复为 missed。
12. 读取运行时诊断，确认没有系统调度配置。

真实 App 冒烟发现并修复：

- 空任务 selector 返回不稳定数组，导致侧栏进入 ErrorBoundary。
- 任务侧栏在“空列表 → 异步恢复”时条件性调用 Hook，重载后任务行消失。
- 产物入口只加载编辑器 buffer、未创建 Workbench Tab。
- App 停止与 runner 启动交错时，queued run 可能被恢复成假 running。

## Git 共享真实 App 自动验收

执行：

```bash
pnpm smoke:scheduled-task-git-sharing
```

结果：通过。

最近一次证据摘要：

```text
task=d633edb2-9d8c-410a-9f6c-0d0449669b34
B-run=dfc48acb-5b9b-4985-83ce-cbd828368dda
A-revision=2
B-suspended=definition-changed
B-removed=definition-removed
```

脚本使用两个隔离 `userData`、两个不同绝对路径和一个真实 bare Git remote 启动真实 Electron，
完成：

1. A 保存 portable shared v2 定义，确认 JSON 不含 A 的绝对路径且普通 Git status 可见。
2. A Commit/Push，B Clone/Open；B 发现任务但 activation 默认 disabled。
3. B 未确认前立即运行被拒绝；确认绑定 revision + digest 后通过真实 Agent 完成一次运行。
4. 再打开 A，确认 B 的 activation 和历史没有传播到 A。
5. A 更新到 revision 2 并 Push；B Pull 后自动暂停，旧确认无法立即运行。
6. B 重新确认 revision 2；A 删除并 Push；B Pull 后显示 definition removed，不再列出可调度任务。
7. B 删除后的本机运行历史仍保留，A/B 退出后不留下系统调度器。

常规定时任务烟测同日再次通过，覆盖真实 UI 的 local → shared 转换、共享后暂停、目标设备启用、
真实 Agent 立即运行和到点运行；证据中的 `systemScheduler=none` 保持不变。

## 工程门禁

2026-08-31 Git 共享增量门禁：

- `pnpm typecheck`：通过。
- 受影响 Vitest 串行矩阵：17 个文件、58 项测试通过；删除诊断码收敛后又重跑 10 个文件、
  38 项定时任务测试通过。
- 定向 ESLint 与 Prettier：通过。
- `pnpm smoke:scheduled-tasks`：通过。
- `pnpm smoke:scheduled-task-git-sharing`：通过。

完整 `pnpm verify` 同日再次运行到格式门禁，OSS、package、credential、Claude scheduling、
context action 与 release 边界均通过；随后被同一工作树中与本需求无关的并行
`agent-tool-authorization-broker.ts`、`tool-host.ts` 和 Android 测试格式改动阻断。本轮没有擅自
格式化或覆盖这些并行修改。依据架构门禁的“`pnpm verify` 或受影响 smoke”，本功能采用上述
受影响门禁作为当前交付证据。

执行：

```bash
pnpm verify
```

结果：通过。188 个测试文件、1083 个测试全部通过，随后 TypeScript 与生产构建通过。

定时任务专项测试已覆盖：

- 单次、每天、工作日、每周、时区和 DST 不存在时刻。
- definition、activation、run ledger 分离存储和 revision 冲突。
- 立即运行去重、全局单 scheduled run、到点 claim、取消和退出 interrupted。
- 重启 queued/running 恢复、单次 missed 和 30 分钟补执行边界。
- scheduled origin 精确工具列表；Terminal 等工具不可见且直接拒绝。
- 读取路径 realpath 边界、输出目录边界、create-only 和写后 SHA-256 校验。
- 非可信 IPC sender、非法时间、非法 Markdown 输出和路径穿越。
- preload API、Activity Bar 状态、任务历史和脱敏诊断。

2026-08-17 的快捷键保存增量已通过 7 项相关 renderer 测试、Web/Node TypeScript、ESLint
和生产构建；真实应用中的键盘操作仍列入 H11，不能用这些工程门禁代替真人验收。

## 真人验收矩阵

- [ ] H1 创建、保存、关闭和重开后，revision、启用和下次运行一致。
- [ ] H2 立即运行生成真实 Markdown，历史和产物入口可用。
- [ ] H3 关闭任务 Tab 后，App 存活时仍能到点自动执行。
- [ ] H4 到点前退出 App，不生成文件；系统进程查看器无残留 Agent。
- [ ] H5 重启后 missed/catch-up/interrupted 状态真实且不重复。
- [ ] H6 在工作空间 A 运行时切到 B，不串侧栏、输出和焦点。
- [ ] H7 两任务同刻串行；取消后没有迟到 stream 或产物。
- [ ] H8 工作空间外写入、Terminal、Browser、Android、Git、数据源均被拒绝。
- [ ] H9 Agent 不可用、只读目录和账本损坏不阻断 Studio 其他能力。
- [ ] H10 复制完整诊断，可定位 task/revision/run 且不含 prompt、正文或凭证。
- [ ] H11 键盘和屏幕阅读器可完成新建、保存、立即运行、取消和打开产物；任务表单输入
      焦点内按 `Cmd/Ctrl+S` 只保存一次，清除 dirty，且不改变启用状态或触发运行。
- [ ] H12 Git 普通仓库与 linked worktree 只修改本地 exclude。
- [ ] H13 在物理电脑 A 通过 UI 把本机任务设为随项目共享并 Push；物理电脑 B Clone/Pull 后能看见
      但默认不执行，确认内容后才能立即运行和到点运行。
- [ ] H14 A 更新或删除并 Push 后，B Pull 会使旧确认失效或显示定义移除；dirty draft 不被覆盖，
      B 本机历史仍可查看。
- [ ] H15 A/B 同时启用时重复执行警告清晰；两端 activation、权限、历史和结果互不传播，Git 凭证
      失败也不阻断非 Git 本机任务。

## 残余风险

- 当前自动验收运行在 macOS arm64；Windows Task Scheduler 和 Linux cron/systemd 的
  “未注册”仍需对应平台检查。
- 交互式用户 Agent 的优先级协调尚未形成独立真人证据；scheduled 自身已保证全局单并发。
- Activity Bar 首版只显示排队/运行数字；失败/需要处理的颜色优先级仍可继续打磨。
- 运行历史上限和损坏降级已有边界，但大账本 compaction 与磁盘耗尽仍需长时间压力验收。
- Git 共享自动验收使用同一台 macOS 上的两个隔离 userData，不等于物理双机的网络、凭证和时钟
  差异；H13–H15 未签字前只声明自动化闭环通过。

结论：允许进入真人验收；人工矩阵未签字前不标记正式交付。
