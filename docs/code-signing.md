# CCLink Studio macOS ad-hoc 打包边界

> 状态：本地构建和 OSS Release 都只使用 ad-hoc 签封；禁止 Developer ID、Apple 公证、
> 系统钥匙串和凭证导入。ADR 0009 与 NO_SYSTEM_KEYCHAIN 取代旧发布路线。

## 结论

开源 `cclink-studio` 不读取或保存发布证书，不导入任何系统凭证，也不执行 Developer ID
签名或 Apple 公证。`.github/workflows/release-oss.yml` 从不可变 Tag 构建 ad-hoc arm64 DMG，
门禁通过后可以创建公开 Release。该制品不是 Apple 信任链内的无提示安装包。

## 背景

普通用户要获得无警告安装通常需要 Developer ID 与 Apple 公证，但本产品决策明确禁止
本仓库执行这两项操作。因此当前边界是：

1. App 内嵌可执行文件只做 ad-hoc 签封；
2. 不使用证书、P12、Apple API Key、系统钥匙串或公证；
3. 首次打开与升级由用户手动确认；
4. 现有要求 Developer ID 的自动更新验证器不算可交付更新闭环。

## OSS 本地构建

```bash
pnpm package:local
```

OSS 本地包使用 `identity: '-'` 做 ad-hoc 签封，便于 macOS 接受应用包内的嵌套可执行文件。它不是 Developer ID 签名，也没有经过 Apple 公证。首次打开仍可能需要右键打开，或清除 quarantine：

```bash
xattr -cr /Applications/CCLink\\ Studio\\ 开源版.app
```

## OSS Release

正式工作流只执行源码/Tag 校验、arm64 构建、ad-hoc 打包、包结构与校验和检查、Release
上传。工作流不得引用 P12、Developer ID identity、Apple API Key、`security`、notarytool
或 stapler。若未来要改变该边界，必须由新的用户决策和 ADR 明确取代 ADR 0009。

## 拷问

ad-hoc Release 可以发布，但不能宣称已获得 Apple 信任链，也不能把现有 Developer ID
自动更新校验当成可用闭环。发布完成与自动更新完成是两件事。
