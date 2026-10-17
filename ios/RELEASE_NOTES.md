# OTC Pilot — Release Notes

本文件记录 iOS 端（OTC Pilot）面向测试用户的发布内容与 App Store Connect 侧状态。
产品能力描述以 [README.md](README.md) 为准；构建状态以 App Store Connect 为准，本文件只是快照，见下方「快照时间」。

---

## 快照时间

2026-10-18（Build 5 送审完成后采集）。以下「构建状态」表在此时刻从 App Store Connect 实读，之后会过期。

---

## 版本与构建

App：OTC Pilot ｜ Apple ID `6823939773` ｜ Bundle ID `com.snowball.pilot.ios` ｜ 版本号（Marketing）1.0.0

| Build | 上传时间 | 状态 | 分组 | 备注 |
|---|---|---|---|---|
| **5** | 2026-10-18 00:08 | **Waiting for Review** | Internal OTC + **External OTC** | 当前公测用的构建，90 天后过期 |
| 4 | 2026-10-17 22:13 | Expired | 无 | 曾送审，后退审并过期 |
| 3 | — | Expired | 无 | 带「Internal」标记，从未进外部组 |
| 2 | — | Expired | 无 | 同上 |
| 1 | — | Expired | 无 | 同上 |

> Build 1/2/3 用 Xcode 的「TestFlight Internal Only」目的地上传，这类 build 在 ASC 里永久无法加入外部测试组，只能重新 Archive 并选「App Store Connect → Upload」重传。Build 4 之后改用了正确目的地。

---

## 如何加入公测

**公开链接：** https://testflight.apple.com/join/EgUZprFc

- 外部测试组：External OTC（提交时 0 名测试员）
- 通知方式：已勾选「Automatically notify testers」，审核通过后 Apple 会自动给已加邮箱的测试员发邀请
- 最低系统：**iOS 17.0**；iPhone / iPad 通用
- 无需登录、无需注册账号，装上直接用
- 数据只存在本机（SQLite，`Application Support/SnowballPilot/`），**没有云同步**；卸载 App 即清空数据，建议测试前先导出 CSV

---

## 本版功能（Build 5，首个公测版）

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

## Build 4 → Build 5 改动

⚠️ **本节内容不是从版本历史得出的。** `ios/` 目录在 git 里没有任何被跟踪文件（`git ls-files ios/` 返回 0），所以无法 diff。下面的条目是用「文件修改时间晚于 Build 4 上传时刻（2026-10-17 22:13）」倒推出来的候选改动集，**可能混入了 Build 4 之前就已存在、只是后来被顺手碰过的代码。发布前请人工核对。**

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
- `ios/` 整个目录没有被 git 跟踪，改动无历史可查。这是本次 changelog 只能靠时间戳倒推的根本原因。
- 隐私政策：https://otc-pilot-privacy-n53w1myck7x.qoder.zone/
