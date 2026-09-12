# 头条发布页加载阻塞：2026-09-11

## 用户能力状态

本稿及三图向当前头条账号投稿已授权，但尚未上传或提交。微头条适配器和细步骤尚未交付。昵称/头像由用户在手机 App 修改，与本轮观察到的系统网络地址变化不能混为一谈。

## 实测证据

- 同机匿名 curl 对实际微头条地址的 HEAD、GET 均为 HTTP 200，GET 返回 61437 字节；不带账号 Cookie。经 macOS 当前本地 HTTPS 代理的对照 GET 也为 200。匿名页面成功不代表登录后的发布能力通过。
- Studio 同一隔离 Profile 的主文档及脚本/XHR 记录到 `net::ERR_NETWORK_CHANGED`，Agent 导航呈现 `ERR_FAILED (-2)`，页面进入 Chromium 错误页。
- 开发工作台的 localhost 模块也反复报 `ERR_NETWORK_CHANGED`。工作台忽略缓存刷新没有恢复，因此当前故障不局限于头条，也不能证明是头条 Service Worker 或缓存损坏。
- macOS `route -n monitor` 的 8 秒只读采样：4 次 RTM_DELADDR、4 次 RTM_NEWADDR，并有路由增删。第二次按接口归类采样：en0 5 次增加、4 次删除。
- `networksetup` 只读确认 en0 为 Wi-Fi，IPv6 为 Automatic。随后 6 秒采样确认变化的是 en0 的非链路本地 IPv6 地址，4 次删除、3 次添加。诊断输出只保留事件类型、接口与地址族，不保留实际 IP 地址。
- Chromium 的网络变化处理会响应接口/地址变化并使连接失效；已有官方实现说明见 https://chromium.googlesource.com/chromium/src/+/93f8e3b6e39e23935c31d7775d88312318fe34ba 和 https://chromium.googlesource.com/chromium/src/+/59ce0c9e0f2cabf4ff64ff9de588f1e58ecec593 。这些源说明机制，不单独证明本机的最终根因。

结论：Wi-Fi IPv6 地址反复增删是当前最直接的原因线索，尚需改变配置后的对照验证。没有调整代理、关闭 VPN、修改 DNS 或清除登录态，也没有盲目添加 Chromium 网络忽略开关。

## 本轮工程变更和门禁

- 在既有浏览器兼容接入处增加开发诊断开关 `CCLINK_BROWSER_LOAD_DIAGNOSTICS=1`，只记录请求 ID、origin、资源类型、WebContents ID、缓存标志、HTTP 状态及规范化错误码；不记录 URL 路径/参数、请求头、Cookie、请求/响应正文。默认关闭，不改变请求结果。
- 既有 `browser_reload` 增加 `ignoreCache` 可选项，由 BrowserManager 调用 Electron 的 `reloadIgnoringCache`，沿用派发保护和随后绑定核验，不新增执行状态所有者、不清除 Cookie 或存储。没有原生 Tab 的 fallback 明确拒绝该选项，不能假装完成强制刷新。
- 类型检查、受影响 ESLint 通过；browser/index、playwright-actions、browser-load-diagnostics、browser-manager-popup 共 4 文件 117 测试通过。新 MCP 强制刷新尚未在真实头条 Tab 验收，因为工作台自身已受网络变化影响而白屏；不能把代码检查当作已修复。

## 下一步的具体对照

需要用户确认是否允许临时将 Wi-Fi IPv6 从 Automatic 改为 Link-local only。这是整台 Mac 的网络配置变更，可能影响其他应用的 IPv6 连接，不能作为 Studio 内部修复静默实施。原值已明确为 Automatic；对照结束可恢复为 Automatic。尚未执行修改。

获确认后：记录变更 → 再采样 en0 地址事件 → 重载真实 Studio → 同一账号/UID 打开微头条编辑器 → 读取真实控件。如果仍失败恢复 Automatic，停止该假设；如果成功，再继续平台适配、逐图上传、正文回读、一次提交及结果核验。不能通过永久关闭网络变化保护或增加发布重试绕过。

## 用户要求不改网络配置后的复查

用户明确要求先查触发原因，不做影响其他应用的临时配置修改。前述 IPv6 切换方案不再作为待执行默认步骤，未执行任何网络配置变更。

本次只读复查：10 秒内 en0 非链路本地 IPv6 地址 7 次删除、6 次添加；Studio 工作台仍为空白，没有恢复发布。进一步检查 configd 日志，最近 1 分钟中实际消息 `RTADV en0: duplicated address` 出现 35 次；随后 30 秒采样同一消息出现 18 次，另有重复 Router Solicitation 记录。已确认系统持续报告重复地址，不能再仅描述为一次短暂网络切换。日志不包含实际 IP/MAC 地址。

这定位到了系统重复地址检测这一具体环节，但尚不能确定是局域网另一设备、路由器响应还是 VPN/虚拟网络行为造成，不能认定 VPN 有问题，也不能认定手机修改账号资料是原因。下一步应围绕重复地址检测来源作只读诊断，不能通过无限刷新、清登录态或修改 IPv6 来替代根因判断。文章和图片仍未上传、未提交。

## 继续追踪重复地址来源

内核日志进一步出现 `nd6_dad_timer: duplicate IPv6 address … if:en0 [timer]` 与 `IN6_ADDR_MARKED_DUPLICATED`，说明是重复地址检测环节的实际判定。一次 2 分钟采样中，同一地址被标记 73 次，另一个地址 1 次；并非每次都生成完全不同的地址。

Clash Verge 当前设置经正常 UI 只读确认：系统代理、TUN 虚拟网卡模式、IPv6 均开启。只打开设置页面，没有切换任何开关。启用这些功能本身不证明故障由 Clash 引起。

后续一次关联采样中，重复 35 次的同一 IPv6 地址，在 en0 的邻居表里同时关联两条 MAC 记录：一条是本机 en0（IPv4 `192.168.8.112`，MAC 后两组 `84:28`），另一条在 ARP 表对应 `192.168.8.37`（MAC 后两组 `b6:09`），不匹配本机任何接口，也不匹配当时默认 IPv6 路由器的 MAC。另一个低频冲突地址关联其他邻居，不能并入同一设备结论。对 `.37` 的有界主机名查询没有解析出名称。

这给出了应优先核对的局域网设备/邻居记录，但尚未捕获实际邻居通告报文，不能确认该设备真实占用地址或排除代理/缓存异常。当前账号不能无交互执行 tcpdump（需要管理员权限），没有抓取报文、读取密码或要求关闭 VPN。下一步先让用户从路由器设备列表确认 `192.168.8.37` 的身份，再决定是否需要报文级只读取证。未修改任何网络配置，未上传或提交文章。

## 用户切换手机热点后的对照

用户自行切换热点后，8 秒路由通知采样未发现地址增删。普通重载即恢复 Studio 工作台，微头条编辑器也正常加载；之后开发版重启仍正常。没有执行 IPv6 配置更改、清 Cookie 或关闭 VPN。这支持原 Wi-Fi 环境与故障相关，但不足以锁定某台设备或 VPN 为唯一责任方。

Studio Agent 已在原 Profile 中核对昵称“小眸”、UID 3777529577766638，并读到真实空白编辑器 `div.ProseMirror`、图片按钮、`button.save-draft`、`button.publish-content`。图片入口尚未实际展开，静态 file input 未找到不能推断必须使用何种上传实现。没有上传、保存或提交；头条适配器和细计划仍未交付。真实界面：`artifacts/article-toutiao-agent-20260911/hotspot-editor-recovered.jpeg`。

恢复后另发现现有 browser_extract 用 textContent 读取 body 会返回约35万字符，包含隐藏页面内容，拖慢 Agent 并引发不必要的结果文件读取尝试。已改为 innerText，只返回最多20000字符及 textLength/truncated，提示缩小范围而非读临时文件。类型检查、受影响75项测试通过；没有新增进度状态所有者。具体发布接入仍需独立完成验收。

真实修复复验：Studio Agent 仅重新绑定账号并执行一次 `browser_extract(selector="body")`，原始工具返回 textLength=325、truncated=false，包含编辑器占位符、图片入口、作品声明、存草稿/发布按钮，未读取结果文件或运行 shell。截图：`artifacts/article-toutiao-agent-20260911/visible-text-verified.jpeg`。可见文本不保证包含被头像呈现的昵称，账号身份仍须结合真实个人主页链接核验，不能用文字缺失推断登录失败。开发网络日志开关已在此次正常重启时关闭。
