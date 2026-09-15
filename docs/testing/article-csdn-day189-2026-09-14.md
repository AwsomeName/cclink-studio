# 第189天 CSDN 真实发布验收（未闭环）

用户授权原稿 `/Users/apple/Desktop/研发日记/AIR/2026-09-10/小红书软文.md` 及素材三图，逐平台验证。CSDN 沿用已有账号 `ff3592e8-517a-443d-a674-58105f7bc06b`，实际账号 `csdn:weixin_36388257`。没有提交代码、推送或发版。

## 用户功能进度

通过 Studio 正常原稿选择和新建表单建立事务 `e2e183f2-4c53-4802-a6c1-5b1074c76760`，Attempt `14c83721-5187-4789-b650-d1f433988dbc`。平台草稿 `165321224`。G1 建稿期间已绑定草稿，保存动作因页面身份变化中断；G2 恢复被仍运行的旧 Agent 账号占用拒绝。待旧 Agent 结束后 G3 正常恢复原稿和账号，没有新建替代稿。

G3 Studio Agent 完成三图逐张上传和地址/加载回读、完整正文写入、正文与冻结原稿匹配、三图位置/alt/顺序验证、摘要及五标签。标签取原文的 AI眼镜、智能眼镜、AI搭子、独立开发、开发日记。字段保存一度持续 unknown，平台有已保存提示而主进程服务端比较未通过，数分钟后原运行重新取得 saved 并推进。未按提示伪造保存证据，未清除已派发副作用。

随后 Studio Agent 在 publish 检查点点击签发的“发布博客”一次；页面仍停留在原编辑器，没有成功提示、publishedLinks 或已核验平台回执。多次只读 inspect 未取得结果；browser_get_network_logs 被能力边界拒绝。Codex 没有再次点击发送。Agent 对“出现发布设置抽屉”的解释尚无前后对照证据，不作为根因。

因持续没有结果证据，Codex 通过 Studio 网页运行卡的“暂停”停止继续循环，保留现场。16:05:23 WebAffair 已记录 needs-attention、execution/publication=result-unknown、currentStepId=publish。公开全文与三图核验未完成，不能报告发布成功，也不能断言未提交服务器。

## 工程准备度

新增 CSDN 原稿服务端比较的布尔诊断：响应成功、草稿状态、ID、标题、正文、摘要是否匹配，以及回读异常/超时。不输出正文、响应或凭证，不更改 saved 判定。8项 adapter 测试、node类型检查、受影响lint通过。新增诊断未加载到当前 main：原 Agent 在拟重启前自行取得 saved 并继续，因此取消了重启。该诊断不能算保存阻塞已修复。

## 分别验收

- 执行计划：原稿恢复、三图上传、正文、字段、保存及发布动作状态均真实变化；最终发布和公开逐图步骤尚未通过。
- 发布闭环：一次点击已派发、结果未知。下一步需要同一原稿的真实发布请求回执，或账号管理页/公开页面的确切状态；只能核验，不能重放发送。

真实界面证据：`artifacts/article-csdn-day189-20260914/first-image-verified.png`、`fields-save-blocked.png`、`after-publish-click.png`、`publish-awaiting-evidence-paused.png`。截图的“已保存”或编辑页只证明可见状态，不能替代服务端或公开结果核验。

真人验收方式：Studio 打开第189天 CSDN 任务，核对图文及字段步骤已完成和提交结果未知；打开原稿页面可见全文、三图、摘要与五标签。不要再点击发布，待只读核验确定原请求结果。

## G4 继续核验：管理页与输入焦点阻塞

通过原任务“核验发布结果”启动G4，主进程返回“当前页面不是可识别的平台文章管理页”，仍为result-unknown、verify-publication。页面实际停在原编辑器165321224，本地Agent显示连接错误。

尝试通过Studio地址栏打开同账号管理页时，AX设置地址并按Return未导航；随后点击地址栏、全选、粘贴返回剪贴板读取超时。截图显示地址栏外框高亮，但网页正文被全选，AX焦点仍报告“发布博客”；继续坐标定位地址栏返回noWindowsAvailable。已停止键盘操作，不能把这些输入视为可靠导航，也不能排除先前Return落在网页焦点的风险。没有观察到成功提示、页面跳转或新的已验证发布结果。后续不得重发，应先恢复可操作窗口/焦点并只读查看管理页。证据 `g4-navigation-focus-blocked.png`。

## G5 2026-09-15 09:02 再次只读核验

用户表示管理页已打开。实际读取开发版 Studio 可见页仍是 editor/165321224；通过原任务“核验发布结果”启动本轮，09:02:58 再次返回“当前页面不是可识别的平台文章管理页”，没有启动发布 Agent、没有重发。执行计划仍保留提交动作已返回与公开核验结果未知的区别。

开发日志在本轮导航后记录 beforeunload 自动处理，随后 dialog.accept 报 `Protocol error (Page.handleJavaScriptDialog): No dialog is showing`。这是与导航失败相关的直接线索，尚不能单独证明全部根因。当前源码 BrowserManager.navigate 对未到目标的 ERR_ABORTED 会抛出；当前运行版本仍未重启加载此前修改。

桌面 AX 点击能打开任务面板及触发核验；地址栏 AX 点击未取得输入焦点，坐标点击返回 noWindowsAvailable。没有再次输入 Return，没有修改持久化状态或重启。Chrome 当前可见页也不是 CSDN 管理页。尚缺原账号管理页/公开结果的可信证据和可靠桌面导航能力。截图 `artifacts/article-csdn-day189-20260914/g5-editor-navigation-blocked-20260915.jpeg`。
