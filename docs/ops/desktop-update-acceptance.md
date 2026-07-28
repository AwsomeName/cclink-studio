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

`COMPLETE (100%)`。本地实现、失败矩阵、全量门禁、独立启动 smoke、远端 CI、
真实测试 Tag、成功 Draft、下载后独立复核和预期失败 Actions Run 均已通过。
U0 只关闭更新契约与发布元数据，不代表 U1-U5 的检查、下载或安装能力已经实现。

### 实现范围

- [x] Manifest schemaVersion 1 和双架构资产契约。
- [x] UpdateSnapshot、command、event、错误码和安装短期确认令牌契约。
- [x] 中性 UpdateProvider 接口，不包含仓库或商业版状态。
- [x] 从真实资产、checksums 和 build record 生成 Manifest。
- [x] 反向重建 Manifest 并在 Draft 创建前验证。
- [x] OSS workflow 汇总 arm64/x64 后生成唯一 Manifest。
- [x] 有效、缺架构、错 source SHA、错哈希、非法资产名和 prerelease 自动化测试。
- [x] 真实测试 Tag 成功生成 Draft。
- [x] 真实失败注入在创建 Draft 前停止。

### 本地自动化

| 日期       | 源提交    | 命令                                                | 结果                 |
| ---------- | --------- | --------------------------------------------------- | -------------------- |
| 2026-07-28 | `09aacf5` | `pnpm verify:release`                               | PASS，26/26          |
| 2026-07-28 | `09aacf5` | U0 TypeScript/Vitest 定向测试                       | PASS，17/17          |
| 2026-07-28 | `09aacf5` | `pnpm verify`                                       | PASS，161 files/974  |
| 2026-07-28 | `09aacf5` | `pnpm smoke:standalone`                             | PASS，28/28          |
| 2026-07-28 | `09aacf5` | 缺架构、错 SHA/哈希、跨 Run、非法名、符号链接和篡改 | PASS，本地确定性测试 |
| 2026-07-28 | `1bd1985` | `pnpm verify:release`                               | PASS，30/30          |
| 2026-07-28 | `1152699` | 文档所列 `pnpm verify:update-manifest -- ...`       | PASS，真实 Draft 资产 |

### 远端 CI

| 日期       | 源提交    | Run                                                                             | 结果                             |
| ---------- | --------- | ------------------------------------------------------------------------------- | -------------------------------- |
| 2026-07-28 | `047355f` | [CI #112](https://github.com/AwsomeName/cclink-studio/actions/runs/30341274046) | PASS，verify 1m57s / smoke 2m09s |
| 2026-07-28 | `9ad528b` | [v0.1.4 Release Run](https://github.com/AwsomeName/cclink-studio/actions/runs/30350340061) | PASS，validate、arm64、x64、draft |
| 2026-07-28 | `1bd1985` | [U0 failure Run](https://github.com/AwsomeName/cclink-studio/actions/runs/30354492019) | EXPECTED FAIL，上传前停止 |

### 真人与远端验收

| 项目                                    | 状态    | 证据 |
| --------------------------------------- | ------- | ---- |
| 测试 Tag 的 arm64/x64 package jobs      | PASS | [v0.1.4 Run](https://github.com/AwsomeName/cclink-studio/actions/runs/30350340061)，两个原生 runner 均完成签名、公证、staple 和 Gatekeeper |
| Draft 包含唯一 `update-manifest.json`   | PASS | [v0.1.4 Draft](https://github.com/AwsomeName/cclink-studio/releases/tag/untagged-275b3b615a6816753c12)，9 个资产 |
| 本地下载并反向验证 Draft 全部资产       | PASS | 重新下载约 1 GB；4/4 SHA-256、Manifest 重建、2/2 `stapler validate` 和 Gatekeeper 均通过 |
| 修改任一资产后 verifier 拒绝            | PASS | 向 arm64 ZIP 追加数据后返回退出码 1，错误为 `asset checksum mismatch` |
| 缺架构或错哈希时 Draft job 在上传前失败 | PASS | [failure draft job](https://github.com/AwsomeName/cclink-studio/actions/runs/30354492019/job/90263174878)：注入删除 x64 build record，Manifest 失败，Create draft 为 skipped |

### 发现并修复

- 首次测试 Tag `v0.1.3` 的 [Run](https://github.com/AwsomeName/cclink-studio/actions/runs/30344952244)
  虽成功，但 GitHub 将中文和空格资产名规范化，导致下载后的文件名与 Manifest 不一致。
  对应 Draft 保持未公开，Tag 不移动、不复用；`v0.1.4` 改为规范 ASCII 资产名后通过。
- 发布脚本和 Manifest verifier 均补齐 pnpm 参数分隔符兼容；发布预检生成的 `.build/`
  已作为派生产物忽略，连续发布不会再被自身报告阻塞。

### U0 关闭条件

关闭结论：以上条件已全部满足，U0 于 2026-07-28 关闭。`v0.1.4` 仍是 Draft，
不得把 U0 关闭误解为允许跳过 R0 的干净 Apple Silicon/Intel Mac 真人安装验收，
也不得误解为客户端自动更新已经可用。

### 过程偏航复盘（2026-07-28）

结论：U0 技术验收有效，但执行和汇报不符合产品预期。连续约五小时投入发布流水线
后，Studio 仍不能检查、下载或安装更新；此前使用“U0 100%”和“整体 22.5%”作为
主要进度表述，错误地把工程准备度包装成用户功能进度。

根因：

- 计划允许没有用户可见结果的 U0 作为产品里程碑并获得进度权重。
- 前置工作没有 60 分钟时间盒，同类发布问题可以连续占用主线时间。
- 阶段汇报先报告内部编号、测试和 CI，没有先回答用户现在能做什么。

纠正：

- R0/U0 重新归类为工程前置，不计入用户功能进度。
- 当前用户功能进度明确回退为 `0%`；只有 U1 在真实 Studio 中通过检查更新验收后
  才能提高。
- 执行采用 60 分钟偏航检查、单项前置时间盒和同一阻塞两次失败止损。
- 后续完成声明必须附真实 Studio 的用户验收动作；mock、CI、Draft 和文档只能证明
  工程门禁。

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
