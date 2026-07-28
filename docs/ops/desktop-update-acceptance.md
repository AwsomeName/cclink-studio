# Desktop Update Acceptance

> 目的：记录桌面更新 U0-U5 的自动化、真人验收和脱敏证据。
> 产品事实源：`docs/features/desktop-release-and-updates.md`。
> 执行计划：`docs/features/desktop-update-development-plan.md`。

## 记录规则

- 每个里程碑必须同时记录源提交、自动化命令、真人步骤、失败注入和残余风险。
- 远端 Actions、Draft 和正式 Release 使用 URL；本地证据只记录必要摘要。
- 禁止记录 Token、Cookie、P12/P8、密码、用户目录完整路径和下载 URL 查询参数。
- 未完成的真人或远端验收必须保持 `PENDING`，不能用本地 mock 代替。

## U0：更新契约与发布元数据

### 当前状态

`IN PROGRESS (75%)`。本地实现、失败矩阵、全量门禁和独立启动 smoke 已通过；真实
测试 Tag、成功 Draft、下载后独立复核和预期失败 Actions Run 尚未执行，因此 U0
尚未关闭。

### 实现范围

- [x] Manifest schemaVersion 1 和双架构资产契约。
- [x] UpdateSnapshot、command、event、错误码和安装短期确认令牌契约。
- [x] 中性 UpdateProvider 接口，不包含仓库或商业版状态。
- [x] 从真实资产、checksums 和 build record 生成 Manifest。
- [x] 反向重建 Manifest 并在 Draft 创建前验证。
- [x] OSS workflow 汇总 arm64/x64 后生成唯一 Manifest。
- [x] 有效、缺架构、错 source SHA、错哈希、非法资产名和 prerelease 自动化测试。
- [ ] 真实测试 Tag 成功生成 Draft。
- [ ] 真实失败注入在创建 Draft 前停止。

### 本地自动化

| 日期       | 源提交    | 命令                                                | 结果                 |
| ---------- | --------- | --------------------------------------------------- | -------------------- |
| 2026-07-28 | `09aacf5` | `pnpm verify:release`                               | PASS，26/26          |
| 2026-07-28 | `09aacf5` | U0 TypeScript/Vitest 定向测试                       | PASS，17/17          |
| 2026-07-28 | `09aacf5` | `pnpm verify`                                       | PASS，161 files/974  |
| 2026-07-28 | `09aacf5` | `pnpm smoke:standalone`                             | PASS，28/28          |
| 2026-07-28 | `09aacf5` | 缺架构、错 SHA/哈希、跨 Run、非法名、符号链接和篡改 | PASS，本地确定性测试 |

### 真人与远端验收

| 项目                                    | 状态    | 证据 |
| --------------------------------------- | ------- | ---- |
| 测试 Tag 的 arm64/x64 package jobs      | PENDING | -    |
| Draft 包含唯一 `update-manifest.json`   | PENDING | -    |
| 本地下载并反向验证 Draft 全部资产       | PENDING | -    |
| 修改任一资产后 verifier 拒绝            | PENDING | -    |
| 缺架构或错哈希时 Draft job 在上传前失败 | PENDING | -    |

### U0 关闭条件

只有本地完整门禁、成功 Draft、预期失败 Run 和下载后独立验证全部通过，才能把本节状态
改为 `COMPLETE`。在此之前可以进入 PR 评审，但不能宣称 U0 已关闭。

## U1-U5

尚未开始。后续每个里程碑复制以下模板：

```text
里程碑 / 日期 / 操作者
源提交 SHA / 安装前版本 / 目标版本 / CPU 架构 / macOS 版本
自动化命令与结果
真人步骤与结果
失败注入与恢复结果
Actions Run / Draft 或 Release URL
脱敏截图或诊断编号
残余风险与是否允许进入下一里程碑
```
