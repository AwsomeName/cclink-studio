# Git 源码管理验收记录

> 当前阶段：G1-G3、统一操作窗口与已有 upstream Push 自动化真实 App 验收通过；G4 剩余项、G5 和真人验收待补
>
> 日期：2026-08-17
>
> 基线：`main` / `9fe1a215`，验收对象包含统一操作窗口提交及其后的界面、测试和文档工作区差异

## 用户功能结果

真实 Electron 应用打开当前 Git 根工作空间后，左下角显示真实分支、去重变化数和已知增删
行数。点击状态段可查看仓库、分支、upstream、本机已知 ahead/behind，进入分组变更并打开
有界只读 Diff。小浮层只承担状态摘要和入口；变更、Diff、提交与 Push 进入一个顶层统一操作
窗口。窗口背景点击不关闭，Esc/关闭按钮在存在提交草稿时先确认，写操作期间禁止关闭；刷新
产生新 revision 后必须接受最新状态才能继续写操作。状态栏不再显示常驻“Agent 就绪”和
活跃 Tab 类型“编辑器”。

状态栏右侧旧“备份到 Git”按钮已经移除；“网站与账号”侧栏中的兼容建仓卡片仍保留到 G5。

临时真实仓库 UI 路径完成了两轮写操作：第一轮只选择 `tracked.txt`、填写提交信息、触发 Esc
并确认草稿没有丢失、commit、确认未选的 `leave-untracked.txt` 仍存在，再单独 Push 已有
提交；第二轮从外部修改文件、刷新并接受最新 revision，然后选择“提交并推送”。两轮最终都
确认远端 HEAD 等于本地提交，第一轮提交没有自动 Push。

## 自动化证据

| 检查                 | 结果                                                                |
| -------------------- | ------------------------------------------------------------------- |
| TypeScript           | `pnpm typecheck` 通过                                               |
| Git 定向测试         | store、统一窗口边界、Status Bar 共 7 条通过                         |
| 全量测试             | 282 个测试文件通过；1631 个测试通过，2 个跳过                       |
| Electron UI smoke    | `pnpm smoke:ui` 16/16 通过                                          |
| Git 用户路径         | 状态、分组 Diff、草稿保护、精确 commit、单独 Push、提交并 Push 通过 |
| revision / workspace | 刷新后重新确认与切换工作空间清理草稿通过 store/UI 自动化            |
| 状态栏收敛           | “Agent 就绪”“编辑器”缺席检查通过                                    |

`pnpm verify` 已通过边界检查、格式、Lint 和全量测试，最后的 Build/typecheck 被工作区内并行新增且
尚未提交的 `agent-panel-view.tsx` 阻断：它从 `image-attachments.ts` 导入了未导出的
`AgentImageAttachment`。Git 功能实现前的独立 `pnpm typecheck` 已通过，Git UI 的受影响 smoke
已通过；由于当前共享工作区整体门禁不是全绿，本记录不把 `pnpm verify` 标为通过，也不修改该
无关 Agent 在途文件。

## 失败与边界覆盖

- service 集成测试覆盖非 Git 工作空间和父仓库子目录，后者不会越界成为可操作仓库。
- store 测试覆盖工作空间切换时丢弃迟到快照。
- store 测试覆盖操作窗口草稿跨刷新保留、baseline revision 不被静默推进，以及切换工作空间后清空
  对话框和草稿；UI smoke 覆盖脏草稿 Esc 确认与刷新后的 stale gate。
- parser 测试覆盖 staged/unstaged/untracked/conflicted、rename、detached、unborn 和 binary；
  二进制或未跟踪内容无法计算完整行数时以不完整标记表达。
- commit 集成测试覆盖 partial staged 保留、stale revision、敏感文件阻断和用户 Git identity；
  Push 集成测试使用本地 bare remote 验证固定 upstream 与远端 HEAD。
- Git 缺失或读取失败返回结构化能力降级，不阻断 Studio 其他本地能力。

## 未关闭项与残余风险

- `9fe1a215` 已包含统一窗口主体，但提交同时吸收了工作区内其他在途修改；后续验收必须继续
  按文件审计，不能把无关工作流、项目切换或 Markdown 改动算作 Git 功能证据。
- 还需真人逐项执行 G1-G4 已实现路径，并补真实 GitHub HTTPS、SSH Agent、认证失败、离线和
  non-fast-forward 结果。
- G5 前侧栏兼容备份入口仍保留，状态读取与兼容备份写流程暂时并存。
- 新入口尚未提供显式 Fetch、首次 remote/upstream 关联或 GitHub 名称建仓，这些仍由 Terminal
  或兼容备份入口承担。
- upstream/ahead/behind 仅代表本机 refs；G4 显式 Fetch 完成前不得称为远程最新状态。
- 自动化已覆盖“提交并推送”成功，但尚未在 UI smoke 中注入“Commit 成功、Push 失败”；当前
  通过持久结果分支和源码边界测试约束“本地提交已保留”，仍需人工/集成失败注入关闭风险。
