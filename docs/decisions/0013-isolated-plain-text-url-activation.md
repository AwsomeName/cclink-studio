# ADR 0013：隔离世界中的纯文本 URL 激活

- 状态：accepted
- 日期：2026-08-16
- 负责人：CCLink Studio Maintainers
- 复审：架构宪法第 10 条中 Browser 网页菜单不得依赖 DOM 注入的约束

## 问题

部分政府和旧式网站把 `https://...` 只渲染成蓝色下划线文本，没有使用 `<a href>`。Chromium
不会为这类文本产生 `linkURL`、新窗口请求或链接右键菜单，因此用户直接点击、Cmd/Ctrl + 点击
或右键都无法在 Studio Browser Tab 中打开它。

Studio 现有的新 Tab、Profile、Session、URL 白名单和 popup 生命周期只处理真实链接；仅在主进程
猜测 `selectionText` 也无法知道鼠标所在文本。要支持用户实际看到的 URL，必须进行一次有边界的
DOM 命中判断。

## 用户验收目标

1. 在内嵌浏览器打开只用普通文本展示 `https://...` 的页面；
2. 直接点击或 Cmd/Ctrl + 点击该 URL，会在当前工作空间创建 Browser Tab；
3. 右键该 URL 会出现“在新 Tab 打开链接”，执行后创建 Browser Tab；
4. 新 Tab 继承来源 Profile/Session，原页面保持不变；
5. 普通 `<a>`、表单控件、可编辑区和页面自有链接行为不受影响。

## 决策

1. 允许 `BrowserManager` 在网页主 frame 加载完成后，向独立 isolated world 安装一个无权限、
   无通信通道的纯文本 URL 命中监听器。
2. 监听器不改写 DOM，不扫描或回传页面正文，只在用户左键或右键按下的位置检查同一 text node
   中的 `http:`/`https:` URL。
3. 左键命中后只调用网页标准 `window.open()`；新页面仍必须通过现有
   `setWindowOpenHandler()`、协议白名单、Profile/Session 继承和 popup 接纳流程。
4. 右键命中后只把该 URL 设为当前选区，使 Electron 原生 `context-menu` 参数携带有界文本；
   主进程只在选区整体可解析为 `http:`/`https:` URL 时将它投影为 `linkUrl`。
5. 真实 `<a>`、`role=link`、带页面 `onclick` 的元素、表单控件和可编辑区全部跳过，保留网页行为。
6. 安装失败只记录脱敏分类并降级为 Chromium 原始行为，不影响页面加载或其他 Studio 能力。

## 不变量

1. 网页仍无 preload、Node.js、IPC、工作空间文件或 Studio API 权限。
2. isolated world 不建立持久消息桥，不返回 DOM、正文、Cookie、Token 或用户输入。
3. `file:`、`javascript:`、自定义协议和认证路由不能绕过现有主进程校验。
4. Browser runtime、工作台 Tab、Profile 和 Session 的状态所有权不变。
5. 不使用 Playwright/CDP，不把纯文本 URL 支持扩张为通用网页注入平台。

## 备选方案

- **只支持真实 `<a>`**：拒绝，无法完成已出现的真实页面操作。
- **把所有 URL 文本改写为 `<a>`**：拒绝，会持续修改网页 DOM、触发 MutationObserver 竞态并影响布局。
- **通过 preload/IPC 回传命中内容**：拒绝，会扩大不可信网页的权限面和跨进程契约。
- **通过 Playwright/CDP 查询点击位置**：拒绝，会让用户基础浏览行为依赖自动化模块。
- **只对选中文字提供右键动作**：作为降级保留，但不能满足直接点击和无预选右键。

## 风险与影响

- 极少数把 URL 文本用于自定义交互、但没有 `onclick`/`role=link` 标记的页面可能与增强行为冲突；
  因此命中仅限 URL 字符本身，并跳过可交互和可编辑祖先。
- isolated world 仍可观察当前点击位置的 text node；实现必须保持无回传、无持久扫描和无 DOM 改写。
- iframe 内的纯文本 URL 首版不增强；主 frame 失败不影响真实链接。

## 迁移计划

不迁移用户数据。每个 Browser main frame 在加载完成后幂等安装，frame 销毁时由 Chromium 自动释放。

## 回收或复审条件

- Chromium/Electron 提供无需 DOM 命中的原生纯文本链接参数；
- 发现该 isolated world 监听器影响站点交互、泄露页面内容或绕过 URL/认证边界；
- 需要支持 iframe、非 HTTP(S) 协议或页面级自动链接化。

## 验证

- 单元测试覆盖纯 URL 选区、尾随中文标点、非法协议和普通选区；
- BrowserManager 测试覆盖 isolated world 的幂等安装入口和失败降级；
- 真实 App 使用普通 `<span>` URL 验收直接点击、Cmd/Ctrl + 点击和右键新 Tab；
- 真实 `<a>`、Profile 继承、非法协议及 popup 清理回归通过；
- `pnpm verify` 或受影响测试与 smoke 通过后，只声明相应工程门禁。
