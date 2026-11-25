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
