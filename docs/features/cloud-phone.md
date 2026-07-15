# 云端手机 — 技术方案调研

> 调研时点:**2026/06**。所有产品状态/价格以官方文档抓取时点为准,云产品价格与 API 变更频繁,落地前请以控制台实时定价与 OpenAPI Explorer 实时文档为准。
>
> 本文档由 deep-research 工作流多源检索 + 对抗式核验生成,共 5 个搜索角度、抓取 20 个来源、提取 90 条论断、核验 25 条(23 条通过 3 票核验,2 条被推翻)。

> 2026-07-14 产品决策：云手机方向封存，不再作为 CCLink Studio 近期或中期路线推进。本文档仅保留为历史调研资料。CCLink Studio 后续 Android 方向只考虑用户自有真实手机通过 USB 或 Wi-Fi 连接。

## 当前决策

CCLink Studio 不再推进云手机，原因不是云手机技术不可行，而是它不服务当前最急的产品目标：

- 当前最急需求是远程项目支持、浏览器账号运营和 Markdown 文案发布。
- 云手机会引入额外账号、计费、合规、实例生命周期和厂商 SDK 风险。
- 云手机会继续放大 Android 方向的产品复杂度，稀释 CCLink Studio 的近期可用闭环。

因此：

- 不接入阿里云无影云手机、华为云 CPH、腾讯云 CVP 或其他云手机 provider。
- 不新增云手机后端模块。
- 不把云手机作为 Android 能力兜底。
- 如未来重新评估，必须先证明真实业务场景强依赖云端常驻手机，而不是普通浏览器或用户自有手机可解决。

## 概述

CCLink Studio 当前已有**本地 Android 实例**方案(`src/main/android/`,ADB + Scrcpy,详见 [android-mirror.md](./android-mirror.md))。本地方案的痛点在于:模拟器(Google AVD / QEMU)启动慢、资源占用高、ARM 翻译损耗、不同机器环境差异大,且 AI Agent 想批量调度多设备时本地几乎不可行。

本文档原本调研**云端手机**作为远程 Android 实例方案。以下是历史调研前提，已被 2026-07-14 的产品决策废弃:

- ~~**本地方案保留**,云端方案与之并存;~~
- ~~**云端作为主流方案**(默认走云端,本地作为离线/调试兜底);~~
- ~~三种接入能力**全都要**:~~
  - a. **程序化自动化控制**(Agent 通过 ADB / API 脚本操控)
  - b. **推流手动操作**(画面嵌入 DeepInk,人工点点点)
  - c. **应用托管 / 挂机**(实例常驻、定时任务)

调研范围以**阿里云**为重点,横向对比华为云、腾讯云、百度云。

当前有效结论以“当前决策”一节为准：不推进云手机。

## 历史核心结论(TL;DR)

以下结论只反映 2026-06 云手机调研判断，不再代表当前产品路线。当前有效路线是不推进云手机。

| 维度 | 结论 |
|------|------|
| **主流方案** | **阿里云「无影云手机」(eds-aic)** —— 三种接入能力齐全,且与现有 ADB+Scrcpy 栈**协议级兼容** |
| **ADB 接入** | 原生支持 `adb connect`,现有 ADB+Scrcpy 自动化代码可大量复用,仅换连接端点 |
| **推流嵌入** | 官方 `Wuying.WebSDK`,iframe inline 内嵌 + 会话内 `lync_adb_shell` 通道,推流与控制合一 |
| **托管挂机** | 支持 7x24 常驻,但 ⚠️ **关机不停止计费**,每 4 小时为一个计费单位,挂机不能靠关机省钱 |
| **价格(中国内地)** | 轻量型 ¥65/月(2C4G) ~ 性能型 ¥239/月(8C16G);按量 ¥0.30~1.00/小时;无抢占式 |
| **备选** | 华为云 CPH(公网 ADB 需 SSH 隧道,较重)、腾讯云 CVP(有 Web SDK,但批量/保活接口未验证) |
| **最大风险** | 个人开发者开放门槛 / 配额 / 自动化合规未取得一手证据;Web SDK 在 Electron 的兼容性需实测 |

---

## 调研过程

### 方法:deep-research 工作流

调研使用 deep-research 多智能体工作流,流程为:**分解 → 并行检索 → 抓取去重 → 对抗式核验 → 综合**。

将原始问题分解为 **5 个搜索角度**并行检索:

1. 阿里云产品识别与状态
2. ADB 远程连接与 OpenAPI/SDK 自动化
3. WebRTC 推流与 Web/JS SDK 嵌入
4. 计费规格与挂机保活
5. 多厂商横向对比与个人开发者合规

### 检索与抓取统计

| 指标 | 数值 |
|------|------|
| 搜索角度 | 5 |
| 抓取来源 | 20 个(URL 去重 7 个) |
| 提取论断 | 90 条 |
| 核验论断 | 25 条(top 25) |
| 通过核验(3 票一致) | **23 条** |
| 被推翻(2/3 票否定) | **2 条** |
| 综合后保留 | 10 条高置信结论 |
| 智能体调用 | 102 |

### 对抗式核验

每条关键论断由 **3 个独立智能体**分别从不同来源验证,需 **2/3 否定才推翻**。核验样例:

- ✅ 「无影云手机产品名/eds-aic/GA 状态」→ 3-0 一致
- ✅ 「原生 ADB 远程连接 + StartInstanceAdb 批量开启」→ 3-0
- ✅ 「Web SDK iframe inline + lync_adb_shell 通道」→ 3-0
- ✅ 「按量付费关机不停止计费、每 4 小时一单位」→ 3-0
- ❌ 「新购实例默认无法联网、需手动配 NAT/EIP/SNAT」→ **1-2 被推翻**(联网配置另有说明)
- ❌ 「腾讯云批量任务接口 tcr_instance_request / AddKeepAliveList 保活」→ **1-2 被推翻**(程序化保活能力存疑)

被推翻的论断已从结论中剔除,并记入下方「被推翻/存疑项」一节,避免后续再次采信。

---

## 一、产品识别:阿里云「无影云手机」

| 项 | 内容 |
|---|---|
| 官方名称 | **无影云手机** (Wuying Cloud Phone) |
| OpenAPI 产品代码 | **eds-aic** |
| 文档 URL 路径段 | `/zh/ecp/`(注意:`ecp` 是文档/品牌标识,API 代码是 eds-aic,勿混淆) |
| API 版本 | 2023-09-30 |
| 签名风格 | RPC,与 ECS 同一套阿里云 SDK 体系 |
| 状态 | **正式商用 (GA)**。SLA 2024-08-28 生效,2026 年仍持续上新(JVS Mobile 2026-05、Android 镜像 V26.01.1 2026-02) |
| 形态 | 「实例版」(GA)+「矩阵版」(邀测,需提工单) |
| 控制台 | aliyun.com「无影云手机管理控制台」 |
| 实例 ID 前缀 | `acp-`(旧版「弹性云手机」前缀为 `cp-`,别选错) |

**入口:**
- 产品简介:https://help.aliyun.com/zh/ecp/new-edition/
- API 概览:https://www.alibabacloud.com/help/zh/ecp/api-eds-aic-2023-09-30-overview
- OpenAPI 门户:https://api.aliyun.com/product/eds-aic

## 二、三种接入能力(选型核心,全部通过核验)

### a. 程序化自动化控制 ✅ 与现有 ADB+Scrcpy 平滑对接

**ADB 远程连接** —— 原生支持 `adb connect`,三种方式:

| 方式 | 命令 | 前提 |
|------|------|------|
| 控制台一键 ADB(推荐) | 控制台点击 | 需 VPC 网络环境 |
| 私网 ADB | `adb connect <内网IP>:5555` | 本机在 VPC 内 |
| 公网 ADB | `adb connect <公网IP>:<DNAT端口>` | 需 DNAT 端口映射 + 安全组放行 5555 |

鉴权用 **ADB 密钥对**(`CreateKeyPair` / `ImportKeyPair` / `AttachKeyPair` + `SetAdbSecure` 鉴权开关)。私钥 adbkey 放到 `~/.android`(macOS)后 `adb kill-server && adb start-server` 重启即可。`SetAdbSecure` 关闭时不校验密钥合法性,"只要网络通就能连上"。

`StartInstanceAdb` API **可批量(1~100 个)程序化开启**实例 ADB 连接功能。

→ **意义**:DeepInk 现有 ADB 客户端代码几乎原样复用 —— ADB 协议没变,只把连接端点从本地 USB/模拟器换成 `adb connect <IP>:5555`。

**OpenAPI 完整生命周期**(与 ECS 同一套签名体系,有官方 Node.js SDK):

| 能力 | API |
|------|------|
| 创建实例组(按量 / 包年包月) | `CreateAndroidInstanceGroup` |
| 启动 / 关机 / 重启 / 重置 | `StartAndroidInstance` / `StopAndroidInstance` / `RebootAndroidInstancesInGroup` / `ResetAndroidInstancesInGroup` |
| 计费类型转换(仅按量→包年包月) | `ModifyInstanceChargeType` |
| **执行任意 shell** | `RunCommand`(+ `DescribeInvocations` 查结果) |
| 安装 / 卸载 / 启动 App | `InstallApp` / `UninstallApp` / `OperateApp` |
| 截图 | `CreateScreenshot` |
| 文件上传 / 下载(经 OSS 中转) | `SendFile` / `FetchFile` |
| 销毁实例组 | `DeleteAndroidInstanceGroup` |

### b. 推流手动操作 ✅ 官方 Web SDK 可 iframe 内嵌

官方 **`Wuying.WebSDK`** 支持 `openType=inline` + 传 `iframeId` 的方式**内嵌进 iframe 页面**,可直接塞进 Electron 的 BrowserView/iframe。

| 项 | 说明 |
|------|------|
| 推流协议 | 阿里云自研 **ASP**(云手机只支持 ASP) |
| 解码模式 | `ConnDecodeType` 0 软解 / 1 硬解 / **2 WebRTC**(推流通道可选 WebRTC) |
| 内嵌方式 | `openType=inline` + `iframeId`,推流画面进 iframe |
| 会话内控制 | 内置 `lync_adb_shell` 通道,`session.sendLyncMessage('lync_adb_shell', ...)` 直接发 ADB/shell(按键、`screencap` 截图、`setprop` 等) |

**杀手锏**:Web SDK 的 `lync_adb_shell` 通道让**推流与控制合一** —— 不必再为推流画面单独维护一条 ADB 连接。

> ⚠️ 「可嵌入 Electron」是基于标准 Web 技术的工程外推 —— Web SDK 文档面向浏览器,未直接声明支持 Electron/BrowserView。落地需实测 ASP/WebRTC 在 Electron Chromium 下的兼容性。

### c. 应用托管 / 挂机 ⚠️ 能跑 7x24,但计费有坑

实例支持 7x24 常驻运行,「实例组」形态适合托管(批量管理、统一镜像)。但计费模型是关键限制(见第四节),**挂机保活不能靠关机省钱**。

## 三、规格与价格(中国内地)

| 规格 | vCPU / 内存 / 存储 | 包月 | 按量 |
|------|---------------------|------|------|
| 轻量型 `acp.basic.small` | 2C / 4GiB / 32GiB | **¥65/月** | ¥0.30/小时 |
| (通用 / 标准 / 增强型) | — | — | — |
| 性能型 `acp.perf.large` | 8C / 16GiB / 32GiB | **¥239/月** | ¥1.00/小时 |

- 计费模式仅 **包年包月(预付费)** + **按量付费(后付费)**,**无抢占式实例**;
- 支持「按量转包年包月」,反向不支持。

> 注:本表为抓取时点(计费页 2025-09-18 更新)的价格。完整规格档位(通用型/标准型/增强型、Root 可选性、独享 vs 共享、地域分布全量列表)在本次调研中**未取得一手证据**,落地前需到控制台核对。

## 四、⚠️ 计费陷阱(必须知道)

来自[计费文档](https://www.alibabacloud.com/help/zh/ecp/billing-of-cloud-phone)原文:

- 按量模式下,**从实例创建成功到销毁期间持续计费**;
- **关机不会停止计费,只有释放(销毁)实例才停**;
- **实例运行状态不影响计费**;
- **每 4 小时为一个计费单位时长**(释放时所在的最后一个 4 小时时段结束才停止计费)。

这与 ECS / 无影云电脑(支持「停机不计费」)**不同** —— 云手机无此特性。

**结论:挂机保活不能靠关机省钱。**
- 长期常驻挂机 → 用**包年包月**;
- 临时/按需任务 → **用完即释放实例组**,精控生命周期。

## 五、横向对比

| 维度 | 阿里云 无影云手机 | 华为云 CPH | 腾讯云 CVP | 百度云 |
|------|-------------------|------------|------------|--------|
| ADB 接入 | ✅ DNAT+安全组 / 一键 ADB / 私网 | ⚠️ 公网需 **SSH 隧道**保活,较重 | 有 Web SDK | 缺一手证据 |
| OpenAPI / SDK | ✅ eds-aic,与 ECS 同体系,Node SDK | 有 | 有 | 未验证 |
| 推流 Web SDK | ✅ Wuying.WebSDK(iframe + lync_adb_shell) | — | ✅ [Web SDK](https://cloud.tencent.com/document/product/1801/122860) | 未验证 |
| 批量任务 / 保活 API | ✅ RunCommand + 实例组常驻 | 未验证 | ❌ **未核验**(被推翻,存疑) | 未验证 |
| DeepInk 集成成本 | **低** | 中(SSH 隧道) | 中 | 未知 |

**华为云 CPH**([用户手册](https://support.huaweicloud.com/usermanual-cph/cph_ug_0010.html)):公网 ADB 因弹性公网 IP 绑在服务器而非单个手机实例,必须先 `ssh -L <本地端口>:<内网IP>:5555 <projectID>@<公网IP>` 建隧道,再 `adb connect 127.0.0.1:<本地端口>`。DeepInk 主进程需额外维护 SSH 隧道保活,集成成本明显高于阿里云。

**腾讯云 CVP**:有完整 Web SDK(`CreateAndroidInstancesAccessToken` 换 Token → `TcrSdk` 初始化 → `requestStream` 建立串流),可作备选;但其**批量任务/保活接口(`tcr_instance_request`、`AddKeepAliveList` 等)在本次核验中被推翻(1-2)**,程序化保活能力存疑,对比时谨慎。

**百度云**:本次未取得一手商用证据。

## 六、DeepInk 集成最短路径

主进程侧,在现有 `src/main/android/`(本地)旁新建一个云端手机后端模块,抽象出统一的 `AndroidBackend` 接口,本地 / 远程两实现:

```
src/main/android/
├── android-backend.ts        # 抽象接口(本地/远程共用)
├── local/                    # 现有 ADB + Scrcpy 本地方案
└── cloud/                    # 新增:云端手机后端
    └── aliyun-wuying/        # 阿里云无影云手机实现
```

接入三步:

1. **ADB 复用**:`StartInstanceAdb` 开启 + DNAT/安全组(或一键 ADB)拿到端点 → `adb connect`。现有 ADB+Scrcpy 自动化代码**协议级复用**,只换连接端点。
2. **推流嵌入**:用 `Wuying.WebSDK` 的 `iframe inline` 模式嵌进 Electron BrowserView/iframe;需程序化控制时走会话内 `lync_adb_shell`,推流 + 控制合一。
3. **生命周期**:用 eds-aic OpenAPI(RPC 签名),装 `@alicloud/eds-aic20230930` Node SDK,与现有阿里云 SDK 体验一致。实例用完即 `DeleteAndroidInstanceGroup` 释放,避免按量持续计费。

**选阿里云的核心理由**:
- ADB 原生支持 → 与现有 ADB+Scrcpy 栈天然兼容,迁移成本最低;
- 完整生命周期 OpenAPI + 官方 Web SDK(含会话内 ADB 通道)→ 三种接入能力齐全;
- 与现有阿里云 SDK/RAM/签名体系一致 → 学习与运维成本低。

## 七、待验证 / 风险点(落地前需确认)

本次调研**未取得一手证据**的维度,PoC 阶段需重点确认:

1. **个人开发者开放门槛 / 实名认证 / 配额上限** —— 阿里云对个人是否开放、自动化脚本合规边界、反检测策略、网络出口、是否需备案,需查官方「使用限制」「实名认证」文档或提工单。
2. **Web SDK 在 Electron 的实测** —— ASP/WebRTC 在 Electron Chromium 下的画质、延迟、稳定性。
3. **完整规格档位** —— 通用/标准/增强型价格、Root 可选性、独享 vs 共享实例、地域分布全量。
4. **腾讯云 / 华为云的程序化保活能力** —— 本次未能交叉验证,若需多供应商兜底需补查对应 OpenAPI 产品代码与价格表。
5. **百度云** —— 是否有正式商用云手机产品、OpenAPI/Web SDK/ADB/价格。

## 被推翻 / 存疑项(避免再次采信)

| 论断 | 核验结果 | 说明 |
|------|----------|------|
| 新购实例默认无法联网、需手动配 NAT/EIP/SNAT | ❌ 1-2 推翻 | 联网配置另有说明,以[云手机访问互联网](https://help.aliyun.com/zh/ecp/how-cloud-phones-access-the-internet)官方文档为准 |
| 腾讯云批量任务接口 `tcr_instance_request` / `AddKeepAliveList` 保活 | ❌ 1-2 推翻 | 程序化保活能力存疑,横向对比时对腾讯云该项保持谨慎 |

---

## 历史决策与后续

以下是 2026-06 调研阶段的历史决策，已被 2026-07-14 的产品决策废弃。当前 CCLink Studio 不推进云手机。

### 原已决策（已废弃）

1. ~~**主流云端方案选阿里云无影云手机(eds-aic)** —— 三接入能力齐全且与现有 ADB+Scrcpy 栈协议级兼容。~~
2. ~~**本地方案保留** —— 本地 ADB+Scrcpy 作为离线 / 调试兜底,云端为默认主流。~~
3. ~~**架构上抽象 `AndroidBackend` 接口** —— 本地 / 远程可切换,与现有 `agent-backend`(Claude Code / HTTP API)的可插拔模式一致。~~
4. ~~**计费策略:默认包月/年常驻** —— 控制台实测(2026-06)按量需「用完即释放」才省钱,操作链路不便且关机不停费(每 4 小时一单位);DeepInk 作为工作台,云手机应默认包月/年常驻。~~
5. ~~**控制台实测发现(2026-06)**:创建页规格名为「轻量型2c4g / 平衡型3c6g / 通用型4c4g / 标准型4c8g / 性能型8c16g」,其中标准型 4c8g 即购买页「实例版(4核8G) ¥140/月」。~~

### 原待实施（已废弃）

- [ ] PoC:开通无影云手机实例,实测 ADB 公网连接 + Web SDK 在 Electron 的兼容性 / 延迟
- [ ] 确认个人开发者开放门槛、配额、自动化合规(提工单)
- [ ] 主进程:`src/main/android/cloud/aliyun-wuying/` 后端实现(OpenAPI + ADB connect)
- [ ] 主进程:实例生命周期管理(创建/释放,避免按量持续计费)
- [ ] 渲染进程:Web SDK iframe 内嵌组件(参考 browser workbench 嵌入方式)
- [ ] Agent:云端 Android 工具模块(与现有 browser MCP 工具并列)
- [ ] 设置页:云端手机凭据(AccessKey 加密存储,参考现有 token 加密方案)

---

## 来源

**阿里云(主)**
- [无影云手机 产品简介](https://help.aliyun.com/zh/ecp/new-edition/)
- [eds-aic API 概览(2023-09-30)](https://www.alibabacloud.com/help/zh/ecp/api-eds-aic-2023-09-30-overview)
- [OpenAPI 门户 eds-aic](https://api.aliyun.com/product/eds-aic)
- [ADB 连接云手机指南](https://help.aliyun.com/zh/ecp/how-to-connect-cloud-phone-via-adb)
- [StartInstanceAdb](https://help.aliyun.com/zh/ecp/api-eds-aic-2023-09-30-startinstanceadb)
- [Web SDK](https://help.aliyun.com/zh/ecp/web-sdk-of-cloudphone)
- [计费说明](https://www.alibabacloud.com/help/zh/ecp/billing-of-cloud-phone)
- [云手机访问互联网](https://help.aliyun.com/zh/ecp/how-cloud-phones-access-the-internet)

**华为云 / 腾讯云(对比)**
- [华为云 CPH 用户手册](https://support.huaweicloud.com/usermanual-cph/cph_ug_0010.html)
- [腾讯云云手机 Web SDK](https://cloud.tencent.com/document/product/1801/122860)

**相关文档**
- [android-mirror.md](./android-mirror.md) — 本地 Android 实例方案(ADB + Scrcpy),云端方案的对照与兜底
- [browser-automation.md](./browser-automation.md) — 内嵌浏览器参考架构(workbench 嵌入方式)
