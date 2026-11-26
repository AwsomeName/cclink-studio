# 科技日报验收

> 规格：[personal-techdaily.md](../features/personal-techdaily.md) §15。

## 2026-11-25 配置与试采（真实 Electron，SearXNG 用本机替身）

结论：项目设置里的科技日报配置、SearXNG 测试连接、保存、试采和重启恢复在真实 Electron 中通过。
**这不是日报闭环**：没有生成日报，也没有连接真实 SearXNG 或真实 DeepSeek 搜索。

复现：

```bash
pnpm exec electron-vite build --outDir .cache/techdaily-build
```

```bash
DIARY_BUILD=.cache/techdaily-build node scripts/techdaily-settings-smoke.mjs
```

脚本使用自建的隔离 home/profile，并在本机起一个要求 Basic 认证、记录请求参数的 SearXNG 替身（返回 5 条：两条当天新闻、
一条百科、一条非白名单引擎、一条旧闻）。

| 步骤                                   | 结果                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次打开项目设置 · 我的空间            | 显示“还没有设置文件……9 个领域、54 个搜索词”；默认 DeepSeek，显示“✗ 联网搜索未启用”和“打开联网搜索设置”                                               |
| 选 SearXNG，填地址和错误密码，测试连接 | “SearXNG 拒绝访问：请检查访问凭证”                                                                                                                   |
| 改正密码再测                           | “连接成功：5 条结果，其中 4 条来自采用的引擎，3 条带日期”，显示引擎分布；请求只有 `q/format/categories/language`，`categories=news`，无 `time_range` |
| 保存 SearXNG 连接                      | `userData/techdaily/searxng.json` 有地址、无密码；密码只在凭证文件 `extension:searxng:default`                                                       |
| 开启、单次上限改 3、保存               | `科技日报/设置.yaml` 按默认词表创建，注释保留，`enabled: true`、`search_provider: searxng`、`daily_call_limit: 3`，不含 SearXNG 地址                 |
| 试采一轮                               | 3 次搜索 → 原始 15、黑名单 3、引擎 3、过期 3、留下 6（带日期 100%），本机库新增 6；“提前停止：达到单次调用上限 3”                                    |
| 手改 `设置.yaml` 后重新读取、重启      | 搜索服务、地址、上次测试结果、开关恢复；手改内容保留                                                                                                 |

截图：[T1](../design/techdaily-2026-11-25/acceptance/T1-settings-deepseek.png)、
[T2a 测试连接](../design/techdaily-2026-11-25/acceptance/T2a-searxng-test.png)、
[T2 保存](../design/techdaily-2026-11-25/acceptance/T2-settings-searxng.png)、
[T3 试采](../design/techdaily-2026-11-25/acceptance/T3-trial-collect.png)。

验收中发现并修复：单选框被项目设置表单的通用输入样式撑满整行；达到调用上限时当前领域已搜到的结果被丢弃；
保存前做的测试结果在重启后丢失；切换到未保存的 SearXNG 时仍显示 DeepSeek 的状态。

未验证：真实 SearXNG（地址待提供；需服务端开启 JSON 输出；重定向按错误处理）、真实 DeepSeek 搜索（本机未启用联网搜索）、
对 Argus 当日入选的覆盖率。

## 2026-11-26 侧栏、日历与手动生成（真实 Electron，SearXNG 替身 + 本机 Codex 真实成稿）

结论：从侧栏到生成当天日报的闭环在真实 Electron 中通过，AI 精选与成稿由本机 Codex 真实完成（16 秒 + 32 秒）。
**新闻来自本机 SearXNG 替身（每个搜索词返回两条带当天日期的占位标题），不是真实新闻**；日报内容因此只能证明流程，不能证明质量。

复现：

```bash
pnpm exec electron-vite build --outDir .cache/techdaily-build
```

```bash
DIARY_BUILD=.cache/techdaily-build node scripts/techdaily-report-smoke.mjs
```

| 步骤                       | 结果                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏点“科技日报”           | 日历变为“科技日报日历”，预置的前两天日报带圆点，“本月 1 份日报”；今天显示“今天的科技日报还没生成”和“生成今天的日报”                                                                                                              |
| 点有日报的那天             | 中间编辑器打开该天 `MMDD.md`，显示“示例头条”                                                                                                                                                                                     |
| 回到今天点“生成今天的日报” | 执行详情出现，“正在生成”；第 3 步显示“模型能力 · 第 2/6 次 · 已留下 2 篇”等真实计数                                                                                                                                              |
| 完成                       | 10 步：1–8、10 完成，9“模型能力榜尚未接入”跳过；用时 67 秒；写入 `科技日报/2026/11/1126.md`，5 条均有原文链接；编辑器直接显示日报（头条解读、分领域、开源热点、论文前沿、今日趋势、数据口径），日历今天出现圆点，“本月 2 份日报” |

GitHub 与 arXiv 为真实公开接口（各取到 3 条）。截图：
[R1 侧栏与今天](../design/techdaily-2026-11-25/acceptance/R1-sidebar-today-empty.png)、
[R2 过去的日报](../design/techdaily-2026-11-25/acceptance/R2-past-report.png)、
[R3 生成中](../design/techdaily-2026-11-25/acceptance/R3-generating.png)、
[R4 完成](../design/techdaily-2026-11-25/acceptance/R4-outcome.png)。

验收中发现并修复：编辑器工具栏里“执行详情 / 重新生成”被工具栏 28px 图标按钮宽度压在一起（改为文字按钮宽度，生成时间放进悬停提示）。

### 2026-11-26 第二轮：模型能力榜 + 单行执行条

用户反馈（用真实 DeepSeek 生成一份后）：执行详情占半页，应只留一行，正文为主；缺模型排行。同一脚本重跑：

| 步骤     | 结果                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 生成中   | 正文区只有“正在生成今天的科技日报”；底部一行（高 ≤ 40px）：状态 · 10 个步骤小标签 · 当前步骤详情（“第 n/6 次”真实计数）· “停止”     |
| 完成     | 编辑器占满高度，执行条仍是一行（脚本断言编辑器高度 > 执行条 8 倍），右侧为“重新生成”                                                |
| 第 9 步  | 真实读取 6 个公开榜单页：“6 个榜单今日更新；已写入 科技日报/榜单.json”；`榜单.json` 含 代码、Agent、多模态、图片生成、视频生成、ASR |
| 日报正文 | 头条之后“模型能力榜”：每榜 5 行（# / 模型 / 机构 / 得分 / 变化）与口径、数据源、抓取日期                                            |

截图：[R3 生成中](../design/techdaily-2026-11-25/acceptance/R3-generating.png)、
[R4 完成](../design/techdaily-2026-11-25/acceptance/R4-outcome.png)、
[R5 模型能力榜](../design/techdaily-2026-11-25/acceptance/R5-leaderboard.png)。

验收中发现并修复：步骤小标签被 `.personal-diary-home button` 的边框底色覆盖，详情被挤成“更新模型能…”（选择器加 `.techdaily-runline` 前缀、详情最小宽 240px）。

“变化”列首次运行都是“—”或空：名次变化要第二天再生成才有对比。

未验证：真实 SearXNG、榜单观察区（未实现）、热点补采、线索去重、跨天去重的实际效果、定时生成。
