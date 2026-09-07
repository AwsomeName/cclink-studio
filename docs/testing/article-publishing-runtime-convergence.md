# 文章发布中断恢复测试清单

状态：针对性自动测试通过；真实 CSDN 已只读取证，恢复到后续步骤的产品验收未通过
日期：2026-09-07

本文测试继续作为防倒退基线，但不能证明 Studio/Agent 两个黑盒已经拆开。新增的真实故障顺序和同类
竞态测试见
[../features/article-publishing-observable-execution-development-plan.md](../features/article-publishing-observable-execution-development-plan.md)。

## 自动测试

本轮实跑结果：受影响的 13 个测试文件、213 项测试通过；TypeScript、ESLint、修改文件格式检查通过。

本轮最小修复新增：同 URL 文档刷新时废弃 probe 和排队中的结果；使用证据时复核实际挂载 View；
副作用持久化返回后的同步取消/身份闸门；草稿箱同 URL tab；iframe 页内跳转不得污染主 Tab URL。
跨 service 测试不再停在 inspect：用真实 WebAffairService/Store、BrowserTaskRuntime 和发布服务执行
恢复 31 → BrowserTask 改为 32 → 首次检查 → 账号检查 → 图片步骤 → 正文写入/核验 → fill-fields。
平台页面和 Agent 后端仍为替身，这不是 CSDN 产品验收。

旧保存的未知结果经精确草稿恢复后标记为 `reconciled`，含义仅为“已读取原草稿当前保存状态”。
不是旧动作成功，不完成正文/字段/保存检查点，不影响发布未知结果的禁止重试保护。

## 2026-09-07 真实 Studio/CSDN 现场

使用已运行的开发版 Studio 0.1.87 和原登录 Profile，只做管理页导航、草稿箱切换和打开原草稿，
没有登录、上传、保存、发布、删除，也没有创建替代任务。

已观察到：

- 当前 `cclink-promotion` 项目的文章发布侧栏显示“还没有发布记录”，没有可点击继续的原事务；
- 管理页账号头像链接为 `https://blog.csdn.net/weixin_36388257`；
- 草稿箱为同 URL 的 `草稿箱(1)` 标签，不是链接；
- 从该标签找到并点击原 draftId `164148817` 的编辑链接；
- 草稿列表及编辑器标题均为“【无标题】”，不是已证明匹配的任务标题；
- 编辑器含富文本 iframe 和 AI 助手 iframe。加载 AI 助手后 Studio 地址栏变成其
  `app-blog.csdn.net/csdn/aiChatNew?...articleId=164148817`，主编辑器仍在；
- AX 读回可见“保存草稿”按钮，但没有明确的当前“已保存”状态。按钮不等于保存成功。

因此，真实账号/原 ID 的人工取证已做到；adapter 的账号 DOM 区域、富文本 iframe 正文识别、保存
状态取证仍未被真实 DOM 执行证明。不能把 AX 文本或新增的 role-tab 测试称为 adapter 验收通过。
原任务缺失且标题不符，未执行“点击继续 → 首次检查 → 继续原未完成步骤”，不得宣称恢复闭环完成。

隔离 Electron 验证已运行 `node scripts/browser-cdp-recovery-smoke.cjs`：CDP generation 1 → 2 → 3，
主窗口 → 辅助窗口 → 主窗口均保留同一 WebContents/target、Profile、登录 Cookie、未保存表单、滚动及
timeOrigin；新增的真实 iframe `history.replaceState` 不再污染主 Tab 地址栏。该项使用本地 fixture 和
隔离临时 userData，不包含真实 CSDN 发布任务，也不替代完整浏览器缩放真人矩阵。

剩余验收必须使用仍保留的当前 schema 中断事务和对应原稿，不允许通过伪造已完成 checkpoint、
把“【无标题】”当成匹配标题、把“保存草稿”按钮当 saved、或新建文章代替原稿来通过。

- 新任务使用 schema v9 保存并重载；
- v1-v8 文章发布任务在加载时删除，通用 WebAffair 保留；
- 旧文章任务不会从 `.bak` 或旧 recovery journal 回流；
- 同账号 recovery lease 只能有一个 owner；
- 草稿核验成功后 recovery lease 原子转交 BrowserTask；
- 账号、draftId、标题或保存状态不符时不启动 Agent；
- Runtime 代次、Tab、WebContents 或 Playwright Page 身份不符时拒绝写入；
- 已完成 checkpoint 和已上传图片在恢复时不倒退；
- `result-unknown` 上传在人工确认前不能重放；
- 人工确认“图片存在”后状态为 `uploaded`；确认“图片缺失”后允许新上传尝试；
- 发布动作派发后结果未知时只能查文章管理页，不能再次发布；
- 公开文章 ID 与草稿 ID 不同，但账号和唯一标题一致时可确认发布；
- 多个同名草稿或公开文章时停止自动选择。
- 恢复找到原草稿后，BrowserTask 创建导致 Page generation 改代，最终 Page 重新核验成功后才提交 binding 和
  permit，Agent 第一次 inspect 使用新 generation；
- `onPageRuntimeBound` 在 active runtime 登记前到达时会被缓存并 await，不会丢失；
- Agent inspect 与同页 rebind 并发时先等待 rebind queue，不把瞬时不一致误判成人工问题；
- 内部 Runtime 重绑失败会撤销 permit 并进入 interrupted，不进入 waiting-human。

## 真实 CSDN 验收矩阵

每组都要在正式 Electron `WebContentsView`、真实登录账号和可见网页中执行：

| 中断点                 | 重启后的预期                               |
| ---------------------- | ------------------------------------------ |
| 尚未打开编辑器         | 从第一步开始                               |
| 已打开并取得 draftId   | 从草稿箱重新打开原草稿                     |
| 正文填写中             | 已完成步骤不倒退，从未完成步骤继续         |
| 图片上传前             | 继续上传                                   |
| 图片上传后、读回前     | 停止并显示人工“存在/缺失”选择              |
| CSDN 更换图片 URL      | 已确认图片保持完成；未决图片由用户目视确认 |
| 保存草稿派发后         | 先读回同账号、同草稿和保存状态，不直接重放 |
| 发布点击后、结果未读回 | 只查文章管理页，不再次点击发布             |
| Studio 完全退出后重启  | 使用持久状态和草稿箱恢复，不依赖旧 Tab/URL |

## 人工图片确认

1. Studio 显示具体文件名和 Markdown 引用位置。
2. 用户在旁边可见的 CSDN 编辑器中查看对应图片。
3. 用户点击“网页里有这张图”或“网页里没有，重新上传”。
4. 用户不复制、不粘贴、不填写任何图片地址。
5. 继续任务后观察已确认图片被跳过，缺失图片只上传一次。

## 诊断证据

失败报告至少包含：affairId、attemptId、executionGeneration、launchOperationId、账号 ID、draftId、当前步骤、资产 ID、sideEffect key、Tab ID、WebContents ID、Playwright connection/page generation、当前 URL、页面保存状态和 recovery lease owner。

自动测试通过只代表工程门禁。只有上述真实 CSDN 矩阵通过，才可声明产品闭环完成。
