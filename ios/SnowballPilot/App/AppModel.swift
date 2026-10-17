import SwiftUI
import Observation

/// 全局应用模型：主题 + 业务服务容器。
/// 免登录直启（2026-10-17 起）：首页即开机画面；沿用历史会话的用户库保证数据连续，
/// 无历史会话则使用 local 库。（登录相关代码已移至 ios/Attic/，需要时再恢复。）
@Observable
final class AppModel {
    let theme = ThemeSettings()
    let services = AppServices()

    private(set) var ready = false
    private(set) var loadError: String?

    func bootstrap() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-demoMode") {
            openDatabase(username: "demo", seedDemo: true)
            return
        }
        #endif
        // 历史版本按登录账号分库；沿用最近一次会话的用户名，老数据无缝延续
        let username = UserDefaults.standard.string(forKey: "session-username") ?? "local"
        openDatabase(username: username)
    }

    private func openDatabase(username: String, seedDemo: Bool = false) {
        do {
            try services.openDatabase(username: username)
            #if DEBUG
            if seedDemo {
                DemoSeeder.seedIfNeeded(services)
            }
            #endif
            ready = true
        } catch {
            loadError = error.localizedDescription
        }
    }
}
