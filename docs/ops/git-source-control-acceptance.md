# Git 源码管理验收记录

> 当前阶段：G1-G3 与已有 upstream Push 自动化真实 App 验收通过；G4 剩余项、G5、真人验收和最终提交证据待补
>
> 日期：2026-08-17
>
> 基线：`main` / `4d54a9d3`，验收对象为基线上尚未提交的开发工作区

## 用户功能结果

真实 Electron 应用打开当前 Git 根工作空间后，左下角显示真实分支、去重变化数和已知增删
行数。点击状态段可查看仓库、分支、upstream、本机已知 ahead/behind，进入分组变更并打开
有界只读 Diff；刷新、外部点击关闭、Esc 关闭与焦点恢复已实现。状态栏不再显示常驻
“Agent 就绪”和活跃 Tab 类型“编辑器”。

状态栏右侧旧“备份到 Git”按钮已经移除；“网站与账号”侧栏中的兼容建仓卡片仍保留到 G5。

临时真实仓库 UI 路径完成了：只选择 `tracked.txt`、填写提交信息、commit、确认未选的
`leave-untracked.txt` 仍存在、显式 Push、确认远端 HEAD 等于本地提交。提交没有自动 Push。

## 自动化证据

| 检查              | 结果                                             |
| ----------------- | ------------------------------------------------ |
| TypeScript        | `pnpm typecheck` 通过                            |
| 单元/集成测试     | 281 个文件通过；1618 个测试通过，2 个跳过        |
| Electron UI smoke | `pnpm smoke:ui` 16/16 通过                       |
| Git 用户路径      | 状态、分组 Diff、精确文件 commit、显式 Push 通过 |
| 状态栏收敛        | “Agent 就绪”“编辑器”缺席检查通过                 |

## 失败与边界覆盖

- service 集成测试覆盖非 Git 工作空间和父仓库子目录，后者不会越界成为可操作仓库。
- store 测试覆盖工作空间切换时丢弃迟到快照。
- parser 测试覆盖 staged/unstaged/untracked/conflicted、rename、detached、unborn 和 binary；
  二进制或未跟踪内容无法计算完整行数时以不完整标记表达。
- commit 集成测试覆盖 partial staged 保留、stale revision、敏感文件阻断和用户 Git identity；
  Push 集成测试使用本地 bare remote 验证固定 upstream 与远端 HEAD。
- Git 缺失或读取失败返回结构化能力降级，不阻断 Studio 其他本地能力。

## 未关闭项与残余风险

- 尚未记录最终 commit SHA；当前工作区同时存在用户的 Agent 面板在途改动，Git 实现不能把
  无关文件混入提交。
- 还需真人逐项执行 G1-G4 已实现路径，并补真实 GitHub HTTPS、SSH Agent、认证失败、离线和
  non-fast-forward 结果。
- G5 前侧栏兼容备份入口仍保留，状态读取与兼容备份写流程暂时并存。
- 新入口尚未提供显式 Fetch、首次 remote/upstream 关联或 GitHub 名称建仓，这些仍由 Terminal
  或兼容备份入口承担。
- upstream/ahead/behind 仅代表本机 refs；G4 显式 Fetch 完成前不得称为远程最新状态。
