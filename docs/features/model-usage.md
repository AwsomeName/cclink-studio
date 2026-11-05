# 模型输入输出用量统计

## 用户验收与边界

用户在 Studio 完成一次普通 Claude Code 任务（允许多轮工具调用），在项目终端执行
`pnpm usage report --month YYYY-MM`，能看到新增调用、Token 与数据覆盖；再次导入同一份
会话日志后总量不变；可导出 CSV / JSON，停止统计不影响 Agent。

本轮选择现有 Claude Agent SDK 事件作为实时来源、Claude Code JSONL 作为历史回填来源。
不增加模型代理，不改变服务商、套餐、任务调度或权限。现有 usage-events.jsonl 是混合媒体
数量/任务金额账本，不能提供调用唯一键与跨进程事务；模型明细使用项目已采用的
node:sqlite，独立保存在 userData/model-usage/usage.sqlite，由现有 UsageLedgerService
拥有生命周期。原有媒体账本保留。

统计是可降级的观察者：错误写入脱敏诊断和统计健康状态，不抛给任务；只保存白名单元数据，
不保存提示词、回答、工具参数、文件正文、鉴权信息或原始事件。无新增 renderer 权限或 IPC。
统计金额不是安全、预算或套餐授权边界。

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
历史没有两者时列为无任务归属调用，不能把会话数当成任务数。显式分类存于用量配置，
不改变原调度：

```bash
pnpm usage classify --task TASK_ID --category daily-report
pnpm usage classify --session SESSION_ID --category development
pnpm usage configure
```

类别为 collection、analysis、daily-report、writing、development、other、unclassified。
任务分类优先于会话分类；排除开发仍保留未分类。配置 JSON 可用
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
代码、时间和本进程失败次数，`pnpm usage status` 显示最后一次告警。该历史告警不会因后续
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

真人在 Studio 中的下一步验收：启动本源码版本 → 完成一个实际 GLM 任务 → 用 `report --day`
查询该北京时间日期 → 检查调用增长、任务归属、失败/缺失与原始记录 → 重复 backfill 后总量
不变 → 导出 CSV/JSON。**本轮未发起用户 GLM 的新付费任务；这一真人应用验收仍待完成。**

## 尚未覆盖及不能据此推断的事项

- SDK/日志没有暴露的内部 HTTP 重试、自动压缩辅助调用、进程崩溃前未落盘请求，无法补造
  用量或次数；统计为已观察范围。SDK 事件缺失时通过同会话最终 transcript 尝试补齐。
- 后台子代理在所属 Runtime 退出后继续产生的新记录，不保证自动归属本 Run，可再次手动
  backfill；历史缺少 run/task/request ID、provider、耗时与重试序号时保留 null。
- 连接测试也采集，显式类别为 other。实验性 cclink-agent、Codex ACP、CCLink 远程 Agent、
  其他机器、独立外部 Claude 使用和图像/视频服务 Token 不在此采集链；图片/视频原账本保留。
- GLM 的独立思考字段缺失，不能根据输出正文猜测；兼容协议的 Token 口径也不能证明套餐
  prompts、相对额度、积分与 Token 存在固定兑换比例。
- 配置价格接口已经提供，实际账单导入、费用计算和复杂图形仪表盘未实现。

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
