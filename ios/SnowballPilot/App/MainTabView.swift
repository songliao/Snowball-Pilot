import SwiftUI

/// 底部标签（iPad 上可切换为侧边栏）：总览 / 持仓 / 日历 / 更多。
/// 桌面端的 7 个页面映射到「更多」页，避免 iOS 底栏过载。
struct MainTabView: View {
    @Environment(AppServices.self) private var services

    @State private var selection = 0

    init() {
        // 调试走查：`-tab <0..3>` 指定初始标签页（仅 DEBUG）
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-tab"),
           index + 1 < arguments.count,
           let tab = Int(arguments[index + 1]), (0..<4).contains(tab) {
            _selection = State(initialValue: tab)
        }
        #endif
    }

    var body: some View {
        tabContent
            .onOpenURL { url in
                // 调试深链：snowballpilot://tab/0..3 切换标签（模拟器自动走查用）
                if url.scheme == "snowballpilot", url.host == "tab",
                   let index = Int(url.lastPathComponent), (0..<4).contains(index) {
                    selection = index
                }
            }
            .task {
                // `-screen` 为截图走查专用：跳过预警轮询，避免首次触发通知权限弹窗挡住页面
                guard !ProcessInfo.processInfo.arguments.contains("-screen") else { return }
                // 预警本地通知：前台每 5 分钟检查（对应桌面端 5 分钟定时任务）。
                // 通知权限在首次真正触发预警时才请求，避免启动即弹窗。
                while !Task.isCancelled {
                    await services.refreshAlertPrices()
                    AlertNotificationScheduler.shared.notifyIfNeeded(services.computeAlerts())
                    try? await Task.sleep(for: .seconds(300))
                }
            }
    }

    @ViewBuilder
    private var tabContent: some View {
        if #available(iOS 18.0, *) {
            tabs.tabViewStyle(.sidebarAdaptable)
        } else {
            tabs
        }
    }

    private var tabs: some View {
        TabView(selection: $selection) {
            DashboardView()
                .tabItem { Label("总览", systemImage: "chart.pie.fill") }
                .tag(0)
            PositionsView()
                .tabItem { Label("持仓", systemImage: "list.bullet.rectangle.portrait") }
                .tag(1)
            EventCalendarView()
                .tabItem { Label("日历", systemImage: "calendar") }
                .tag(2)
            MoreView()
                .tabItem { Label("更多", systemImage: "ellipsis.circle") }
                .tag(3)
        }
    }
}
