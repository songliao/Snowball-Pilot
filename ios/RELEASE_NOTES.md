# OTC Pilot — Release Notes

本文件记录 iOS 端（OTC Pilot）面向测试用户的发布内容与 App Store Connect 侧状态。
产品能力描述以 [README.md](README.md) 为准；构建状态以 App Store Connect 为准，本文件只是快照，见下方「快照时间」。

---

## 快照时间

2026-10-23（配置 Xcode Cloud 自动发布后采集）。以下「构建状态」表在此时刻从 App Store Connect 实读，之后会过期。

---

## 版本与构建

App：OTC Pilot ｜ Apple ID `6823939773` ｜ Bundle ID `com.snowball.pilot.ios` ｜ 版本号（Marketing）1.0.0

| Build | 上传时间 | 状态 | 分组 | 备注 |
|---|---|---|---|---|
| **6** | 2026-10-21 20:12 | **Testing** | Internal OTC + **External OTC** | 当前公测用的构建，约 2027-01 过期（上传后 90 天）；24 邀请 / 13 安装 |
| 5 | 2026-10-18 00:08 | Expired | 无 | 首个公测版，已被 Build 6 取代 |
| 4 | 2026-10-17 22:13 | Expired | 无 | 曾送审，后退审并过期 |
| 3 | — | Expired | 无 | 带「Internal」标记，从未进外部组 |
| 2 | — | Expired | 无 | 同上 |
| 1 | — | Expired | 无 | 同上 |

> Build 1/2/3 用 Xcode 的「TestFlight Internal Only」目的地上传，这类 build 在 ASC 里永久无法加入外部测试组，只能重新 Archive 并选「App Store Connect → Upload」重传。Build 4 之后改用了正确目的地。
> Build 6 由本机 Xcode 手动 Archive 上传；同日晚些用 Xcode Cloud「Internal TestFlight Build」工作流手动跑 Build 6 时，因与已上传的 Build 6 撞号而失败（详见下「自动发布」一节）。

---

## 自动发布（Xcode Cloud，2026-10-23 起）

参照 OTC-X 的做法，本 App 已把「每次推送到 GitHub `main` 分支 → 自动出内测构建」接到 Xcode Cloud，不再依赖本机 Xcode 手动 Archive 上传。

- **触发**：向 `main` 推送任意提交，Xcode Cloud 的 **Internal TestFlight Build** 工作流自动开始（同一分支若有更新的推送，自动取消尚在排队/运行的旧构建）。
- **动作**：Archive - iOS，Distribution Preparation 选 **App Store Connect**（这样产物可直接上传，不带「Internal Only」死标记）。
- **投递**：Archive 完成后由 **TestFlight Internal Testing** 后置动作自动部署到 **Internal OTC 组（11 人）**。
- **另一条 Default 工作流**：已去掉推送触发，只保留「手动启动」，仅编译校验、不投递，避免每次推送重复出两个构建。
- **构建号**：由 Xcode Cloud 自己的计数器分配（每次构建 +1），会**覆盖**工程里的 `CURRENT_PROJECT_VERSION`。当前 **Next Build Number = 7**，因为 Build 6 已被本机手动上传占用；下次自动构建即 `1.0.0(7)`。撞号时报错「The bundle version must be higher than the previously uploaded version」，去 ASC → App → Xcode Cloud → Settings → Build Number 把下一个号抬到高于现有最大构建即可。

> 注意：这条链只自动发到**内部** OTC 组（内测）。要进**外部** OTC 组（公测）仍需一次 Beta App Review，不会随每次推送自动过审——这是刻意为之，避免每次 push 都触发外部审核。
> 建议今后不要再从本机 Xcode 手动 Archive 上传，否则手动构建号会和 Xcode Cloud 计数器撞号。

---

## 如何加入公测

**公开链接：** https://testflight.apple.com/join/EgUZprFc

- 外部测试组：External OTC（提交时 0 名测试员）
- 通知方式：已勾选「Automatically notify testers」，审核通过后 Apple 会自动给已加邮箱的测试员发邀请
- 最低系统：**iOS 17.0**；iPhone / iPad 通用
- 无需登录、无需注册账号，装上直接用
- 数据只存在本机（SQLite，`Application Support/SnowballPilot/`），**没有云同步**；卸载 App 即清空数据，建议测试前先导出 CSV

---

## 本版功能（Build 6，当前公测版）

面向场外雪球／凤凰合约的持仓管理工具。

- **持仓管理** — 新增/编辑持仓；支持粘贴一段合约文本让 App 自动解析要素
- **看板** — 敲出收益、浮动与已实现盈亏、预警阈值等计算；与桌面端算法列对齐
- **行情** — 直连腾讯财经（实时 `qt.gtimg.cn`、前复权 K 线 `web.ifzq.gtimg.cn`），全 HTTPS，无 ATS 例外
- **日历** — 敲出观察日（绿）与派息观察日（蓝）标注
- **合约管理** — 标的与合约列表维护
- **预警通知** — 前台每 5 分钟检查一次，按「当天 + 合约 + 预警理由」去重；通知权限在第一次真实预警时才请求
- **CSV 导入导出** — 与桌面端字节兼容（RFC4180）
- **零第三方依赖** — 系统 SQLite3、Swift Charts、URLSession

---

## Build 5 → Build 6 改动

以下条目来自 git 历史（`ios/` 已入库，不再用时间戳倒推），为 Build 5 上传（2026-10-18 00:08）之后、Build 6 上传（2026-10-21 20:12）之前落在 `main` 上的提交：

| 提交 | 主题 |
|---|---|
| `4daeb92` | fix: 日历首次进入卡顿、预警设置步进数字不刷新 |
| `b6839d9` | feat: 持仓列表展示敲出/派息倒计时，右上角增加排序 |
| `17f7e0d` | feat: 持仓列表默认按起息时间由近到远排序 |
| `ab54eaf` | fix: 合约检查行内的备注按钮点不到（被 NavigationLink 吞掉整行点击） |
| `4548e3e` | feat: 持仓卡片的敲出/派息改为展示到障碍价的价格距离 |
| `6523ff9` | ui: 合约检查按钮图标调整，「加备注」改为「添加备注」 |
| `1ba9ceb` | fix: 合约检查操作按钮改显式配色，图标不再与底色同色 |
| `1747ba5` | chore: iOS build 号提升到 6、采纳 Xcode 27.1 推荐设置（非功能改动） |

主线是**持仓列表/卡片的敲出·派息信息呈现**与**合约检查页的按钮可见性/可点击性**，外加日历首次进入卡顿修复。

---

## Build 4 → Build 5 改动

⚠️ **本节内容不是从版本历史得出的。** 整理这份说明时 `ios/` 目录还没有被 git 跟踪，无法 diff，下面的条目是用「文件修改时间晚于 Build 4 上传时刻（2026-10-17 22:13）」倒推出来的候选改动集，**可能混入了 Build 4 之前就已存在、只是后来被顺手碰过的代码**。自本次 ios/ 入库之后，后续版本请改用 git 历史，不再用时间戳倒推。

改动集中在**主线程卡顿/卡死**这一条线上：

| 文件 | 改动时间 | 主题 |
|---|---|---|
| `App/AppServices.swift` | 22:49 | 数据库打开加「单飞门」，防止重入并发删建行情库、与主线程抢 SQLite 连接；`loadStoredPrices` 聚合移出主线程；行情写入全部走 `Task.detached` |
| `Components/UIAdditions.swift` | 23:09 | **关闭 Liquid Glass**（iOS 26 的 `glassEffect` 在返回转场重排时触发 UIKit 平台色解析主线程死循环），回退为系统灰卡片 |
| `Features/Instruments/InstrumentManagementView.swift` | 23:09 | 未见卡顿/通知/解析相关的新主题 |
| `Features/Positions/PositionDetailView.swift` | 23:55 | 事件日志缓存，避免每次 body 渲染都在主线程查 SQLite |
| `Services/AlertNotificationScheduler.swift` | 23:55 | 预警去重与投递逻辑 |
| `App/SnowballPilotApp.swift` | 23:41 | 启动时安装调试用看门狗（仅 DEBUG） |
| `Features/Dashboard/DashboardView.swift` | 00:00 | `LazyVGrid` → 非懒加载 `Grid`：真机 iOS 27 上返回转场时布局退化到数秒级 |
| `Utils/MainThreadHangWatchdog.swift` | 23:49 | **纯 `#if DEBUG` 开发工具**，不在发布构建里 |
| `Info.plist` | — | 显示名 OTC Pilot、去掉 `NSAllowsArbitraryLoads`、`ITSAppUsesNonExemptEncryption=false` |

**不要写进给测试员的文案：** 主线程卡死看门狗（`MainThreadHangWatchdog`）。它是 DEBUG-only 的诊断工具，会 `thread_suspend` 主线程并把堆栈追加写到 `Documents/hang_log.txt`，Release/TestFlight 归档里根本不存在，代码注释也标了「排完就删」。

---

## 已知限制

- 无多设备同步
- 每日收盘数据采用「启动时补足 + 手动刷新」，不做后台抓取（BGTask 明确标注为未实现的后续项）
- 主题设置与预警阈值设置不与桌面端互通
- 卸载即丢数据

---

## 反馈渠道

- App 内反馈入口
- 邮箱：liaosong@yahoo.com

---

## 附录：App Store Connect 操作规则（排障用）

这些是踩出来的硬约束，下次发布直接照做：

1. **上传目的地必须是「App Store Connect → Upload」。** 选「TestFlight Internal Only」上传的 build 会带「Internal」标记，永久无法加入外部组，也不能事后转换，只能改 `CFBundleVersion` 重新 Archive 重传。
2. **同一版本号同时只能有 1 个 build 在 Beta App Review。** 要把更新的 build 送进外部组，顺序是：先在旧 build 详情页点 **「Remove from Review」**（可逆，只撤审核请求，不动它已挂的组）→ 确认新 build 详情页那句「You can only submit one build from version …」提示消失 → 再送新 build → 最后才 Expire 旧 build。**别反着做。**
3. **外部组没有「只挂载不送审」的路径。** Add Group 向导的最后一步按钮就叫「Submit for Review」，点它等于提交审核。App 级 Test Information 补齐后，向导只剩「选组 → What to Test + 是否自动通知 + 提交」两步，不再问登录方式。
4. **「Expire Build」不可撤销**，且会把该 build 从它挂着的**所有**分组（含外部组）摘除。
5. **公开链接可以先开后生效。** 链接启用但组里还没有已批准的 build 时，测试员点进去拿不到东西，提示是「Testers cannot join public link until this group has an approved build.」这属正常，不用改。
6. **「What to Test」字数计数器显示的是剩余字符数**（上限 4,000），不是已用。
7. **90 天后 build 自动过期**，届时需重传。

### 可用的 ASC 路由

- `/testflight/ios` — 构建列表
- `/testflight/ios/<build-uuid>` — 构建详情
- `/testflight/groups/<uuid>/{testers,builds,settings}` — 分组页，tab 走路径；用 `?tab=` 会把页面搞坏

---

## 待办（与发布相关，尚未处理）

- iOS `MARKETING_VERSION` 仍是 1.0.0，桌面端已到 1.0.21；正式发布前建议对齐。
- App Store 版本 1.0「Prepare for Submission」的 Description / Keywords 仍为空，且「Sign-In required」仍勾选着 —— 提 App Store 审核前必须改。
- 隐私政策：https://otc-pilot-privacy-n53w1myck7x.qoder.zone/
