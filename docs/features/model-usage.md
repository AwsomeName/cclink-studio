# 模型输入输出用量统计

## 用户验收与边界

用户在 Studio 完成一次普通 Claude Code 任务（允许多轮工具调用），打开 **设置 → 模型用量**，
能看到新增调用、Token 与数据覆盖；点击活跃日期或柱状图查看调用，显式分类后切换“排除开发”；
CSV / JSON 导出与界面筛选一致；再次回填相同日志总量不变；关闭采集、重启后历史仍在。
终端 `pnpm usage report` 继续可用。模型服务商、套餐和原任务调度方式保持不变。

效果图存档：`docs/design/model-usage/settings-overview.{html,png}` 与
`docs/design/model-usage/activity-trends.{html,png}`；设计示例不是实际用量证据。

本轮选择现有 Claude Agent SDK 事件作为实时来源、Claude Code JSONL 作为历史回填来源。
不增加模型代理，不改变服务商、套餐、任务调度或权限。现有 usage-events.jsonl 是混合媒体
数量/任务金额账本，不能提供调用唯一键与跨进程事务；模型明细使用项目已采用的
node:sqlite，独立保存在 userData/model-usage/usage.sqlite，由现有 UsageLedgerService
拥有生命周期。原有媒体账本保留。

统计是可降级的观察者：错误写入脱敏诊断和统计健康状态，不抛给任务；只保存白名单元数据，
不保存提示词、回答、工具参数、文件正文、鉴权信息或原始事件。事件进入后台队列前即提取
白名单元数据。renderer 只通过受信任、参数校验的专用 IPC 查询、分类、开关与导入导出；
文件选择和导出位置由主进程原生对话框决定，不接受 renderer 传入的任意读写路径。
统计金额不是安全、预算或套餐授权边界。

## 设置页与生命周期

- 设置页紧邻 Agent。支持今日、本周、本月、近 30 天和任意日期，以及工作空间、模型、
  任务类别筛选。UI 日期两端均含当天，转换为北京时间左闭右开的查询区间。
- 界面与 CLI 共用 `buildReport`。概览提供最近一年活跃热力图、按日／周／月汇总的堆叠
  柱状图（Token 构成／模型）、分类汇总、滚动峰值与字段缺失。点击日期进入调用明细。
- 活跃图以调用次数或已知 Token 着色；没有记录不等于零。按本机采集时段和心跳判断覆盖，
  未证明全天健康采集的空日期显示斜纹。日志起止日期不代表中间连续覆盖。
- `UsageLedgerService` 仍拥有唯一的用量服务。后台 Worker 执行 SQLite、导入和汇总，
  不阻塞 Electron 主进程；最多 1,024 个待确认请求，超限／超时告警，原模型任务继续。
  原数据库记录不重写，新增采集时段、恢复检查点和显式执行分类配置。
- 启动、任务结束和每 30 秒维护时补扫已由 Studio 观测的会话。按文件 inode、偏移和修改
  时间读取增量，未完成尾行留待重试；截断后重扫仍去重。晚到子代理无法可靠归属执行时
  保留归属为空。关闭采集后的新主调用不会被自动补扫重新计入；主动历史回填仍可使用。
- UI 只拥有筛选和展开等临时展示状态。IPC 跟随现有可信注册表清理，Worker 跟随原用量服务
  关闭；不新增代理、后台守护进程或调度器，不依赖登录或远程初始化。

## 已核实的来源

- 本仓库使用 @anthropic-ai/claude-agent-sdk 0.3.211，启用了 includePartialMessages。
- assistant.message.usage 有真实输入/缓存，但其 output_tokens 可能只是响应开始占位值。
  输出以流式 message_delta 的最终累计值为准。同一 message.id 可能产生多个 assistant 块，
  必须更新同一调用而非累加。未获得可靠输出证据时，保留原始值，标准化输出为 null。
- system.api_retry 暴露部分重试；未暴露的内部 HTTP 尝试无法可靠恢复，计数是观测下限。
- result.usage 仅覆盖当前主 Agent turn，按此范围与主调用明细对账；modelUsage 包含子代理，
  新版本恢复会话时还可能包含历史累计，只单独保存快照，不与逐次或子代理记录相加。
- 本机 Studio 管理的历史日志：2026-09-10T17:10:04.864Z 至
  2026-10-09T17:35:17.807Z；26,454 条 assistant 记录、10,427 个会话/消息唯一标识
  （包含 synthetic 错误标识，最终调用数由导入器判定）。这是本机检查结果，不是产品预设。
- GLM 历史记录有 input/output/cache read/cache creation，未提供独立 thinking。
  历史服务商、任务/运行标识、耗时及隐藏重试通常缺失，不从模型名称或正文猜测。

## 口径

保存白名单内原始 usage 数值与标准化字段。Anthropic Messages 协议的 input_tokens
不含缓存读写；output_tokens 包含思考，思考只展示分项，不再次累加。兼容服务依据协议
解释，不能证明供应商账单或套餐消耗采用相同口径。

参考：[Anthropic 流式累计 usage](https://platform.claude.com/docs/en/build-with-claude/streaming)、
[缓存字段定义](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。

SDK 事件与会话日志不同：本机真实 Runtime 的隔离 smoke 已验证，assistant 事件的输出
占位值为 1/1，流式最终值为 20/30，本地最终 transcript 为 20/30。
只有 transcript 具有 stop_reason 时才将其输出视作最终记录。思考字段也必须有最终
delta 或最终 transcript 的证据，不能使用 message_start 的占位零。
详见 [SDK 用量范围与输出占位说明](https://code.claude.com/docs/en/agent-sdk/cost-tracking)。

缺失字段为 null；完整要求输入、输出、缓存读、缓存写、思考五项均有最终 usage。
没有独立思考字段的 GLM 调用属于部分 usage，不能把“部分”误读为未记录正文输出。
失败、中断、无 usage 与尚未结束的调用分别可见；无法确认发出模型请求的运行错误保留为
运行缺口，不虚构成一次模型调用。未知状态/重试数不置零。

## 直接使用

源代码版启动 `pnpm dev` 或 `bash scripts/restart.sh start` 后，新的 Claude Code Run
默认自动采集，无需另开守护进程。已安装的旧 App 需采用包含本修改的版本，不会因为修改
源码而自动获得能力。CLI 需要 Node >= 22.15 和本项目依赖。

```bash
pnpm usage status
pnpm usage report --month 2026-11
pnpm usage report --day 2026-11-05
pnpm usage report --week 2026-11-05
pnpm usage report --from 2026-11-01 --to 2026-12-01
pnpm usage backfill
pnpm usage export --month 2026-11 --format csv --out usage-2026-11.csv
pnpm usage export --month 2026-11 --format json --out usage-2026-11.json
pnpm usage import --file another-machine-usage.json
```

时间均按 Asia/Shanghai，周一为一周开始；`from` 包含、`to` 不包含。也接受带时区的 ISO
精确时间。`--all` 查询全部历史。默认回填仅扫描 Studio 管理的 Claude projects 目录；
system/custom Claude 或其他目录必须显式传 `--root /path/to/projects`，可重复指定多个 root，
不会自动混入用户独立使用 Claude 的开销。回填包含 subagents 子目录，不跟随子目录符号链接。
服务商无法从历史日志确认，默认为 null；若用户已确认整批日志的服务商，可加 `--provider`。

报告同时包含全部与排除开发两份统计、按日/工作空间/类别/服务商及模型汇总、滚动 5 小时和
7 天已知 Token 高峰、各字段缺失调用数和运行对账。滚动窗口仅使用所选范围内记录，不代表
套餐刷新规则；跨所选范围边界的窗口不包含范围外用量。调用时刻采用首次观测时间；历史日志
采用原记录 timestamp，不能精确还原请求发起时间。流式耗时是观测到 message_start 至结束
的时间，不包含服务端排队和首 Token 等待；历史耗时为空。

已知任务数仅按明确的 taskId 去重；执行次数单独按 Studio runId（一次用户 turn）去重。
同一日报配置执行 30 次为 1 个任务、30 次执行。没有可识别调用的执行仍保留在执行数量和
运行缺口中，不能当成免费请求。在明细中可标记本次执行、整个任务或整个会话的类别。
历史没有两者时列为无任务归属调用，不能把会话数当成任务数。显式分类存于用量配置，
不改变原调度：

```bash
pnpm usage classify --task TASK_ID --category daily-report
pnpm usage classify --session SESSION_ID --category development
pnpm usage configure
```

类别为 collection、analysis、daily-report、writing、development、other、unclassified。
分类优先级为本次执行覆盖（`runCategories`）→ 任务 → 会话 → 原记录显式类别；
排除开发仍保留未分类。配置 JSON 可用
`pnpm usage configure --file config.json` 整体载入。`prices` 保留币种、单位 Token 数、模型、
来源 URL、生效/失效时间及北京时间峰谷输入/输出/缓存费率接口；本阶段没有导入可靠价格表，
不执行费用套算。实际账单保持独立且未录入；SDK 的美元估算不是 GLM 账单。旧媒体账本中的
新 Agent 金额也已修正为 estimated，不追溯改写旧混合账本。

## 数据保存、关闭及跨机器汇总

macOS 默认数据库：`~/Library/Application Support/CCLink Studio/model-usage/usage.sqlite`。
SQLite WAL/SHM 为伴随文件；目录 0700，数据库与导出文件 0600。使用随机安装来源 ID 与进程
实例 ID，不保存硬件指纹。逐次唯一键为协议、sessionId、messageId 的哈希；重试通知以 SDK
通知 UUID 去重。跨机器优先交换本工具 JSON，而不是复制运行中的数据库。JSON 保留原来源
ID 与逐次唯一键，再次导入不增加调用数。CSV 用于分析，空单元格表示缺失，不用于回导。

```bash
pnpm usage disable
pnpm usage enable
```

开关在下一次 Run 生效，在途 Run 会记到结束；也可以在启动 Studio 前设置
`CCLINK_MODEL_USAGE_ENABLED=0`。关闭不删除历史，不关闭 Claude 自身的 transcript。CLI
读取/回填/导出仍可主动使用。`--data-dir` 指定其他 Studio userData，`--db` 指定汇总数据库。
已有文件的导出拒绝覆盖，请选择新文件名。

统计写入失败不改变 Agent 结果；控制台有 `[ModelUsage]` 警告，`last-error.json` 只保存错误
代码和时间，设置页与 `pnpm usage status` 显示最后一次告警。该历史告警不会因后续
一次成功而消失。磁盘本身不可写时仍有控制台警告；数据库损坏时 CLI 明确失败，不返回空账。

## 已验证的用户结果与工程门禁

2026-11-05，本机真实历史日志成功回填：312 个文件、10,427 个唯一调用标识，包含 51 个
子代理模型响应。再次回填新增 0 条，26,454 行全部命中已有标识。
北京时间可回填区间为 **2026-09-11 01:10:04 至 2026-10-10 01:35:17**。
这是现存日志区间，不代表其间所有机器、账号或调用已覆盖。

真实历史报告：输入 53,219,587、输出 4,042,342、缓存读取 1,368,991,552、已提供缓存写入 0；
思考未提供。完整 usage 0、部分 usage 10,416、无 usage 11。
输入缺失 11 次，输出/缓存各缺失 12 次；这些总量仅为已知值。
全部历史任务类别未分类、服务商未确认；模型名按日志原值显示。
本机 JSON/CSV 报告已导出到同一 model-usage 目录的 history-report.json / history-calls.csv。

验证命令：

```bash
pnpm verify
pnpm smoke:model-usage
```

用量测试覆盖累计流式快照、输出/思考占位值、真实最终零值、缓存/思考不重复计数、失败重试、
中断、子代理并发、父汇总范围、重复回填、跨来源合并、三个真实 Node 进程并发写同一数据库、
北京时间跨日及 CSV 注入防护。统计故障隔离还经过真实 backend 生命周期的测试。
`smoke:model-usage` 使用实际 Claude Runtime/SDK 与本地 SSE fixture，实际完成 Read 工具
后的二次模型请求，再导入同一 transcript 验证不重计。没有使用付费 API，也没有读取用户凭证。
最终 `pnpm verify` 已通过（423 个测试文件，3,571 项通过，10 项按原条件跳过；含类型、格式、
Lint、边界门禁与构建）。真实 Runtime smoke 通过；导出的 JSON/CSV 均为 10,427 个唯一记录，
缺失思考字段在 CSV 中为空。

真人验收：启动本源码版本 → 完成实际 GLM 任务 → 打开设置中的模型用量 → 检查调用增长、
任务归属与缺失字段 → 点击日期查看并分类 → 切换排除开发 → 重复回填后总量不变 → 导出
CSV/JSON → 关闭采集并重启检查历史。**未发起用户 GLM 新付费任务，真人 GLM 验收和连续
一个月的实际观察仍待完成。**

## 设置页阶段验证

2026-11-06 设置页阶段验证：8 个受影响测试文件、109 项测试通过；类型检查、Lint 和构建
通过。`pnpm smoke:model-usage-ui` 用实际 Claude Runtime 执行一次 Read 工具及继续推理，
生产 Worker 记录 2 次调用，再在真实 Electron 中验收展示、日期下钻、分类联动、CSV/JSON、
重复回填和导入、关闭后重启保留历史、拒绝非法 IPC 路径参数，全部通过。使用本地 fixture，
**付费 API 调用为 0**；示例 Token 不是用户实际业务消耗。结果与界面截图位于
`docs/testing/model-usage/`。

2026-11-06 提交前在独立工作树复核本用量功能快照（不含并行开发的会话导航与后续消息改动）：
完整 `pnpm verify` 通过，426 个测试文件、3,608 项测试通过、10 项跳过，
类型检查、Lint、格式、边界检查和构建通过。随后重跑上述真实 Runtime + Electron 设置页
烟测，六项检查全部通过，更新 `docs/testing/model-usage/` 证据。首次启动因独立工作树
未复制 Runtime 二进制而失败；显式指定已有 Runtime 路径后通过，未修改应用逻辑。
此前混合导航改动的工作树曾有布局恢复断言失败；本次结果仅证明本用量功能快照的工程门禁，
不替代真实 GLM 用户任务及长期采集验收。

## 尚未覆盖及不能据此推断的事项

- SDK/日志没有暴露的内部 HTTP 重试、自动压缩辅助调用、进程崩溃前未落盘请求，无法补造
  用量或次数；统计为已观察范围。SDK 事件缺失时通过同会话最终 transcript 尝试补齐。
- 已观测会话的晚到子代理通过增量补扫记录，无法证明所属 Run 时不强行绑定。未观测的
  会话、被删除或轮转丢失的日志仍可能缺失；历史缺少的元数据保留 null。
- 连接测试也采集，显式类别为 other。实验性 cclink-agent、Codex ACP、CCLink 远程 Agent、
  其他机器、独立外部 Claude 使用和图像/视频服务 Token 不在此采集链；图片/视频原账本保留。
- GLM 的独立思考字段缺失，不能根据输出正文猜测；兼容协议的 Token 口径也不能证明套餐
  prompts、相对额度、积分与 Token 存在固定兑换比例。
- 价格配置接口已经提供；实际账单导入和费用计算未实现，设置页明确显示未启用。

## 修改位置

- `src/shared/model-usage.ts`：持久化、观察者与价格配置契约。
- `src/main/usage/model-usage-{normalize,collector,store,service,import,report,cli}.ts`：白名单采集、
  SQLite、历史回填、统计/导出/配置；`model-usage.test.ts` 为风险验证。
- `src/main/usage/usage-ledger-service.ts`：复用现有生命周期拥有模型统计服务。
- `src/main/agent-core/backends/{types,backend-factory,local-claude-code-backend}.ts`：可选观察者
  注入，原始 SDK 事件与结束路径；相应 backend 测试验证故障隔离。
- `src/main/agent/agent-bridge.ts`、`claude-model-connection-test.ts`、
  `src/main/runtime/core-services.ts`：装配、诊断调用与旧金额估算标记。
- `scripts/model-usage.mjs`、`scripts/model-usage-smoke.mjs`、`package.json`：直接可用命令与
  零付费真实 Runtime smoke。
- `src/main/usage/model-usage-{engine,worker,worker-contract,ipc}.ts`：后台存储、增量恢复、
  采集时段与设置页接口；`model-usage-engine.test.ts` 验证真实线程、SQLite 锁与恢复路径。
- `src/shared/ipc/model-usage*.ts`、`src/preload/index.{ts,d.ts}`、IPC inventory：唯一调用契约、
  参数校验、可信 renderer 白名单及生命周期登记。
- `src/renderer/src/components/settings/model-usage/`、`SettingsPage.tsx`：设置入口、真实概览、
  活跃图、柱状图、分类明细与数据操作；`usage-view.test.ts` 验证北京时间和覆盖计算。
- `electron.vite.config.ts`：打包后台 Worker；`scripts/model-usage-ui-smoke.mjs`：实际 Runtime
  本地 fixture → 生产 Worker → SQLite → 真实 Electron 界面验收，使用隔离 profile。
