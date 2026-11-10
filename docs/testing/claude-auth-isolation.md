# Studio 与本机 Claude 登录隔离

## 用户验收动作

1. 保持 Claude 桌面端登录，启动 Studio；本机 Claude 登录不是 Studio 的认证前提。
2. 在 Studio「设置 → Agent」保存 Claude API Key、端点和模型，点击「测试连接」；新建空会话，选择「Claude Code（备选）」后发送一条普通消息。
3. 改用无效 Key：显示认证失败，不回退到 Claude 订阅，也不弹出订阅登录。
4. 清除 Key 后发送消息：提示在 Studio 配置 Key，不能向模型服务发送请求；重启后仍然如此。
5. Claude 桌面端继续使用原登录。Studio 不执行 logout，不读取、迁移或改写原认证文件。

## 实现边界

- 普通本地 Claude 后端的 system、custom、bundled、managed 四种来源共用同一认证策略。
- Key 的唯一来源为 Studio `CredentialService`。缺失时 Claude 初始化和发送入口拒绝模型调用；
  Agent 核心仍可启动，默认 Codex 会话使用自己的认证链路；
  清除凭证通过原配置锁重建 backend，活动 Run 期间仍由原配置锁保护。
- 主进程向子进程注入 `userData/agent-runtime/claude-api`，清理继承的 `CLAUDE_*`、
  `ANTHROPIC_*`（包含 OAuth token、文件描述符、host credential file、endpoint 和 headers）。
- SDK 显式使用 `settingSources: []`，不加载本机或项目的 Claude settings；Studio 自己的角色、
  Skills 提示、MCP 和权限 hook 保留。原生 Claude settings / CLAUDE.md 的自动加载不再是
  Studio 的隐式输入，工作资料仍可通过 Studio 显式提供。
- 真实 macOS Claude 2.1.211 在设置 API Key 后仍会探测系统凭证。Studio 私有 PATH 中的
  无凭证探测程序只返回失败，不调用系统 `security`；`sandbox-exec` 同时禁止真正的凭证工具、
  凭证服务及本机 Claude 配置目录的读写。保护无法启动即失败，不以无保护进程重试。
- 版本探测、模型连接测试、普通对话、压缩与恢复均使用同一受保护启动入口。版本探测目录
  临时创建并清理；普通会话目录仅位于 Studio userData，不修改全局 HOME、shell 配置或登录。
- 认证隔离版本进入 Session 兼容指纹。旧共享目录的 SDK Session 不迁移；Studio 可见聊天记录
  保留，后续请求建立隔离的 SDK Session。
- macOS 文件保护校验覆盖 `/var` 与 `/private/var` 的路径规范化。配置目录及探测程序的符号链接
  不被接受。该保护只约束 Studio 的 Claude 子进程及其后代，不限制独立 Claude 桌面端。
- 冻结的实验 `cclink-agent` HTTP 后端、远程主机 Agent 和 Codex 的认证路径不属于这次本地
  Claude SDK 修改范围；未启用、迁移或发布这些路径。

## 2026-11-10 验证记录

用户功能验证使用真实 Electron 和真实 Claude 2.1.211；模型服务为本机模拟 API，未使用真实
订阅或付费 Key。它验证实际认证链路和应用行为，不代表真实提供商的模型质量或网络可用性。

| 场景                                 | 结果                                             |
| ------------------------------------ | ------------------------------------------------ |
| 未配置 Key、父进程包含外部 Key/OAuth | 拒绝请求，工作台正常启动                         |
| 设置页面保存 Key、点击连接测试       | 真实 Claude 进程成功返回                         |
| 普通 Agent 对话                      | 成功；服务端收到的认证只属于 Studio 配置         |
| 无效 Key                             | 401 失败，无订阅回退                             |
| 清除 Key 后立即发送、再重启          | 均拒绝请求；模拟服务请求数不增加                 |
| 外部登录文件读写                     | OS 拒绝；伪造的外部登录文件保持原样              |
| 普通文件操作                         | 允许，未削减文件工具来完成隔离                   |
| 本机 Claude 桌面端                   | 未操作其进程或登录；真人继续发送消息仍需用户验收 |

工程准备度：全量测试 3705 通过、11 跳过；真实进程隔离 smoke 5 项通过；构建、受影响文件
ESLint、凭证边界检查通过。未执行正式发版，另一台电脑上的旧版本不自动获得此修复。

复跑：

```bash
CCLINK_CLAUDE_AUTH_REAL_SMOKE=1 pnpm exec vitest run src/main/agent-core/runtime/claude-process-environment.test.ts
pnpm build
node scripts/claude-auth-isolation-ui-smoke.mjs
```

UI smoke 使用独立临时 userData，输出 `result.json`、`configured.png` 和 `cleared.png` 的目录。
本次成功记录：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-auth-ui-tBEPd1`。

Codex 默认接入后的真实 Electron 回归再次通过：有效 Key 对话与连接测试成功，无效 Key
返回 401，清空 Key 后即时及重启均拒绝 Claude 请求且无订阅回退。证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-auth-ui-uk4eOX`。

### 同日真实 DeepSeek 备用方案验收

用户可执行的流程：在「设置 → Agent」选择 DeepSeek、保存自己的 Key 并测试连接；新建
会话，首条消息前选择 Claude Code，要求读取及创建工作空间文件；重启后继续该会话。
另建会话应仍默认 Codex，清除 Claude Key 后 Codex 仍应正常回答。

以上流程已通过真实 Electron、Claude Code、本机 Codex 和实际付费模型请求验证。
使用 Studio 的 DeepSeek 预设：Anthropic 格式、`https://api.deepseek.com/anthropic`、
`deepseek-chat`。该模型名实测仍可用；本轮 `/models` 返回的当前模型为 `deepseek-flash`
和 `deepseek-v4-pro`，未擅自修改用户原有模型配置。端点及 API Key 请求头依据
[DeepSeek 官方兼容接口文档](https://api-docs.deepseek.com/guides/anthropic_api/)。

| 用户动作                         | 实测结果                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| 保存 Key，点击测试连接           | 真实 Claude 进程调用 DeepSeek 成功                                 |
| 切换 Claude Code，读取及创建文件 | Studio editor_read / editor_write 成功，磁盘内容一致               |
| 重启并继续 Claude 对话           | 原生 Session ID 一致，准确回答上一轮写入标记                       |
| 配置 DeepSeek 后另建会话         | 仍默认 Codex，实际工具调用成功                                     |
| 清除 Claude Key                  | Claude 返回 AUTH_REQUIRED；新建 Codex 会话继续正常回答             |
| 测试凭证清理                     | 临时凭证清除后全目录扫描无 Key 残留，测试 profile 和工作空间已删除 |

本轮真实 Codex 调用暴露 `editor_read` 把错误的 `path` 参数静默视为当前编辑器读取、
最终超时的问题。现已对未知参数和无效 `filePath` 即时报错。修复后的真实模型收到提示后
改用 `filePath`，读取成功；没有增加路径别名或扩大文件权限。

工程门禁：130 项受影响测试通过，2 项可选真实进程 smoke 跳过；本节真实 UI 验收单独
执行。类型检查、构建、受影响 ESLint、格式检查和凭证边界检查通过。

真实窗口及事件证据：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-provider-ui-ZxcXqI`。
最终结论见 `verified-result.json`。原 `result.json` 保留了最后一项测试断言失败：它把
分段流式文本当作完整字符串搜索；实际回复为 `CODEX_STILL_READY`。脚本已改为拼接文本
增量，并用保存的 `turn-5.json` 完整事件验证修正后的断言，没有重复消耗模型额度。

复跑使用 `node scripts/claude-provider-ui-smoke.mjs`，Key 通过标准输入传入；不要把 Key
放进源码或命令行参数。脚本只使用独立临时配置，不保存到用户日常 Studio profile。

限制：本次真实进程与 UI 验证在 macOS arm64 上执行；其他系统未做真人验收。macOS 依赖系统
提供的受保护进程启动能力；不可用时必须明确失败，不能降低凭证保护条件。
