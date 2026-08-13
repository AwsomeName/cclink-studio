# CCLink Studio 开源版发布手册

> 适用范围：`AwsomeName/cclink-studio` 的 Apple Silicon Developer ID 直接分发版。
> 不支持 Intel/x64。商业版由 `cclink-dev` 使用独立工作流发布。

## 正式入口

```bash
pnpm release -- --patch
pnpm release -- --version 0.2.0
```

该命令要求当前 `main` 源码已有成功的普通 CI，然后只创建修改 `package.json.version`
的版本提交和不可变 Tag，原子推送并触发 GitHub Actions，等待签名、公证和正式 Release。
全部自动门禁通过后，工作流直接公开稳定 Release；真实用户安装与更新反馈属于发布后测试。

`pnpm package:local` 只生成本机未签名 arm64 测试包，不修改版本、不推送，也不得用于
正式发布。`release:oss` 仅作为旧命令的兼容别名保留，文档和人工操作统一使用
`pnpm release`。正式发布默认不再重复生成本地 DMG；确实需要时显式增加
`--local-artifacts`。

## 常规发版的最小必要流程

常规版本发布只执行以下闭环：

1. 确认当前 `main` 精确 SHA 已有成功的远端普通 CI。
2. 运行 `pnpm release -- --patch` 或指定更高的稳定版本。
3. 等待 `release-oss.yml` 完成，并确认公开稳定 Release 包含规定的四项 arm64 资产。

精确匹配的绿色普通 CI 是源码验证的唯一事实源。常规发版不得默认再次在本地运行
`pnpm verify`、`pnpm test`、`pnpm build` 或 smoke，不得默认增加 `--local-artifacts`，也
不得下载远端 DMG 重复执行工作流已经完成的哈希、签名、公证、Gatekeeper 或 Manifest
检查。远端工作流运行期间只监控状态，不用等待时间扩张验证范围。

只有用户明确要求、缺少精确匹配的绿色 CI、CI/发布失败，或本次变更触及发布脚本、签名、
公证、打包边界、更新 Manifest、发布工作流时，才升级为额外本地验证或独立产物复核；执行
前先说明原因。`--no-wait` 仅用于用户明确接受后台完成的场景，不能据此提前宣称发布成功。

## 一次性准备

仓库必须存在 `studio-release` Environment，并配置：

```text
MACOS_CERTIFICATE_P12_BASE64
MACOS_CERTIFICATE_PASSWORD
MACOS_DEVELOPER_IDENTITY
APPLE_API_KEY_BASE64
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

凭证不得写入源码、`.env`、安装包、日志或诊断文件。具体材料见
`docs/code-signing.md`。

发布操作者需要：

- 推送 `main` 和新 Tag。
- 触发与读取 `release-oss.yml`。
- 读取 Actions 和 Release 状态。

细粒度 GitHub Token 只授权 `AwsomeName/cclink-studio`，最小权限为
`Contents: Read and write`、`Actions: Read and write`。Token 交给系统 Git
credential helper，不配置成仓库文件或环境变量。

## 发布前

1. 确认当前目录是开源仓库，不是 `cclink-dev` 商业版工作区。
2. 确认 `main` 与 `origin/main` 一致，且该源码提交的普通 CI 已全绿。
3. 确认 `package.json` 没有未提交改动；其他本地改动可以保留，但不会进入发布。
4. 确认目标版本高于当前稳定版本，且本地和远端不存在同名 Tag。

```bash
git switch main
git pull --ff-only origin main
git status --short
git ls-remote origin HEAD
```

发布脚本会校验仓库、分支、远端、版本和 Tag。工作区可以存在其他未提交文件；脚本
只提交 `package.json`，并在临时 worktree 中执行发布预检和可选本地打包。若
`package.json` 本身有未提交改动，发布立即停止。

## 标准流程

例如当前为 `0.1.12`，发布下一个 patch：

```bash
pnpm release -- --patch
```

脚本显示计划后要求输入：

```text
release vX.Y.Z
```

确认后依次执行：

1. 校验当前 `main` 与 `origin/main` 一致，并查找该 SHA 的成功 CI。
2. 仅更新 `package.json.version`。
3. 使用 `git commit --only package.json` 创建 `chore: prepare vX.Y.Z` 提交。
4. 创建 annotated `vX.Y.Z` Tag。
5. 在独立临时 worktree 中执行 OSS 发布预检。
6. 若提供 `--local-artifacts`，在临时 worktree 中额外生成本地 ad-hoc DMG，
   再复制到当前仓库 `dist/`。
7. 原子推送 `main` 和 Tag。
8. 触发并等待 `release-oss.yml`。
9. 自动公开稳定 Release，并输出公开地址和远程资产清单。

普通 CI 是源码验证的唯一事实源。Release workflow 会再次证明版本提交只修改了
`package.json.version`，并核对其父提交存在准确匹配的成功 `main` CI，然后才允许
进入正式签名和公证。只有这些门禁全部通过，GitHub Release 才会公开。

`--no-wait` 只跳过本地等待，不改变远端自动公开策略。用户已经明确要求发布时，Codex
使用 `--yes`，不再要求二次口令；人工终端仍可保留交互式防误触确认。

## Actions 门禁

GitHub Actions 必须全部通过：

- `validate`：验证不可变 Tag、纯版本提交及其父提交的绿色 CI，不重复跑完整测试
- `package`，固定 `macos-15` 和 arm64
- `publish`

公开 Release 必须且只能包含一组 arm64：

```text
cclink-studio-X.Y.Z-arm64.dmg
checksums-arm64.txt
build-record-arm64.json
update-manifest.json
```

`update-manifest.json` 必须为 schema v3，只包含 `assets.arm64.dmg`。`publish` job 会根据
真实文件反向重建 Manifest；资产缺失、版本/source SHA 不一致、大小或哈希错误都会
在公开前停止。

仅在发布设施变更、门禁失败或用户明确要求时，才下载资产独立验证：

```bash
pnpm verify:update-manifest -- \
  --assets-dir /path/to/downloaded-release-assets \
  --manifest /path/to/downloaded-release-assets/update-manifest.json \
  --tag vX.Y.Z
```

## 发布后测试

在干净 Apple Silicon Mac 上：

1. 下载并打开 DMG。
2. 确认 Gatekeeper 不要求 `xattr` 或关闭安全设置。
3. 安装并启动应用。
4. 确认名称、版本和架构正确。
5. 验收本地 workspace、Agent、浏览器、Markdown、Terminal 和 Android 降级。
6. 若该版本包含更新能力，按对应里程碑执行旧版到新版升级验收。

自动门禁通过后直接公开正式 Release。以上安装动作属于发布后测试与反馈，不再阻塞公开；
发现问题时不得覆盖或移动已有 Tag，应修复后发布更高版本。

首次启用测试通道存在一次性引导约束：不包含 `updateTrack` 能力的旧客户端无法发现
Pre-release。必须先发布一个包含该能力的正式基线版，或让测试用户人工安装一次包含
该能力的测试包；此后才能通过应用内更新持续接收测试版。

## M0 故障注入

手动工作流输入 `failure_injection` 的正常值是 `none`。维护者验证 Manifest 门禁时
可选择 `omit-arm64-build-record`；工作流会在 Manifest 生成前删除
`build-record-arm64.json`，预期 `publish` 在 `Publish stable release` 前失败。

故障注入不得用于正常发布，也不得移动或复用已有 Tag。

## 失败恢复

先检查远端 Tag：

```bash
git ls-remote --tags origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

远端 Tag 不存在时，失败发生在推送前。检查现场，不使用 `git reset --hard`：

```bash
git status
git log -1 --oneline
git tag --points-at HEAD
```

远端 Tag 已存在但工作流未触发时，不重建或移动 Tag：

```bash
pnpm release -- --dispatch-only vX.Y.Z
```

工作流失败时：

- 凭证、Runner 或临时网络问题：修复外部状态后用 `--dispatch-only` 重试。
- 源码、打包配置或产物问题：修复代码后发布更高版本。
- 公开资产不合格：不要手工覆盖或移动 Tag，修复后发布更高版本。

## 禁止操作

- 禁止 force-push `main`。
- 禁止删除、移动或复用已推送 Tag。
- 禁止把 P12、P12 密码、P8 或 GitHub Token 写入仓库。
- 禁止把 `pnpm package:local` 产物当正式安装包上传。
- 禁止绕过源码 CI 的 `verify`/smoke，以及正式包的签名、公证、staple、Gatekeeper
  或 Manifest 检查。
- 禁止让开源工作流调用 `cclink-dev` 或共享商业版 Release 状态。

## 完成标准

一次开源发布只有同时满足以下条件才算完成：

- `main` 包含唯一版本提交，`vX.Y.Z` 指向该提交。
- GitHub Actions 全绿。
- arm64 DMG、checksums、build record 和 Manifest 齐全，且不存在 ZIP 资产。
- 签名、公证、staple、Gatekeeper 和 Manifest 反向验证通过。
- 工作流已自动创建公开稳定 Release，公开 API 可见版本与四项资产。
- 发布后的 Apple Silicon 安装与应用内更新反馈已记录；它们不阻塞公开，但发现问题必须发
  更高版本修复。
