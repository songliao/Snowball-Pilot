import SwiftUI

/// 「更多」页：分析/标的/检查/预警设置入口 + 设置（主题、关于）。
struct MoreView: View {
    @Environment(ThemeSettings.self) private var theme

    @State private var showingAbout = false

    var body: some View {
        @Bindable var theme = theme
        NavigationStack {
            List {
                Section("业务工具") {
                    NavigationLink {
                        PositionAnalysisView()
                    } label: {
                        Label("持仓分析", systemImage: "chart.pie.fill")
                    }
                    NavigationLink {
                        InstrumentManagementView()
                    } label: {
                        Label("标的管理", systemImage: "chart.bar.xaxis")
                    }
                    NavigationLink {
                        ContractCheckView()
                    } label: {
                        Label("合约检查", systemImage: "checkmark.seal")
                    }
                    NavigationLink {
                        AlertSettingsView()
                    } label: {
                        Label("预警设置", systemImage: "bell.badge")
                    }
                }

                Section("设置") {
                    Picker("主题", selection: $theme.mode) {
                        ForEach(ThemeMode.allCases) { mode in
                            Label(mode.label, systemImage: mode.icon).tag(mode)
                        }
                    }
                }

                Section("关于") {
                    Button {
                        showingAbout = true
                    } label: {
                        HStack {
                            HStack(spacing: 6) {
                                Image(systemName: "info.circle.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.blue)
                                Text("关于")
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .navigationTitle("更多")
            .sheet(isPresented: $showingAbout) {
                aboutSheet
            }
        }
    }

    /// 关于页——与 OTC-X iOS 客户端完全同款，仅 Logo 与名称不同。
    private var aboutSheet: some View {
        VStack(spacing: 20) {
            Spacer()

            Image("AppLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 12, y: 6)

            VStack(spacing: 8) {
                Text("OTC Pilot")
                    .font(.system(.title, design: .rounded).weight(.bold))
                Text("场外衍生品移动持仓管理客户端")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            Text(aboutVersion)
                .font(.footnote)
                .foregroundStyle(.tertiary)

            Text("For My Perpetual & Resonant Love")
                .font(.custom("SnellRoundhand", size: 18, relativeTo: .body))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(.tertiary)
                .accessibilityLabel("For My Perpetual and Resonant Love")

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .presentationDetents([.height(320)])
        .presentationDragIndicator(.visible)
    }

    private var aboutVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "版本 \(version) (Build \(build))"
    }
}
