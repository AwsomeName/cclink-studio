# 内嵌浏览器适宽锁死 30%：事故与回归门禁

状态：**2026-08-20 二次定位并关闭工程缺口；当前用户复验待签收**

## 用户可见故障

用户在 Studio 内嵌浏览器打开新页面时，工具栏显示“自动 30%”，网页内容缩成极小区域。
页面加载稳定后仍不恢复。

## 真实根因

Retina DPR=2 的真实 Studio `WebContentsView` 诊断得到以下同一时刻数据：

| 字段                          | 实测值   |
| ----------------------------- | -------- |
| pane / View bounds            | `633px`  |
| `documentElement.clientWidth` | `633px`  |
| body 宽度                     | `633px`  |
| `documentElement.scrollWidth` | `2110px` |
| 旧算法 `pane / scrollWidth`   | `0.3`    |

博客园登录页有页面外溢元素撑大根节点 `scrollWidth`，但正文和可见视口均已与 pane 同宽。
旧代码把该外溢宽度直接当作正文适宽宽度，应用 `633 / 2110 = 0.3`，随后又将结果
写入 `fitWidthMeasurement`，使 30% 在后续 bounds 更新中被重复使用。

### 二次复验发现：Electron page zoom 与 Chromium visual zoom 是两套状态

用户把同一博客园验收 Tab 移入辅助窗口后，网页仍以约 30% 显示。辅助 surface 已有
`1100 × 676`，因此这次不是可分离窗口 Grid 高度故障。真实运行诊断为：

| 字段                              | 实测值                    |
| --------------------------------- | ------------------------- |
| URL                               | 博客园登录页 `#fit-check` |
| trigger / 文档代次                | `bounds` / `2`            |
| pane / View                       | `1100 / 1100×676`         |
| 三次 `viewport/root/body`         | `1100/3667/1100`          |
| raw / applied / `getZoomFactor()` | `0.29997 / 1 / 1`         |
| `visualViewport.scale`            | `0.3`                     |
| `visualViewport.width`            | `3666.67`                 |

原诊断把 `WebContents.getZoomFactor() === 1` 当作“实际 100%”，但它只能证明 Electron page
zoom 已恢复，不能证明独立的 Chromium visual/pinch scale 已恢复。再次调用 `setZoomFactor(1)` 或
“适应宽度”都不能清掉该 `0.3`；通过 CDP `Emulation.setPageScaleFactor(1)` 后，原页面不重载即恢复，
`visualViewport.scale` 变为 `1`、可视宽度回到 pane 宽度。

因此，第一次“已关闭”的诊断口径不完整。核心适宽外溢拒绝仍然有效，但 BrowserManager 作为缩放
状态 owner，必须同时规范 page zoom 和 visual page scale；`WebContentsView` 跨窗口迁移本身不是
这次比例异常的根因，它只是原样保留了错误的 visual scale。

## 修复不变式

1. 主框架或页内导航开始时立即恢复 100%，增加文档代次并废弃旧测量。
2. 页面仅返回同步快照；三次采样由主进程调度，不依赖会被 Chromium 节流的页面
   `requestAnimationFrame` 或定时器。
3. 只有采样的 `documentElement.clientWidth` 与 pane 匹配，且后两次内容宽度稳定时，
   结果才可缓存。
4. 自动计算低于 50% 时，视为不可读或可疑外溢：不应用、不缓存，保持 100%，
   有真实横向溢出时由横向滑动降级处理。
5. 拒绝或不稳定测量只做有界重试，旧异常值不得跨导航或跨尺寸复用。
6. 诊断输出 trigger、文档代次、pane/View bounds、三次原始样本、raw/applied factor、
   拒绝原因、`WebContents.getZoomFactor()` 以及 visual scale 复位前/后的实测值。
7. BrowserManager 每次应用自动或手动缩放前，都在主进程串行复位 Chromium visual page scale；
   Tab 激活和跨 host 迁移复用同一条路径，renderer 与辅助窗口不得成为第二缩放 owner。

## 已失败方案，禁止重复盲修

| 提交       | 尝试                                                    | 为什么不够                                       |
| ---------- | ------------------------------------------------------- | ------------------------------------------------ |
| `24a3e4ea` | 每次测量前先设置 100%，增加异步代次保护                 | 只防旧 zoom 反馈和旧请求覆盖，不判断测量是否可信 |
| `151b1aeb` | 缓存 100% 下的测量结果                                  | 一次错误测量变成长期状态                         |
| `f3240667` | 在 isolated world 等待两个 animation frame 后再读取宽度 | 两帧不是动态页面的稳定条件，且页面调度会被节流   |
| `0a328c67` | bounds 不变时不再触碰原生 View                          | 降低布局噪声，但不能否决错误的 30% 计算          |

修改缩放链路前，必须先取得真实 pane、viewport、root/body `scrollWidth`、raw factor
和实际 `WebContents.getZoomFactor()`。禁止只调固定延时、frame 数、DIP/DPR 倍数或下限阈值。

## 2026-08-20 关闭验收记录

- `pnpm typecheck`：通过。
- 相关 Vitest：27/27 通过，覆盖 30% 拒绝、稳定尾样本、不稳定拒绝、页内导航失效和异步代次。
- 真实 Electron + 真实博客园登录页：连续新建 10 个 Tab，10/10 的 toolbar 状态与
  `WebContents.getZoomFactor()` 均为 100%。其中 8 次稳定复现 `633 / 2110 = 0.3`，
  8 次均被拒绝并保持 100%。
- 同一真实 Tab：手动切到 30% 后适宽恢复 100%；`pushState` 页内导航使文档代次
  增长并重测；Sidebar 改宽使 pane 从 `633px` 变为 `473px` 后仍保持 100%；
  普通导航与后退均重测且不会恢复 30%。
- 重启 Studio 并恢复同一 Tab：URL 和 Tab ID 正确恢复，raw factor 再次为 `0.3`，
  applied factor 与实际 `WebContents.getZoomFactor()` 仍均为 `1`。

上述记录只覆盖 page zoom，不能单独证明 visual scale；二次验收补充如下：

- 当前真实开发版人为写入 `visualViewport.scale=0.3` 后执行适宽，原 Tab 无重载恢复为 `1`；诊断记录
  `visualScaleBeforeReset=0.3000000119`、`actualVisualScale=1`。
- 更新后的 `pnpm smoke:detachable-tabs-m1` 在迁移前主动建立 30% visual scale 前置条件；通过生产
  右键迁移后，同一 Page/runtime generation、Session、表单、滚动与 JavaScript 状态保持，visual
  scale 恢复为 `1`，12/12 通过。
- 相关 visual-scale helper 与 BrowserManager 测试 25/25 通过，`pnpm typecheck` 通过。

## 回归复验

后续修改 BrowserManager 缩放、bounds、导航或 WebContents 生命周期时，重跑上述关闭验收。
mock 单测、toolbar 显示和 `getZoomFactor()` 单值都不能代替真实 Electron 中的 visual scale 证据。
