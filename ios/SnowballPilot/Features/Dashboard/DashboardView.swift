import SwiftUI

/// 投资总览：统计四卡 + 自选指数行情 + 预警看板（与桌面端 Dashboard 口径一致）。
struct DashboardView: View {
    @Environment(AppServices.self) private var services

    @AppStorage("dashboard-auto-refresh") private var autoRefresh = false
    @AppStorage("dashboard-interval") private var intervalSec = 30
    @State private var refreshing = false
    #if DEBUG
    @State private var navigationPushID: Position?
    #endif

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statsGrid
                    marketSection
                    alertSection
                    dataDateFooter
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("投资总览")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await refresh() }
                    } label: {
                        if refreshing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(refreshing)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle("自动刷新", isOn: $autoRefresh)
                        Picker("刷新间隔", selection: $intervalSec) {
                            Text("10 秒").tag(10)
                            Text("30 秒").tag(30)
                            Text("60 秒").tag(60)
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .refreshable { await refresh() }
            .navigationDestination(for: Position.self) { position in
                PositionDetailView(position: position)
            }
            #if DEBUG
            .navigationDestination(item: $navigationPushID) { position in
                PositionDetailView(position: position)
            }
            #endif
            .task { await refresh() }
            #if DEBUG
            .task {
                // 调试走查：-autoplay-nav 每 3s 自动推入一条合约详情（配合详情页自动 dismiss）
                guard ProcessInfo.processInfo.arguments.contains("-autoplay-nav") else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3))
                    guard !Task.isCancelled, let target = services.positions.first else { break }
                    navigationPushID = target
                }
            }
            #endif
            .task(id: autoRefresh) {
                guard autoRefresh else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(intervalSec))
                    guard !Task.isCancelled else { break }
                    await refresh()
                }
            }
        }
    }

    // MARK: - 统计四卡

    private var statsGrid: some View {
        let summary = services.summary
        // 非 lazy 的 Grid：真机 iOS 27 上返回过渡期间 LazyVGrid 的逐节点懒式布局
        // 会退化成秒级甚至分钟级的渲染磨蹭（Time Profiler/看门狗栈实锤），
        // 4 张卡用固定 Grid 既是正确语义也绕开该路径。
        return glassContainer(spacing: 10) {
            Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow {
                    StatCard(
                        title: "名义本金", icon: "yensign.circle.fill",
                        main: Format.money(summary.activeNotional),
                        sub: "全部 \(Format.money(summary.totalNotional))"
                    )
                    StatCard(
                        title: "保证金", icon: "checkmark.shield.fill",
                        main: Format.money(summary.activeMargin),
                        sub: "全部 \(Format.money(summary.totalMargin))"
                    )
                }
                GridRow {
                    StatCard(
                        title: "合约数", icon: "doc.text.fill",
                        main: "\(summary.activeContracts)",
                        sub: "共 \(summary.totalContracts) 只"
                    )
                    StatCard(
                        title: "已了结收益", icon: "trophy.fill",
                        main: Format.money(summary.settledGain),
                        sub: "雪球 \(Format.money(summary.snowballSettledGain)) · 凤凰派息 \(Format.money(summary.phoenixCouponGain))"
                    )
                }
            }
        }
    }

    // MARK: - 市场行情

    private var marketSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("市场行情")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                NavigationLink {
                    InstrumentManagementView()
                } label: {
                    Text("管理标的")
                        .font(.caption)
                }
            }
            if services.watchlist.isEmpty {
                Text("暂无自选标的，可在标的管理中添加")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            } else {
                ForEach(services.watchlist, id: \.self) { code in
                    if let quote = services.indexQuotes[code] {
                        IndexQuoteRow(quote: quote)
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
    }

    // MARK: - 预警看板

    private var alertSection: some View {
        let alerts = services.computeAlerts()
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("合约预警")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                NavigationLink {
                    AlertSettingsView()
                } label: {
                    Text("预警设置")
                        .font(.caption)
                }
            }
            if alerts.isEmpty {
                Text("暂无触发预警的合约")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            } else {
                ForEach(alerts, id: \.viewID) { alert in
                    if let position = services.positions.first(where: {
                        $0.id == alert.id && $0.structureType.rawValue == alert.structureType
                    }) {
                        NavigationLink(value: position) {
                            AlertCard(item: alert)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
    }

    private var dataDateFooter: some View {
        Group {
            if let date = services.latestDataDate {
                Text("行情数据截止：\(date)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 20)
    }

    // MARK: - 刷新

    private func refresh() async {
        refreshing = true
        await services.refreshQuotes()
        await services.refreshAlertPrices()
        refreshing = false
    }
}

// MARK: - 子组件

private struct StatCard: View {
    let title: String
    let icon: String
    let main: String
    let sub: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Image(systemName: icon)
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
            Text(main)
                .font(.title3.weight(.semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            Text(sub)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 14)
    }
}

/// A 股配色习惯：涨红跌绿。
private struct IndexQuoteRow: View {
    let quote: IndexQuote

    private var color: Color {
        if quote.changePct > 0 { return .red }
        if quote.changePct < 0 { return .green }
        return .secondary
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(quote.name)
                    .font(.subheadline.weight(.medium))
                Text("\(quote.code) · \(quote.updateTime)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.2f", quote.price))
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(color)
                    .contentTransition(.numericText())
                Text("\(sign(quote.change))  \(sign(quote.changePct))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(color)
                    .contentTransition(.numericText())
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text("高 \(String(format: "%.0f", quote.high))")
                Text("低 \(String(format: "%.0f", quote.low))")
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .animation(.snappy, value: quote.price)
    }

    private func sign(_ value: Double) -> String {
        String(format: "%+.2f", value)
    }
}

private struct AlertCard: View {
    let item: AlertEngine.Item

    private var toneColor: Color {
        let tones = item.reasons.map(\.tone)
        if tones.contains(.danger) { return .red }
        if tones.contains(.warn) { return .orange }
        return .blue
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle().fill(toneColor).frame(width: 8, height: 8)
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(String(format: "%.2f", item.cur))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(item.reasons.enumerated()), id: \.offset) { _, reason in
                HStack(alignment: .firstTextBaseline) {
                    Image(systemName: icon(for: reason.tone))
                        .font(.caption2)
                        .foregroundStyle(toneColor(for: reason.tone))
                        .frame(width: 14)
                    Text(reason.label)
                        .font(.caption)
                    Spacer()
                    Text("\(String(format: "%.1f", reason.gap))%")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(toneColor.opacity(0.08)))
    }

    private func toneColor(for tone: AlertEngine.Reason.Tone) -> Color {
        switch tone {
        case .danger: .red
        case .warn: .orange
        case .info: .blue
        }
    }

    private func icon(for tone: AlertEngine.Reason.Tone) -> String {
        switch tone {
        case .danger: "exclamationmark.triangle.fill"
        case .warn: "clock.badge.exclamationmark"
        case .info: "info.circle"
        }
    }
}
