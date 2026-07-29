# CCLink Studio Mac 签名与公证指南

> 状态：OSS 本地构建使用 ad-hoc 签封，不包含 Developer ID 签名或公证；官方签名、公证和发布链路在 `/Users/apple/Desktop/cclink-dev`。

## 结论

开源 `cclink-studio` 仓库不内置官方 Developer ID、notarization 密钥、生产更新源或上传脚本。普通本地构建可以用于开发测试；正式签名、公证、更新源生成和分发应由 `cclink-dev` 的官方发布层执行。

## 背景

CCLink Studio 通过 DMG 分发时，如果要让普通用户无警告打开，需要：

1. Developer ID Application 证书签名。
2. Apple notarization。
3. 正确的 entitlements 和 hardened runtime 配置。

这些材料包含官方身份和发布权限，不应进入 OSS 默认配置。

## OSS 本地构建

```bash
pnpm package
```

OSS 本地包使用 `identity: '-'` 做 ad-hoc 签封，便于 macOS 接受应用包内的嵌套可执行文件。它不是 Developer ID 签名，也没有经过 Apple 公证。首次打开仍可能需要右键打开，或清除 quarantine：

```bash
xattr -cr /Applications/CCLink\\ Studio\\ 开源版.app
```

## 官方发布

官方发布侧应在 `cclink-dev` 维护：

- electron-builder 官方发布基线。
- Developer ID Application 签名配置。
- notarization 环境变量模板。
- entitlements。
- updater feed。
- 上传脚本。

不要把证书、Apple ID、App 专用密码、Team ID、制品上传 密钥或生产 feed URL 写回 `cclink-studio` 默认路径。

## 拷问

签名问题看起来只是打包配置，但本质是发布权限边界。只要 OSS 仓库能默认触达官方上传或生产更新源，就说明边界没有清干净。
