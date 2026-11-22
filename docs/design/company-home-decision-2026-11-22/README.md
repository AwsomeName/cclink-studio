# 公司首页效果稿：帮我想清楚一个问题

日期：2026-11-22。状态：效果稿，用户已于 2026-11-22 确认；未改代码。数据、人名与金额为示意。基于同日公司首页效果稿，保留“今天要做”“项目进度”“11 月收支”，新增经营决策卡，明确推广产品、跟进客户、售后服务三个入口；不含试用者招募。

示例：AR 眼镜一代直接上市，问题是“首批先卖给谁，怎么定价？”。

## 用户能做什么

1. 在首页右上角、侧栏“经营决策”或 Agent 建议点“帮我想清楚一个问题”，写下问题，勾选 Owner 可以只读的资料（账目汇总、推广与销售记录、业务项目、相关 Owner 事务；网上资料默认不勾）。
2. Owner 读完资料，遇到会改变建议的歧义先问（首批产能、近视镜片），用户在卡片上直接点选回答。
3. 卡片给出：一句建议、三个可选方案（卖给谁、价格、好处、代价）、依据（每项带来源链接）、每台成本估算、会让建议失效的情况。估算项和未核实项单独标出，未核实的不参与建议。
4. 用户“采纳并记为决策”“改一下再采纳”或“先不决定”。采纳只写一条决策记录，不改价格、不发消息、不动账目；卡片列出接下来可去的入口。

## 归属

| 内容                               | 归谁                                      |
| ---------------------------------- | ----------------------------------------- |
| 思考过程、追问、依据读取           | Owner 事务（示例 OW-026）                 |
| 决策记录（问题、选项、决定、来源） | 公司领域新增的一项记录，只引用 Owner 事务 |
| 账目、客户、推广、售后的事实       | 各自原领域；首页只聚合投影                |

## 演示与截图

打开 [home.html](home.html)。底部评审条可切换 ① 提问前 ② 交办 ③ Owner 追问 ④ 等你决定 ⑤ 已采纳，以及来源标注和深浅色。URL 参数：`?think=ask|dialog|clarify|decide|done`、`&notes=1`、`&theme=light|dark`、`&clean=1`。

| 截图                                         | 内容                    |
| -------------------------------------------- | ----------------------- |
| [home-decide.png](home-decide.png)           | 等你决定，首屏 1440×900 |
| [home-decide-full.png](home-decide-full.png) | 完整首页，依据展开      |
| [home-ask.png](home-ask.png)                 | 提问前                  |
| [home-dialog.png](home-dialog.png)           | 交办对话框与只读范围    |
| [home-clarify.png](home-clarify.png)         | Owner 追问              |
| [home-done.png](home-done.png)               | 已采纳                  |
| [home-notes.png](home-notes.png)             | 来源标注                |
| [home-dark.png](home-dark.png)               | 深色                    |
| [home-1180.png](home-1180.png)               | 1180 宽                 |
| [home-narrow.png](home-narrow.png)           | 375 宽                  |

[verification.json](verification.json)：十种视图无横向溢出、无脚本错误；交互检查覆盖交办 → 追问 → 决定 → 修改后采纳。只证明效果稿可用，不代表产品能力已实现。

## 确认结果（2026-11-22）

用户确认效果稿布局。以下三点按效果稿现状执行，后续可再调整：

1. 决策卡放在首页左栏最上方。
2. 不做“重想条件”到期提醒；重想条件只作为决策记录的文字字段。
3. 网上公开资料默认不勾选。

## 实现状态（2026-11-22）

用户要求直接开始实现，因此跳过了“先做真实月份账目验收”的原排序（账目验收仍待用户提供资料）。

- 设计决定见 [ADR 0025](../../decisions/0025-company-decision-records.md)：决策记录存公司数据库 schema v3；思考由该决策专属的本地 Agent 会话完成，暂不进入 Owner“我的事务”列表。
- 代码：`src/shared/company-workspace/company-decision.ts`、`src/main/company-workspace/company-decisions.ts`、`src/renderer/src/features/company-workspace/CompanyDecisionCard.tsx` 与 `company-decision-agent.ts`。
- 与效果稿的差异：卡片在现有首页网格中通栏置顶（首页已改为销售与售后版，没有左右栏）；侧栏“经营决策”入口、Agent 面板建议入口、“相关 Owner 事务”资料范围本版未做；三个销售入口沿用首页“推广与客户”区，并在采纳后的卡片上重复给出。
- 真人验收步骤见 [docs/testing/company-decision-card.md](../../testing/company-decision-card.md)。
