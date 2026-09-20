# ADR 0020：除删除/终止外自动允许的权限模式

- 状态：accepted
- 日期：2026-09-19
- 负责人：CCLink Studio

## 问题

现有权限模式只有 `auto / categorized / strict` 三种，且 `AgentToolAuthorizationBroker`
把 SDK `Bash` 与 `KillShell` 全量登记为 destructive。broker 对 destructive 风格强制
逐次确认且禁用「始终允许」，与权限模式无关。结果是即使用户选择 auto，每条普通 Bash
命令（构建、测试、查看目录）仍然逐次弹确认，Agent 无法连续完成普通工程任务。

用户需要一个明确的新模式：除删除类与终止进程类操作外，工具调用自动放行；删除与
kill 仍逐次确认且不能被「始终允许」跳过。同时暴露出两个既有缺陷：

1. 会话输入框的权限菜单走 `agent:setPermissionMode`，只修改内存中的
   `PermissionManager.mode`，不持久化设置；重启后回退为设置页旧值，两个入口显示不一致。
2. 切换权限模式时，主进程把等待中的确认全部 `resolve(false)`，但渲染进程的确认卡
   不会被撤除，形成无响应的孤儿卡，用户得不到「为什么被拒绝」的说明。

## 决策

### 1. 新增第 4 种权限模式 `auto-except-destructive`

- `PermissionMode` 联合类型扩展为
  `['auto', 'auto-except-destructive', 'categorized', 'strict']`，单一声明源放在
  `src/shared/settings-constants.ts` 的 `PERMISSION_MODES`；settings zod schema、
  settings-service 校验集合、settings-ipc 校验集合和 `AgentPermissionMode` 全部从该常量
  派生，消除五处字符串清单重复。
- 默认值保持 `auto` 不变；只有用户显式选择才写入设置并持久化。
- 模式语义：
  - 删除/终止类操作：**所有模式**下逐次确认、`allowAlways: false`。
  - 其余工具调用（读取、编辑、创建、构建、测试、普通 Bash、浏览器交互等）：新模式
    下自动放行，不再弹出通用确认。
  - 工具自声明 destructive 但不属于删除/终止类（如 `browser_evaluate`）：新模式下
    自动放行；`auto` 模式维持现状（仍确认）。这是两种模式的本质区别。

### 2. `AgentToolAuthorizationBroker` 仍是工具授权策略唯一 owner

- 新模式的判定逻辑全部落在 broker：broker 通过 `ToolPermissionController.getMode()`
  读取当前模式（`PermissionManager` 继续是模式运行时持有者与确认交互执行者），
  不引入第二份权限状态。
- 以下既有下限**不被任何模式（含新模式）削弱**，与本 ADR 无关地继续生效：
  - 定时任务只读工具策略；
  - human-exclusive 工具（`android_shell`）直接拒绝；
  - 未登记分类的内部/SDK/外部 MCP 工具 fail-closed 拒绝；
  - 浏览器动作守卫等模块 `executionPolicy.requireConfirmation` 产品级确认
    （验证码、付款、法律声明、发布/提交/发送敏感卡点仍由对应产品流程管理）；
  - `authorizationSatisfied` 有界任务授权去重——已授权的发布、提交、发送不再追加
    重复工具确认；但**删除/终止类不被任务预授权豁免**；
  - 工作区路径边界、禁用工具模块、SDK allowedTools 范围。

### 3. Bash 从「全量 destructive」改为按命令分类

- 根因修复：`Bash` 不再静态登记为 destructive。broker 对 `Bash` 的
  `params.command` 做静态单行分析：
  - 命中删除/终止类（见下）→ destructive，逐次确认、`allowAlways: false`；
  - 未命中 → write 级，走当前模式的通用判定。
- 按命令分类对所有模式生效：未命中删除/终止类的 Bash 归为普通 write。`auto` 与
  `auto-except-destructive` 均直接放行普通 Bash；`categorized/strict` 仍按各自模式确认。
  两种自动模式的区别仍在于非删除/终止但由工具声明为 destructive 的操作：`auto` 保留
  工具声明的强制确认，`auto-except-destructive` 自动放行。
- `KillShell` 维持 kill 类 destructive。
- 删除/终止类识别范围（`deleteKillReasonFor`）：
  - 结构化工具：`KillShell`、`browser_clear_cookies`、`android_uninstall_package`、
    `cad_clear_cache`（删除 Studio 自有缓存）；
  - Shell 命令词：`rm`、`rmdir`、`unlink`、`shred`、`trash`、`git clean`、`git rm`、
    `find` 携带 `-delete` 或 `-exec/-execdir rm`、`kill`、`pkill`、`killall`，以及同具
    终止语义的系统命令 `shutdown`/`reboot`/`halt`/`poweroff`；
  - 复合结构：按 `&&`、`||`、`;`、`|`、`&`、换行分段，任一段命中即命中；剥离
    环境变量前缀与 `sudo`/`env`/`nohup`/`nice` 包装；`xargs` 的命令操作数递归判定；
  - 内联代码：`bash/sh/zsh/dash/ksh -c <literal>`、`node -e`、`python -c`、
    `osascript -e`、`eval <literal>` 与 `$(...)`/反引号替换内容递归分析。

### 4. 静态识别边界必须如实（不承诺绝对保证）

- **可判定**：命令行文本本身写明的删除/终止（含引号、复合、内联字面量、命令替换
  字面量）。
- **fail-closed 转确认**：命令行动态构造且无法解析出确定命令词的场景，如
  `eval "$VAR"`、`bash -c "$CMD"`（命令位是变量）。理由：模型没有正当理由动态拼接
  自身要执行的命令，该形态按未知默认暂停处理。
- Shell 控制结构按透明前缀处理：控制关键字（`if/then/elif/else/for/select/while/
  until/do/done/fi/esac/case/function`）跳过后，剩余命令词照常判定（`then rm x` 与
  `rm x` 同判）；`for var in <words>` 的循环项、`case` 的主题词与分支模式不是命令词，
  跳过。循环体/分支体在各自的 `do`/分支段中另行分析。`env -S` 动态拆分命令仍需确认。
  已覆盖包装命令的常用带值参数、xargs 带值参数和注释后继续执行的多行命令。
- **无法透视、按普通命令放行**：脚本文件执行（`bash x.sh`、`node x.js`、`./x.sh`、
  `source x`）与包管理器/构建工具内部行为（`pnpm test`、`make` 内部可能删除文件）。
  静态单行分析看不到文件内容与 runner 内部实现；若对这些 fail-closed，「构建/测试
  自动放行」的产品目标无法成立。此残余风险在设置页说明与交付报告中明示。
- 该边界是信任一致性问题：与 `pnpm test` 同级的 `bash script.sh` 不做二次猜测。

### 5. 模式切换的等待中确认处理

- 切换模式（值真实变化）时，主进程把等待中的确认全部按拒绝结束（工具不执行、不会
  重复执行），并通过新增 `agent:confirmationsInvalidated` main→renderer 事件携带被
  撤销的确认 ID 与原因；渲染进程收到后撤除对应确认卡并向用户说明。事件走既有
  shared contract + preload 校验 + 事件库存登记流程。
- 删除/终止类确认卡通过新的有界 `guard` 字段展示主进程生成的静态原因
  （如「删除类操作（rm）需要逐次确认」）；`guard` 不承载工具参数，preload 按
  128 字符上界校验。

### 6. 两个入口统一持久化

- 会话输入框权限菜单与设置页权限策略下拉都通过 `settingsService.set`
  （`settings:set`）持久化并即时 `PermissionManager.setMode`；
  `agent:setPermissionMode` IPC 保留但同样落盘，防止遗留调用制造第二份状态。
- 重启后 `core-services` 启动时按设置恢复模式；渲染进程启动时经
  `agent:getPermissionMode` 对齐显示。

## 不变量

- 权限模式的运行时唯一持有者仍是 `PermissionManager`（主进程）；策略判定唯一入口
  仍是 `AgentToolAuthorizationBroker`；持久化唯一 owner 是 `SettingsService`。
- 删除/终止类确认不可被「始终允许」、任务预授权或任何模式跳过。
- 架构宪法 §7 的特殊卡点（验证码、付款、法律声明、破坏性删除、批量影响、未知默认
  暂停）与浏览器动作守卫优先于通用权限模式；模式不能扩大任务授权。
- 默认设置 `permissionMode: 'auto'` 不变。

## 备选方案

- **让 `auto` 继续确认所有 Bash**：这会把普通构建、测试和诊断错误地当作 destructive，
  与界面“低风险操作自动放行”的承诺冲突，被否决。`auto` 仍保留非 Bash 工具的 destructive
  注解确认；`auto-except-destructive` 只保留删除/终止和产品级人工卡点。
- **对脚本文件执行也 fail-closed**：会让 `bash scripts/x.sh`、构建脚本全部退回逐次
  确认，与产品验收目标冲突，被否决（改为披露残余风险）。
- **把删除/kill 判定放进 `PermissionManager`**：制造第二套策略状态，违反 broker
  单一 owner 约束，被否决。

## 风险与影响

- 静态分析漏判（runner 内部删除、未来新增 shell 手法）：模式不承诺绝对保证；
  UI 与交付报告披露识别范围；`strict`/`categorized` 模式仍提供更强确认面。
- 新模式为显式选择；旧 `auto` 模式的 Bash 确认行为保持不变。
- 新增 main→renderer 事件：走完整 contract/校验/库存流程，畸形 payload 忽略。

## 迁移计划

- 旧设置文件中的 `permissionMode` 只可能是旧三值，读取路径无需迁移；新值只由用户
  显式选择写入。
- `agent-core/tools/types.ts` 的本地 `PermissionMode` 定义改为从
  `shared/settings-constants` re-export，消除双定义。

## 回收或复审条件

- 若未来出现 broker 之外的第二处模式判定逻辑，本 ADR 的 owner 约束被违反，必须复审。
- 若删除/终止识别需要扩大到 runner 内部行为（如脚本内容扫描），需按新证据重评
  fail-closed 范围并更新本 ADR。

## 验证

- 授权策略单元测试：shell 分类器矩阵、broker 新模式行为矩阵、既有模式下限回归。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 真实 Studio 验收：模式切换、普通读写、普通 Bash 构建/测试、连续工具调用、删除
  确认（隔离临时文件）、kill 确认（专用测试进程）、拒绝后行为、重启恢复、两个入口
  一致性。未完成真实 App 验收的部分在交付报告中标注待验收。
