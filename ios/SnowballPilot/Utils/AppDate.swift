import Foundation

/// 日期工具。存储格式统一为 "YYYY-MM-DD" 字符串（与桌面端/数据库一致）。
/// 解析语义对齐 dayjs：'YYYY-MM-DD' 按本地零点；星期判断按 UTC（对齐桌面端 isTradingDay）。
/// nonisolated：DateFormatter 自 iOS 7 起线程安全，主线程与回填 actor 均可调用。
nonisolated enum AppDate {
    private static let localFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let utcFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// "YYYY-MM-DD" → 本地零点。非法输入返回 nil（对齐 dayjs isValid）。
    static func parse(_ text: String) -> Date? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == 10, trimmed.contains("-") else { return nil }
        return localFormatter.date(from: trimmed)
    }

    /// "YYYY-MM-DD" → UTC 零点（仅用于星期判断等日历属性）。
    static func parseUTC(_ text: String) -> Date? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == 10, trimmed.contains("-") else { return nil }
        return utcFormatter.date(from: trimmed)
    }

    static func format(_ date: Date) -> String {
        localFormatter.string(from: date)
    }

    /// 今天零点（本地）。
    static func startOfToday(calendar: Calendar = .current) -> Date {
        calendar.startOfDay(for: Date())
    }

    static func startOfDay(_ date: Date, calendar: Calendar = .current) -> Date {
        calendar.startOfDay(for: date)
    }

    /// dayjs diff('day') 的等价实现：向零截断。
    /// `end.diff(start, 'day')` ≙ `truncatedDayCount(from: start, to: end)`。
    static func truncatedDayCount(from start: Date, to end: Date) -> Int {
        Int(end.timeIntervalSince(start) / 86400.0)
    }

    /// 从某日期起往后数 n 个交易日（近似：跳过周末，不含起始日当天）。
    static func addTradingDays(from start: Date, n: Int, calendar: Calendar = .current) -> Date {
        var current = start
        var count = 0
        while count < n {
            guard let next = calendar.date(byAdding: .day, value: 1, to: current) else { return current }
            current = next
            let weekday = calendar.component(.weekday, from: current) // 1=周日 7=周六
            if weekday != 1 && weekday != 7 { count += 1 }
        }
        return current
    }

    /// 今日 "YYYY-MM-DD"（UTC 日期，对齐桌面端 saveDailyClose 的 toISOString 取法）。
    static func todayUTCString() -> String {
        utcFormatter.string(from: Date())
    }
}
