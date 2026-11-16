# 本地朗读

状态：源码已实现，macOS arm64 真实 Electron 自动验收通过；真人听感签收及正式打包发布尚未执行。

## 用户验收

1. 首次点击朗读，安装固定 Kokoro 中文/英文资源；安装完成后断网。
2. 在 MD 编辑器修改未保存内容，朗读全文或选区，听到当前内容。
3. 在浏览器朗读已加载正文或选区；提取失败明确提示选区降级。
4. 朗读一条对话消息，只包含可见正文，不包含工具和思考内容。
5. Git 右侧、时钟左侧的底栏播放器可暂停、续播、跳段、调速、换音色和停止。
6. 新来源替换旧来源且不串音，切换标签继续听，切换工作空间暂停；重启不自动出声。
7. 展开播放面板时内嵌网页不遮挡控制，收起恢复网页现场。

## 能力与边界

- 固定 Kokoro-82M v1.1-zh 非量化 ONNX，sherpa-onnx-node 2.0.1；CPU 推理。
- 应用携带推理组件；模型按用户点击下载。完整包 364855331 字节，固定 SHA-256
  `b78e1ac42b852e839cceaafbe88f66806bf5860992d1d7b9a3f2ad1198427aed`。
- 文本和音频不发送云端；免登录，无自动云端降级。首版不做自动播报、流式对话或声音克隆。
- 资源安装状态由现有 RuntimeResourceManager 拥有；主进程 LocalTtsService 是朗读会话、
  段落、播放意图、实际播放状态的唯一所有者。
  renderer 仅投影快照、播放有界音频并报告实际音频事件；不存在独立播放队列。
- 合成在可终止的独立进程执行。停止/替换使旧 generation 失效，迟到音频/事件丢弃。
- 同时最多保留当前及下一段音频，正文只在本次会话内存中存在；不落盘朗读历史。
- 模型缺失、损坏或进程退出只降级朗读。服务通过现有 ServiceRegistry 对称注册和释放。
- 入口复用统一 command/contribution。只接受受信任主窗口；来源引用、长度、控制动作均校验。
- 网页正文只读当前主窗口已授权的 Tab，绑定 workspace/profile/document generation；不导航、
  不读取认证子进程、不注入菜单或高权限桥接。原生选区来自 Electron context-menu。
- MD 固定当前编辑快照，格式经 Markdown 解析去除；标题、列表、正文保留，代码块提示后跳过。
- 失败显示具体阶段和重试操作；诊断只记录长度、耗时、运行标识及错误分类，不记录正文。

## 验证

先记录模型真实加载、合成耗时、音频时长与取消证据，再做服务边界测试及真实 Electron 三来源验收。
工程门禁与真人听感、用户闭环分别记录，模型样本生成不代表应用朗读完成。

执行 `pnpm smoke:local-tts` 可复验真实界面与音频链路；结果和真人操作步骤见
[本地朗读验收](../testing/local-tts.md)。

Electron 的 sherpa 调用显式设置 `enableExternalBuffer: false`，采用官方支持的复制缓冲方式，
不关闭 Electron 安全保护，也不要求用户安装 Node/Python。参考
[sherpa Electron 兼容说明](https://k2-fsa.github.io/sherpa/onnx/faqs/index.html#external-buffers-are-not-allowed)。
