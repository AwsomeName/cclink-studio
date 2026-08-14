# ADR 0011：正式发布签名与应用钥匙串边界

- 状态：accepted
- 日期：2026-08-14
- 负责人：CCLink Studio Maintainers
- 取代：ADR 0009 中“不执行 Developer ID 签名或 Apple 公证”的发布条款

## 问题

`NO_SYSTEM_KEYCHAIN` 原本用于禁止 Studio 在用户设备上读取或保存系统钥匙串凭证，却被错误
扩大为“GitHub Release runner 也不得使用临时钥匙串、Developer ID 或 Apple 公证”。这导致
v0.1.30 改为 ad-hoc 公开包，而现有更新器仍正确要求 Developer ID、Team ID 和公证，用户无法
从应用内打开更新包，macOS 也会阻止普通双击启动。

## 用户验收目标

1. 用户从已签名的旧版检查到新版并完成下载；
2. 点击“打开安装包”后不出现 `publisher_mismatch`；
3. DMG、App、Bundle ID、版本、arm64、Developer ID、Team ID、Apple 公证和源码身份全部通过；
4. 替换 App 后设置、项目、凭证文件和 Runtime 组件保持不变，新版可以启动。

## 决策

1. `NO_SYSTEM_KEYCHAIN` 只约束 Studio 应用运行时、打包进应用的代码和用户设备。
2. 正式 Release 必须在受保护的 GitHub Environment 中使用 Developer ID Application 签名，
   并通过 Apple notarization、staple 和 Gatekeeper 校验。
3. P12、密码和 Apple API Key 只来自 GitHub Environment Secrets，只写入临时 runner 文件和
   临时钥匙串，任务结束立即销毁；不得进入源码、App、安装包、日志或用户设备。
4. 本地 `pnpm package:local` 继续生成 ad-hoc 测试包，不得冒充正式 Release。
5. 缺少签名、公证凭证或任何 `codesign`、`stapler`、`spctl` 门禁失败时，工作流必须在公开
   Release 前失败，不得降级发布 ad-hoc 包。
6. 更新器继续严格校验当前 App 与候选 App 的 Developer ID、Team ID、Bundle ID、版本和架构；
   不以降低更新器校验的方式兼容未签名公开包。
7. 正式工作流必须在构建前生成当前 Tag 的源码指纹，将其写入 App，并在签名产物上传前从
   `app.asar` 重新读取和核验；缺失或不匹配时禁止公开 Release。

## 不变量

- Studio 运行时继续禁止 `safeStorage`、`keytar`、Apple Keychain API 和 `security` 命令。
- Studio 不读取或迁移用户历史钥匙串；用户第三方凭证和 CCLink Session 仍按现有本地文件边界管理。
- 正式发布凭证不进入仓库、默认配置、诊断、缓存或安装包。
- 已公开 Tag 和资产不覆盖；错误版本通过更高版本修复。

## 事件处理

- v0.1.30 是错误的 ad-hoc 公开版本，不作为可交付的 macOS 安装/更新闭环。
- v0.1.31 恢复了签名、公证和 Gatekeeper 门禁，但正式工作流遗漏了本地打包已有的源码指纹
  写入步骤，因此只作为签名恢复证据，不作为完整发布验收闭环。
- v0.1.32 起，签名、公证与源码身份必须在同一个正式产物上同时通过。
- 修复版本必须从公开 Release 重新下载，并在真实 macOS 上验证 SHA-256、`codesign`、
  `stapler`、`spctl`、DMG 打开、App 启动和旧版更新路径。

## 验证

- 发布工作流测试证明 P12 身份预检、临时钥匙串、Developer ID、notarization、staple 和
  Gatekeeper 步骤不可删除；
- `pnpm verify:credential-boundary` 证明应用运行时代码仍不访问系统钥匙串；
- 正式包执行 `codesign --verify --deep --strict`、`xcrun stapler validate`、
  `spctl --assess --type execute` 和 DMG `spctl --assess --type open`；
- 从正式 App 的 `app.asar/out/build-provenance.json` 读取并匹配当前 Tag 提交和源码指纹；
- 在真实旧版中完成检查、下载、打开安装包和替换启动。
