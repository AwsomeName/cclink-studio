# CCLink Studio Mac 签名与公证指南

> 状态：OSS 本地构建使用 ad-hoc 签封；OSS Release 由本仓库受保护的 GitHub
> Environment 完成签名和公证。商业版由 `/Users/apple/Desktop/cclink-dev`
> 独立发布。

## 结论

开源 `cclink-studio` 仓库不内置 Developer ID、notarization 密钥或生产更新源。
普通本地构建用于开发测试；开源正式包由本仓库 `.github/workflows/release-oss.yml`
从不可变 Tag 构建，使用 `studio-release` Environment Secrets 完成签名和公证，
并在全部自动门禁通过后创建本仓库公开稳定 Release。商业版继续由 `cclink-dev` 自有工作流独立发布。
维护者的完整发布步骤和失败恢复见 `docs/ops/oss-release-runbook.md`。

## 背景

CCLink Studio 通过 DMG 分发时，如果要让普通用户无警告打开，需要：

1. Developer ID Application 证书签名。
2. Apple notarization。
3. 正确的 entitlements 和 hardened runtime 配置。

这些材料包含发布身份和权限，只能存在于受保护的 GitHub Environment Secrets，
不得进入 OSS 源码、默认配置、安装包或日志。

## OSS 本地构建

```bash
pnpm package:local
```

OSS 本地包使用 `identity: '-'` 做 ad-hoc 签封，便于 macOS 接受应用包内的嵌套可执行文件。它不是 Developer ID 签名，也没有经过 Apple 公证。首次打开仍可能需要右键打开，或清除 quarantine：

```bash
xattr -cr /Applications/CCLink\\ Studio\\ 开源版.app
```

## OSS Release

本仓库只维护中性的发布流程：

- `.github/workflows/release-oss.yml`。
- Developer ID Application 签名和 P12 导入校验。
- Apple API Key 公证与 staple。
- entitlements。
- GitHub 公开稳定 Release 资产上传。

证书、P12 密码、Apple API Key 和其他敏感值只存在于 `studio-release`
Environment Secrets。不要把它们、生产 feed URL 或长期 GitHub Token 写回
`cclink-studio` 默认路径。

商业版可以复用同一发布者身份，但必须在 `cclink-dev` 中维护独立的凭证授权、
Tag、制品和发布状态，不能由开源 workflow 编排。

## 拷问

签名问题看起来只是打包配置，但本质是发布权限边界。源码可审计的 workflow
可以描述流程，敏感凭证不能进入仓库；开源版与商业版也不能共享发布状态或互相触发。
