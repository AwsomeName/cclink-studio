# M3 核心内容工作面验收

> 状态：真人验收进行中，H1 已通过；H2-H4 全部通过后才能关闭 M3。

## 验收规则

- 使用同一个待验收构建，一次只确认一项。
- 不记录密码、Cookie、Token、验证码、完整查询参数或消息隐私内容。
- 失败时记录现象和脱敏诊断，修复并补回归测试后从失败项重测。
- H1-H4 未全部通过前，`docs/features/context-action-system.md` 不得标记 M3 已完成。

## H1：Browser 原生菜单与 Profile

步骤：

1. 在已登录网站的 Browser Tab 内分别右键普通页面、文本选区、链接和输入框。
2. 确认菜单内容随目标变化；输入框可正常编辑，网页没有被脚本改写。
3. 从链接菜单选择“在新 Studio Tab 打开”，确认仍使用原 Tab 的 Profile 且登录状态保持。
4. 选择“发送给 Agent”，确认资源进入 Composer，但没有自动发送消息。

通过标准：菜单正确、Profile 不变、登录态不丢、未调用系统浏览器、未自动发送。

结果：2026-07-22 真人验收通过。Browser 菜单按目标正确变化；新 Studio Tab 保持原 Profile 与登录状态；未调用系统浏览器；挂载 Agent 资源未自动发送。

## H2：Terminal 输入与危险确认

步骤：

1. 在 Terminal 右键粘贴一条明显但无副作用的命令，例如 `printf 'm3-paste-ok\\n'`。
2. 确认命令只出现在输入区，没有自动执行；手动按 Enter 后才运行。
3. 对正在运行的 Terminal 选择终止，先取消一次，再重新操作并确认。

通过标准：粘贴不提交；取消不终止；确认只终止目标 session，并留下可诊断的生命周期记录。

结果：待确认。

## H3：Agent Thread 与消息

步骤：

1. 右键一条 Agent 消息，选择引用到输入框，确认只生成草稿且没有自动发送。
2. 启动一个可安全取消的运行，在对应 Thread 菜单选择停止。
3. 同时观察其他 Thread，确认其运行和消息状态不受影响。

通过标准：引用不发送；停止只作用于重新验证后的当前 `runId`；其他 Thread 不变。

结果：待确认。

## H4：跨项目失效

步骤：

1. 在项目 A 打开 Browser、Terminal 或 Agent 的上下文菜单但不执行。
2. 切换到项目 B，再尝试使用旧菜单；返回项目 A 后检查原 Browser Profile、Terminal session 和 Thread。

通过标准：切换时旧菜单立即关闭或失效；项目 B 不执行项目 A 的动作；返回后项目 A 的运行状态仍正确。

结果：待确认。

## 自动化证据

- 全新 detached worktree 完成 `pnpm install --frozen-lockfile`。
- `pnpm verify` 通过：151 个测试文件、902 项测试。
- `pnpm smoke:standalone` 通过：local 9/9、UI 6/6、workflow 7/7、restore 4/4。
