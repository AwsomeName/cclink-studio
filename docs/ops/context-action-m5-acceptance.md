# M5 上下文操作退出验收

> 状态：待验收。日期：2026-07-22。分支：`codex/context-action-m5`。

## 自动化基线

- [x] catalog：command/contribution 唯一、无孤儿、21 种 target 全覆盖。
- [x] boundary：17 个 renderer owner、1 个 native owner、1 个 Store owner。
- [x] 诊断：构建失败、陈旧目标、权限拒绝、领域失败可区分且默认脱敏。
- [ ] `pnpm verify` 和 `pnpm smoke:standalone` 在最新提交的全新 detached worktree 通过。

当前工作树证据：`pnpm verify` 通过（155 files / 937 tests）；`pnpm smoke:standalone`
通过（local 9/9、UI 6/6、workflow 9/9、restore 4/4）。workflow 的键盘与焦点检查连续
复跑三轮通过。提交后的全新 detached worktree 复验仍待执行。

## H1 区域与对象

- [ ] 在项目、文件、Tab、消息、Terminal 和任一领域对象上右键，菜单只出现与当前对象有关的操作。
- [ ] 装饰空白和凭证输入行不出现无意义或敏感菜单。

## H2 纯键盘

- [ ] 使用 `Shift+F10` 打开菜单，方向键、Home/End、Tab/Shift+Tab 可移动，Enter/Space 可执行，Escape 可关闭并回到原对象。

## H3 视觉与边界

- [ ] 普通、禁用和危险项可区分；禁用项显示原因。
- [ ] 窄窗口、全屏和屏幕边缘菜单不被裁切，长文本不溢出。

## H4 诊断与隔离

- [ ] “开发者：复制工作台状态诊断”包含“上下文操作”小节且不包含凭证原值。
- [ ] 项目切换会关闭旧菜单，旧动作不能落到新项目；一个可选模块失败不影响其他菜单。

## H5 关键回归

- [ ] Browser 登录 Profile、Terminal 粘贴/终止确认、Agent 引用/停止和领域人工确认边界保持不变。

## 关闭条件

- H1-H5 全部通过并写回结果。
- 区域库存、README、架构与开发文档均为当前事实。
- 最新提交在全新 detached worktree 通过锁定安装、`pnpm verify` 和 standalone。
- 分支已推送且工作树干净，之后才能宣称统一上下文操作系统完成。
