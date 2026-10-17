import Foundation
import UserNotifications

/// 预警本地通知：前台每 5 分钟检查一次，触发新的预警时发系统通知（去重按天）。
/// 对应桌面端的 notification:check 定时任务；后台刷新（BGTask）作为后续增强。
final class AlertNotificationScheduler {
    static let shared = AlertNotificationScheduler()

    private static let dedupeKey = "alert-notified-keys"
    private var notifiedKeys: Set<String> = []

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.dedupeKey),
           let keys = try? JSONDecoder().decode(Set<String>.self, from: data) {
            notifiedKeys = keys
        }
    }

    /// 首次触发预警时请求通知权限（避免启动即弹窗）。
    func requestPermission() {
        #if DEBUG
        // 自动走查时抑制权限弹窗，排除弹窗与导航过渡的干扰因素
        if ProcessInfo.processInfo.arguments.contains("-autoplay-nav") { return }
        #endif
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// 对新触发的预警发通知（同一合约同一预警每天只发一次）。
    func notifyIfNeeded(_ alerts: [AlertEngine.Item]) {
        guard !alerts.isEmpty else { return }
        let today = AppDate.todayUTCString()
        var fired: [UNMutableNotificationContent] = []
        for alert in alerts {
            for reason in alert.reasons {
                let key = "\(today)|\(alert.id)|\(reason.label)"
                guard !notifiedKeys.contains(key) else { continue }
                notifiedKeys.insert(key)
                let content = UNMutableNotificationContent()
                content.title = alert.title
                content.body = "\(reason.label)（现价 \(String(format: "%.2f", alert.cur))）"
                if let date = reason.date, !date.isEmpty {
                    content.body += " · \(date)"
                }
                content.sound = .default
                fired.append(content)
            }
        }
        persistDedupe()
        guard !fired.isEmpty else { return }
        requestPermission()
        for content in fired.prefix(10) {
            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: content,
                trigger: nil // 立即送达
            )
            UNUserNotificationCenter.current().add(request)
        }
    }

    /// 每天清理一次去重集合（保留当天）。
    private func persistDedupe() {
        let today = AppDate.todayUTCString()
        let kept = notifiedKeys.filter { $0.hasPrefix("\(today)|") }
        if kept.count != notifiedKeys.count {
            notifiedKeys = kept
        }
        if let data = try? JSONEncoder().encode(notifiedKeys) {
            UserDefaults.standard.set(data, forKey: Self.dedupeKey)
        }
    }
}
