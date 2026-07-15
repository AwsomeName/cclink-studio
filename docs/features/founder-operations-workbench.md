# CCLink Studio 创始人项目运营工作台需求记录

> 当前事实源。最后更新：2026-07-15。

## 结论

CCLink Studio OSS 近期最该服务的真实工作流是：在本地项目目录里组织资料、写 Markdown 文案、用内嵌浏览器登录平台并提交内容、保存发布记录、用诊断日志排查失败。

远程服务器项目维护仍然是重要商业/官方方向，但不属于 `cclink-studio` OSS 默认能力。远程工作空间、远程文件、远程 Terminal、远程 Agent、账号、entitlement 和配对已迁出或封存，不能继续作为当前 OSS MVP 验收项。

## 当前优先级

1. **项目内运营助手**：本地项目目录、平台配置、Markdown 文案、浏览器提交、发布记录。
2. **本地工作空间可靠性**：Tab、草稿、会话、浏览器 profile、Terminal 审计和状态恢复。
3. **硬件/生产辅助**：AI 眼镜、PCB、FPC、嘉立创下单等，先用文件、Markdown、浏览器和生产包检查承接。
4. **Android 收缩**：不推进本地模拟器和云手机；只保留用户自有真机 USB / Wi-Fi 连接方向。

## 项目内运营助手

近期最真实的高频工作流：

```text
打开本地项目
→ 读取项目资料
→ 写 Markdown 文案
→ 打开平台页面
→ 填写内容并等待用户确认
→ 写回发布记录
```

产品判断：

- 不新增独立“运营平台”。
- 不把每个平台做成工作空间。
- 不做密码库或完整账号管理器。
- 工作空间仍然是本地项目目录。
- 平台信息只是项目里的 `deepink-accounts.json`。
- 文案由工作会话写入项目 Markdown。
- 平台操作由另一个工作会话打开浏览器、读取平台配置、填表并等待确认。
- 发布记录写回项目 Markdown，例如 `docs/发布记录.md`。

推荐项目结构：

```text
项目目录
├─ README.md
├─ docs/
│  ├─ 宣发方案.md
│  ├─ 公众号首发稿.md
│  ├─ 知乎版本.md
│  └─ 发布记录.md
└─ deepink-accounts.json
```

`deepink-accounts.json` 是兼容保留的项目配置文件名，暂不机械改名。

示例：

```json
{
  "version": 1,
  "platforms": [
    {
      "id": "wechat-mp",
      "name": "微信公众号",
      "url": "https://mp.weixin.qq.com",
      "account": "CCLink Studio",
      "notes": "扫码登录；发布前必须人工确认。",
      "browserProfile": "wechat-mp"
    }
  ]
}
```

密码、token、恢复码等秘密信息不进入项目可见文件。后续如支持敏感凭据，只保存本机加密凭据引用。

当前状态：

- 已实现项目账号配置模板、读取和校验。
- 已实现文案草稿创建和文案工作会话入口。
- 已实现平台浏览器 profile 打开入口。
- 已实现平台操作工作会话入口。
- 已实现发布记录追加到项目 Markdown。
- 待真实平台人工验收。

## 平台浏览器 Profile

目标：让项目配置中的平台入口复用登录态。

验收：

- `deepink-accounts.json` 能声明 `browserProfile`。
- 不同平台可以使用不同 profile。
- 重启后浏览器 profile 仍保留 Cookie 和站点状态。
- UI 能提示当前页面正在使用哪个 profile。
- 不存密码，不绕过验证码或 2FA。
- 真正发布、提交、删除、改资料前必须确认。

## 硬件/生产辅助

AI 眼镜、PCB、FPC、结构件和小批量生产项目第一阶段不做专门垂直 App。

先支持：

- 资料和文件归入本地工作空间。
- 浏览器打开嘉立创、供应商、数据手册网站。
- Markdown 记录需求、BOM、下单步骤和问题。
- Agent 辅助核对网页表单、整理资料、生成检查清单。
- 下单、付款、地址确认前必须人工确认。

详见：

- `docs/features/hardware-workspace.md`
- `docs/features/fpc-shape-change-assistant.md`
- `docs/features/cad-conversion-plugins.md`

## Android 收缩

当前产品决策：

- 不默认调用 Android 虚拟机。
- 不推进 Google AVD / QEMU 模拟器生命周期管理作为近期主线。
- 不考虑云手机作为近期或中期路线。
- 后续只考虑用户自己的真实手机：
  - USB 连接。
  - Wi-Fi ADB 连接。
  - 必要时保留 scrcpy 投屏 / ADB 操控思路。

边界：

- Android 不作为 v0.1 可用状态验收项。
- 设置页可以保留设备诊断入口。
- Agent 不应在没有用户明确选择设备的情况下调用 Android 工具。
- 未连接设备时 Android capability 明确降级，不影响浏览器、Markdown 和本地工作空间。

## 明确暂缓

- 远程工作空间。
- 远程文件树。
- 远程 Terminal。
- 远程 Agent runtime。
- 本地 Android 模拟器。
- 云手机。
- 完整 IM 产品。
- 自建云盘产品。
- 完整 AI 记忆系统。
- EDA / PCB / 游戏资产的垂直编辑器。
- 通用社媒管理 SaaS。
- 密码库和全自动登录。

## 历史远程方向

远程项目维护仍然重要，但已经从 Studio OSS 当前 MVP 中移出。

如果官方版本继续推进，真实归属应是：

- commercial/official desktop overlay：`/Users/apple/Desktop/cclink-dev`
- 云函数、账号、entitlement、pairing、token：`/Users/apple/Desktop/chat-cc/deploy`
- Agent runtime：`/Users/apple/Desktop/chat-cc/Agent`

相关历史材料：

- `docs/features/historical-remote-workspace-model.md`
- `docs/remote-program/`
- `docs/features/remote-codex-workspace-plan.md`

## 拷问

第一问：把远程 P0 拿掉，会不会削弱真实价值？短期不会。OSS 壳先把本地项目运营跑顺，远程由 official/commercial 侧恢复，边界更稳。

第二问：项目运营助手是不是会滑向社媒管理平台？会，所以第一版只围绕项目目录、Markdown、浏览器 profile 和发布记录，不做平台后台、密码库和批量账号。

第三问：Android 收缩会不会浪费已有能力？不会。封存不是删除代码，而是避免模拟器/云手机继续定义近期路线。

第四问：下一步最该验收什么？用一个真实本地项目完成一次“写稿 → 打开平台 → 填写 → 人工确认 → 写回发布记录”的闭环。
