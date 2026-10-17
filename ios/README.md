# OTC Pilot for iOS

场外雪球 / 凤凰合约持仓管理工具的原生 iOS 客户端（SwiftUI），与桌面端（Electron）同构。
屏幕显示名为 **OTC Pilot**（2026-10-17 由 Snowball Pilot 更名）；Bundle ID 保持 `com.snowball.pilot.ios` 不变，老用户数据不受影响。

- **免登录直启**：打开即用，首页即开机画面；数据沿用本机用户库（历史版本按登录账号分库，现沿用最近一次会话的用户名，新安装使用 `local` 库）。登录相关代码保留在 `ios/Attic/`（LoginView / AuthClient / SessionStore，在编译目标之外），恢复鉴权时移回原位即可
- **业务数据全部存本机**（SQLite，`Application Support/SnowballPilot/`），表结构与桌面端 `electron/database/schema.ts` 逐列一致；卸载即删除，可随时导出 CSV 备份
- **行情直连腾讯财经公开接口**（实时 `qt.gtimg.cn`；K 线 `web.ifzq.gtimg.cn` 前复权），全部 HTTPS，无 ATS 例外
- **CSV 与桌面端互通**：导出/导入列序、RFC4180 转义与桌面端逐字节一致，可经「文件」App / 隔空投送互导

## 环境要求

- Xcode 26+（本项目在 Xcode 27 / iOS 26.5 SDK 上开发验证）
- 最低部署目标 iOS 17.0，iPhone / iPad 通用（iPad 上标签栏可切换为侧边栏）
- 零第三方依赖：系统 SQLite3、Swift Charts、URLSession

## 构建与运行

```bash
# 命令行构建（iPhone 17 Pro 模拟器）
cd ios
xcodebuild -project SnowballPilot.xcodeproj -scheme SnowballPilot \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 运行全部单测（含与桌面端 TS 实现的对拍 fixtures）
xcodebuild -project SnowballPilot.xcodeproj -scheme SnowballPilot \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

或直接用 Xcode 打开 `ios/SnowballPilot.xcodeproj`，选一个模拟器按 ⌘R。

### 演示模式（仅 DEBUG 构建）

```bash
xcrun simctl launch booted com.snowball.pilot.ios -demoMode   # 可加 -tab 0..3 指定初始标签页
```

演示模式会打开 `demo` 本地库并注入样例持仓与行情（库非空时不重复注入），不影响 Release。

## 单元测试与对拍

`SnowballPilotTests` 使用 Swift Testing，其中核心计算（敲出收益/盈亏/预警引擎/CSV/合约文本解析/行情解析）与**仓库内真实 TS 实现**逐例对拍：

```bash
# 重新生成对拍 fixtures（需要仓库根目录的 node_modules/esbuild）
node ios/scripts/generate-fixtures.mjs
```

fixtures 中雪球合约的敲出观察日均早于生成日，因此对拍结果与运行日期无关、可长期复现。

## 真机安装与分发

1. 用 Xcode 打开工程 → 目标 `SnowballPilot` → **Signing & Capabilities** → automatically manage signing + 你的 **Team**（`DEVELOPMENT_TEAM = 369YZ6L79Z` 已配置）。
2. Bundle ID 为 `com.snowball.pilot.ios`（与桌面端 `com.snowball.pilot` 不冲突，可共存）。
3. 连接 iPhone 后选择设备按 ⌘R；首次需在手机上信任开发者证书（设置 → 通用 → VPN 与设备管理）。
4. **TestFlight / App Store**：Xcode → Product → Archive → Distribute App。上架相关已就绪：
   - App 图标三变体（标准/深色/着色）齐全，源文件 `resources/icon-web-512.png`，由 `ios/scripts/generate-icon.py` 生成；Web 端换标后重跑该脚本；
   - **无 ATS 例外**（行情全 HTTPS，2026-10-17 移除 `NSAllowsArbitraryLoads`）；
   - **隐私清单** `PrivacyInfo.xcprivacy`（UserDefaults CA92.1；不追踪、不收集数据）；
   - `ITSAppUsesNonExemptEncryption = false`（仅标准 TLS，免出口合规问询）；
   - 免登录，无需向审核提供演示账号。
5. 中国大陆区上架需 ICP 备案号；TestFlight 公测（外部测试组 + 公开链接）不需要备案。

## 目录结构

```
ios/
├── SnowballPilot.xcodeproj        # 手写工程（目录同步组，新增文件无需改工程）
├── Attic/                         # 已下线功能的代码存档（登录/鉴权/会话），不参与编译
├── SnowballPilot/
│   ├── App/                       # 入口、免登录引导、主题、全局服务容器、演示模式
│   ├── Models/                    # Position / 行情 / 事件模型（与 DB 列一一对应）
│   ├── Persistence/               # SQLite 封装（WAL+事务）、用户库、三个 Repository
│   ├── Networking/                # MarketDataClient（实时 GBK / K 线 JSON，全 HTTPS）
│   ├── Services/                  # 历史回填（后台 actor）、预警本地通知
│   ├── Utils/                     # Calc、AlertEngine、ContractParser、CSV、Formatters
│   ├── Components/                # K 线图（Swift Charts 蜡烛 + MA）
│   └── Features/                  # Dashboard / Positions / Calendar / Analysis /
│                                  # Instruments / Check / More
├── SnowballPilotTests/            # Swift Testing 单测 + 对拍 fixtures
└── scripts/generate-fixtures.mjs  # 用仓库 TS 实现生成对拍数据
```

## 与桌面端的功能对应

| 桌面端 | iOS 端 | 说明 |
|---|---|---|
| 投资总览 | 总览（开机默认页） | 四卡统计口径一致；指数行情可自动刷新 |
| 持仓管理 + CSV | 持仓 | 列表/筛选、录入编辑（含粘贴要素解析）、详情登记 |
| 事件日历 | 日历 | 月历标注敲出（绿）/派息（蓝）观察日，事件从持仓推导 |
| 持仓分析 | 更多 → 持仓分析 | 环形图（名义本金）+ 风险散点（口径一致） |
| 标的管理 | 更多 → 标的管理 | 涨跌幅、收藏、2 年回填、增量更新；存续合约挂钩的标的不可删 |
| 合约检查 | 更多 → 合约检查 | 漏记/误记敲出派息四类规则一致，备注摘要一致 |
| 预警设置 + 桌面通知 | 预警设置 + 本地通知 | 阈值语义一致；前台每 5 分钟检查，按天去重 |

### 与桌面端的已知差异

- iOS 免登录（桌面端保留 6006 鉴权）；更新走 App Store / TestFlight，无 electron-updater / 热更新
- 每日 15:05 自动收盘落库在 iOS 上以「启动时增量补足 + 手动刷新」替代（后台定时刷新 BGTask 为后续增强）
- 桌面端 localStorage 的主题/预警阈值不迁移（iOS 存 UserDefaults）

## 数据安全

- 业务数据只存本机 SQLite；卸载 App 即删除（如需备份请定期导出 CSV）
- 行情数据来自公开行情源（腾讯财经），仅用于展示与计算，不做任何上传
- 不含追踪 SDK、不做任何数据收集（隐私清单已声明）
