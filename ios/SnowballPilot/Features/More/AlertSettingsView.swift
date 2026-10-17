import SwiftUI

/// 预警阈值设置：四参数 + 实时预览触发合约（与桌面端 AlertSettings 一致）。
struct AlertSettingsView: View {
    @Environment(AppServices.self) private var services

    var body: some View {
        @Bindable var services = services
        List {
            Section {
                Stepper(value: $services.alertConfig.knockOutLeadDays, in: 1...60) {
                    LabeledContent("敲出提前观察天数", value: "\(services.alertConfig.knockOutLeadDays) 天")
                }
                PercentStepper(label: "敲出临近阈值", value: $services.alertConfig.knockOutNearPct, range: 1...50)
                PercentStepper(label: "派息临近阈值", value: $services.alertConfig.couponNearPct, range: 1...50)
                PercentStepper(label: "敲入临近阈值", value: $services.alertConfig.knockInNearPct, range: 1...50)
            } footer: {
                Text("基于障碍价与最新价的距离百分比筛选：敲出/派息取「障碍价/现价 − 1 ≤ 阈值」，敲入取「差距 ≥ −阈值」（含已跌破）。")
            }

            previewSection
        }
        .navigationTitle("预警设置")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var previewSection: some View {
        let alerts = services.computeAlerts()
        return Section {
            if alerts.isEmpty {
                Text("按当前阈值暂无触发的合约")
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(alerts, id: \.viewID) { alert in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(alert.title)
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            Text(String(format: "%.2f", alert.cur))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        ForEach(Array(alert.reasons.enumerated()), id: \.offset) { _, reason in
                            Text("· \(reason.label)（\(String(format: "%.1f", reason.gap))%）")
                                .font(.caption)
                                .foregroundStyle(reason.tone == .danger ? .red : (reason.tone == .warn ? .orange : .blue))
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        } header: {
            Text("实时预览")
        }
    }
}

/// 百分比步进器（整数值百分比）。
private struct PercentStepper: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        Stepper(value: $value, in: range, step: 1) {
            LabeledContent(label, value: Format.percentRaw(value))
        }
    }
}
