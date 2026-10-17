import SwiftUI

/// 主题模式：跟随系统 / 浅色 / 深色（与桌面端设置弹层一致）。
enum ThemeMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var icon: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }
}

@Observable
final class ThemeSettings {
    private static let storageKey = "theme-mode"

    private let defaults: UserDefaults
    var mode: ThemeMode {
        didSet { defaults.set(mode.rawValue, forKey: Self.storageKey) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.mode = ThemeMode(rawValue: defaults.string(forKey: Self.storageKey) ?? "") ?? .system
    }

    var colorScheme: ColorScheme? {
        switch mode {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
