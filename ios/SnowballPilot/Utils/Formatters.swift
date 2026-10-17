import SwiftUI

/// 展示格式化——与桌面端 src/utils/format.ts 对齐。
enum Format {
    /// 金额（万元）：绝对值 ≥1万 显示「x.xx 万」。
    static func money(_ value: Double) -> String {
        if abs(value) >= 10000 {
            return String(format: "%.2f 万", value / 10000)
        }
        return String(format: "%.2f", value)
    }

    /// 金额完整显示（zh-CN 千分位 + 2 位小数）。
    static func moneyFull(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }

    /// 百分比：输入小数（0.75 → 75.00%）。
    static func percent(_ value: Double, digits: Int = 2) -> String {
        String(format: "%.\(digits)f%%", value * 100)
    }

    /// 直接以百分数表示的值（75 → "75.00%"）。
    static func percentRaw(_ value: Double, digits: Int = 2) -> String {
        String(format: "%.\(digits)f%%", value)
    }

    /// 带正负号的百分比（0.0325 → "+3.25%"，负值自带 - 号）。
    static func signedPercent(_ value: Double, digits: Int = 2) -> String {
        (value > 0 ? "+" : "") + percent(value, digits: digits)
    }

    /// 盈亏文案（带正负号）。
    static func pnlText(_ value: Double) -> String {
        (value > 0 ? "+" : "") + moneyFull(value)
    }

    static func pnlColor(_ value: Double) -> Color {
        value > 0 ? .green : (value < 0 ? .red : .secondary)
    }

    static func date(_ text: String) -> String {
        guard let parsed = AppDate.parse(text) else { return text }
        return AppDate.format(parsed)
    }

    /// 观察方式映射。
    static func knockInObservationLabel(_ value: String) -> String {
        switch value {
        case "daily": "每日观察"
        case "maturity": "到期观察"
        default: value
        }
    }

    static func accrualBasisLabel(_ value: String) -> String {
        switch value {
        case "both": "双含"
        case "one": "单含"
        default: value
        }
    }

    static func structureLabel(_ value: String) -> String {
        StructureType(rawValue: value)?.label ?? value
    }
}
