# Architecture Decision Records

当实现需要改变或例外处理 `docs/architecture.md` 中的架构宪法时，先在本目录新增 ADR，再开始实现。

文件名使用 `NNNN-short-title.md`。状态使用 `proposed`、`accepted`、`superseded` 或 `rejected`。

```markdown
# ADR NNNN：标题

- 状态：proposed
- 日期：YYYY-MM-DD
- 负责人：

## 问题

## 决策

## 不变量

## 备选方案

## 风险与影响

## 迁移计划

## 回收或复审条件

## 验证
```

ADR 只记录会长期影响安全边界、模块依赖、生命周期、状态所有权、持久化或产品边界的决策。普通实现细节留在代码和 PR 中。

## 当前记录

- `0001-preserve-stabilization-snapshot.md`：保留 `49da3b2` 作为不可改写的稳定化现场快照，后续提交继续执行单一目标约束。
- `0002-bundled-claude-code-runtime.md`：定义 Claude Runtime 的本机/自定义来源、认证、切换和恢复边界；其中随 `.app` 分发可执行文件的决定已由 ADR 0010 取代。
- `0003-plaintext-local-credentials.md`：OSS 不依赖系统钥匙串，使用 `userData` 下的独立明文文件管理用户第三方凭证，并统一状态所有者、IPC、迁移和诊断边界。
- `0004-independent-edition-release-pipelines.md`：开源版与商业版由各自仓库独立构建和发布，不建立跨仓库发布依赖。
- `0005-macos-update-installer-gate.md`：淘汰会建立第二检查/下载状态机的现成 updater，只允许受真实签名与回滚实验约束的最小 Helper 候选；闸门前维持可信 DMG。
- `0006-owned-agent-runtime-model-service-boundary.md`：CCLink 拥有一致的 Agent Runtime，用户只选择受支持的模型服务；ACP、用户自带 Agent 和外部 Agent Registry 不进入当前产品路线。
- `0007-managed-claude-runtime.md`：允许 Studio 从受限 npm 平台包安装并管理 Claude Runtime，保持 Agent SDK 为完整 App 核心代码，并定义 App 替换复用、会话边界和回滚门禁。
- `0008-managed-runtime-resources.md`：允许固定目录下载安装 OCCT WASM、scrcpy server 与 agent-device Android Helper，禁止执行下载 JavaScript，并明确各领域激活、App 内回退和 Helper 待宿主支持边界。
- `0010-thin-runtime-package.md`：Claude Runtime 不再随 `.app` 分发，改为组件页按需安装；旧 bundled 选择迁移到 managed，Agent 缺失不阻断工作台。
- `0011-release-signing-runtime-keychain-boundary.md`：明确 NO_SYSTEM_KEYCHAIN 只约束 App
  运行时；正式 Release 必须在隔离 CI 中使用临时钥匙串完成 Developer ID 签名和 Apple 公证。
- `0012-controlled-peer-acp-runtime.md`：在保留 Claude Code 必备默认基线和直接 SDK 路径的前提
  下，允许 Thread 显式选择受控、本地、Codex-only 的 ACP Runtime；不开放 Registry、任意 Agent
  或远程 transport。
- `0013-isolated-plain-text-url-activation.md`：允许 Browser main frame 在无权限 isolated world
  中按用户点击位置识别纯文本 HTTP(S) URL；不改写 DOM、不回传正文，仍复用现有 URL 校验、
  Profile 和 Tab 生命周期。
- `0014-global-web-account-catalog.md`：网站、主体、账号、Profile/Session 和运营矩阵改为本机
  Studio 全局资源；事务继续属于项目，AI 是否可以调用账号保持未决且不得默认放开。
- `0015-isolated-horizontal-pan-fallback.md`：允许 Browser main frame 在无权限 isolated world
  中为被网站隐藏的横向范围提供触控板和 Shift + 滚轮兜底；不改写 DOM、不回传网页内容，
  Chromium 原生滚动行为优先。
