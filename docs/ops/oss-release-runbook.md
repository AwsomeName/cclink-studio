# CCLink Studio 开源版发布手册

> 适用范围：`AwsomeName/cclink-studio` 的 Developer ID 直接分发版本。
> 商业版由 `cclink-dev` 使用自己的工作流发布，不执行本手册。

## 结论

开源版正式发布统一从仓库根目录执行：

```bash
pnpm release:oss -- --patch
```

该命令负责发布前验证、版本提交、不可变 Tag、原子推送、触发 GitHub Actions，
以及等待 arm64 和 x64 的签名、公证与 Draft Release 完成。它不会公开 Release；
维护者检查安装包后，仍须在 GitHub 手动点击 `Publish release`。

`scripts/package.sh` 只生成本机未签名测试包，不得用于正式发布。

## 一次性准备

### GitHub Environment

仓库必须存在名为 `studio-release` 的 Environment，并配置：

```text
MACOS_CERTIFICATE_P12_BASE64
MACOS_CERTIFICATE_PASSWORD
MACOS_DEVELOPER_IDENTITY
APPLE_API_KEY_BASE64
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

这些值只保存在 GitHub Environment Secrets 中，不得写入源码、`.env`、安装包、
日志或诊断文件。具体材料与安全边界见 `docs/code-signing.md`。

### 本机 GitHub 权限

发布操作者需要能够：

- 推送 `main` 和新 Tag。
- 触发 `release-oss.yml`。
- 读取 Actions 和 Release 状态。

使用细粒度 GitHub Token 时，仓库范围只选择 `AwsomeName/cclink-studio`，最小权限为
`Contents: Read and write` 和 `Actions: Read and write`。Token 交给本机 Git
credential helper 保存，不配置为仓库文件或环境变量。

先验证本机可以访问远端：

```bash
git ls-remote origin HEAD
```

## 每次发布前

1. 确认当前位于开源仓库，而不是 `cclink-dev` 商业版工作区。
2. 提交或妥善处理所有本地改动，确保工作树干净。
3. 切换并快进到最新 `main`：

```bash
git switch main
git pull --ff-only origin main
git status --short
```

`git status --short` 必须没有输出。发布脚本还会再次校验远端仓库、当前分支、
工作树、`origin/main` 和目标 Tag；任一条件不满足都会在产生发布副作用前停止。

## 标准发布

### Patch 版本

例如当前版本是 `0.1.2`，发布 `0.1.3`：

```bash
pnpm release:oss -- --patch
```

### 指定版本

```bash
pnpm release:oss -- --version 0.2.0
```

目标必须是高于当前版本的稳定 `X.Y.Z`，不能复用已有 Tag。

脚本会显示计划并要求输入：

```text
release vX.Y.Z
```

确认后依次执行：

1. `pnpm install --frozen-lockfile`。
2. `pnpm verify`。
3. `pnpm smoke:standalone`。
4. 更新 `package.json`，创建 `chore: prepare vX.Y.Z` 提交。
5. 创建 annotated `vX.Y.Z` Tag。
6. 执行 OSS 发布预检。
7. 原子推送 `main` 和 Tag，避免只成功其中一项。
8. 触发 `release-oss.yml`，等待远端任务完成。
9. 输出 Draft Release 地址和资产清单。

`--no-wait` 可以在触发远端任务后立即返回，但不改变远端构建和 Draft 策略。
`--yes` 只用于明确受控的非交互环境，日常人工发布不要使用。

## Draft 验收与公开

GitHub Actions 必须全部通过：

- `validate`
- `package (arm64, macos-15)`
- `package (x64, macos-15-intel)`
- `draft`

Draft Release 至少应包含两种架构的 DMG、ZIP、checksums、build record 和唯一的
`update-manifest.json`。`draft` job 会在创建 Draft 前根据真实文件反向重建 Manifest；
任一架构缺失、版本/source SHA 不一致、文件大小或哈希不匹配都会停止发布。发布前：

1. 核对 Release、Tag 和 `package.json` 版本一致。
2. 核对 build record 的源码 SHA 与 Tag 提交一致。
3. 下载完整 Draft 资产并再次验证 Manifest：

```bash
pnpm verify:update-manifest -- \
  --assets-dir /path/to/downloaded-release-assets \
  --manifest /path/to/downloaded-release-assets/update-manifest.json \
  --tag vX.Y.Z
```

4. 下载对应架构 DMG，在干净 Mac 上安装和启动。
5. 确认 Gatekeeper 不要求 `xattr` 绕过。
6. 确认应用名称、版本、架构和基础本地能力正确。

只有以上检查通过，才在 GitHub Draft Release 页面点击 `Publish release`。这是正式
公开给用户的最后人工确认点。

### U0 失败注入

`release-oss` 的手动输入 `failure_injection` 默认且正常值必须是 `none`，仓库发布
脚本也会显式传入 `none`。`omit-x64-build-record` 只用于维护者执行 U0 回归验收：
它在两个 package job 成功后、Manifest 生成和 Draft 上传前删除 x64 build record，
预期结果是 Manifest job 失败且 `Create draft release` 为 `skipped`。不得将失败注入
用于正常发版，也不得据此移动或复用已有 Tag。

## 失败恢复

先判断远端 Tag 是否存在：

```bash
git ls-remote --tags origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

### 远端 Tag 不存在

失败发生在推送之前。查看本地状态：

```bash
git status
git log -1 --oneline
git tag --points-at HEAD
```

不要直接重复运行并制造第二个版本提交。先修复失败原因；如果脚本已经创建本地
版本提交或 Tag，由维护者审查现场后再决定如何整理，禁止使用
`git reset --hard` 清理现场。

### 远端 Tag 已存在，但工作流未触发

不要重新创建、移动或覆盖 Tag。执行：

```bash
pnpm release:oss -- --dispatch-only vX.Y.Z
```

脚本会从远端 Tag 解析真实提交，校验该提交中的 `package.json` 版本，然后重新触发
签名、公证和 Draft Release。

### 工作流失败

- 凭证、Runner 或临时网络问题：修复 GitHub Environment 或外部状态后，使用
  `--dispatch-only` 重试同一个不可变 Tag。
- 源码、打包配置或产物问题：不要修改已推送 Tag。修复代码后发布更高版本。
- GitHub API 返回 401/403：检查本机 GitHub credential 的仓库范围和
  `Contents`、`Actions` 权限，不要修改 Apple 公证 Secrets。

### Draft 资产不合格

不要公开，不要用手工上传覆盖正式资产。修复后发布更高版本，保留失败记录用于
审计。

## 禁止操作

- 禁止 force-push `main`。
- 禁止删除、移动或复用已推送 Tag。
- 禁止把 P12、P12 密码、P8 或 GitHub Token 写入仓库。
- 禁止把 `scripts/package.sh` 产物当成正式安装包上传。
- 禁止绕过失败的 `verify`、smoke、签名、公证、staple 或 Gatekeeper 检查。
- 禁止让开源工作流调用 `cclink-dev`，或让商业工作流拥有开源 Release 状态。

## 发布完成标准

一次开源发布只有同时满足以下条件才算完成：

- `main` 包含唯一的版本提交。
- `vX.Y.Z` Tag 指向该提交。
- GitHub Actions 全绿。
- arm64 和 x64 Draft 资产齐全且通过签名、公证和 Gatekeeper 检查。
- `update-manifest.json` 能从下载后的真实资产、checksums 和 build record 独立重建。
- 真人安装启动验收通过。
- Draft Release 已由维护者人工公开。
