import SwiftUI
import UniformTypeIdentifiers

/// 持仓列表：实时价、下一敲出日、安全垫、盈亏 + CSV 批量导入/导出。
struct PositionsView: View {
    @Environment(AppServices.self) private var services

    @State private var statusFilter: StatusFilter = .alive
    @State private var structureFilter: StructureFilter = .all
    @State private var showingNewForm = false
    @State private var showingImporter = false
    @State private var importResult: ImportResult?
    @State private var importFeedback = 0
    @State private var exportURL: URL?

    struct ImportResult: Identifiable {
        let id = UUID()
        var imported: Int
        var failed: Int
        var error: String?
    }

    enum StatusFilter: String, CaseIterable, Identifiable {
        case alive = "存续"
        case knockedIn = "已敲入"
        case settled = "已了结"
        case all = "全部"
        var id: String { rawValue }
    }

    enum StructureFilter: String, CaseIterable, Identifiable {
        case all = "全部"
        case snowball = "雪球"
        case phoenix = "凤凰"
        var id: String { rawValue }
    }

    enum SortOption: String, CaseIterable, Identifiable {
        case `default` = "默认"
        case notional = "名义本金"
        case startDate = "起息日期"
        case event = "事件早晚"

        var id: String { rawValue }

        /// 当前排序的顺序说明（菜单底部提示）。
        var hint: String {
            switch self {
        case .default: "录入顺序"
        case .notional: "由大到小"
        case .startDate: "由近到远"
        case .event: "最近事件在前"
            }
        }
    }

    @State private var sort: SortOption = .startDate

    private var filtered: [Position] {
        let result = services.positions.filter { position in
            let statusOK: Bool = switch statusFilter {
            // 存续 = 未了结（存续中 + 已敲入），与桌面端「存续合约」默认口径一致
            case .alive: position.status == .active || position.status == .knockedIn
            case .knockedIn: position.status == .knockedIn
            case .settled: position.status == .knockedOut || position.status == .matured
            case .all: true
            }
            let structureOK = switch structureFilter {
            case .all: true
            case .snowball: position.structureType == .snowball
            case .phoenix: position.structureType == .phoenix
            }
            return statusOK && structureOK
        }
        return sorted(result)
    }

    private func sorted(_ positions: [Position]) -> [Position] {
        let today = AppDate.startOfToday()
        switch sort {
        case .default:
            return positions
        case .notional:
            return positions.sorted { $0.notional > $1.notional }
        case .startDate:
            // 起息时间由近到远（日期降序）；起息日缺失或无法解析的排最后
            return positions.sorted {
                (AppDate.parse($0.tradeStartDate) ?? .distantPast) > (AppDate.parse($1.tradeStartDate) ?? .distantPast)
            }
        case .event:
            // 敲出与派息取其中最近的一个作为「下次事件」；无后续事件的排在最后
            return positions.sorted { lhs, rhs in
                switch (nextEventDate(lhs, today: today), nextEventDate(rhs, today: today)) {
                case let (l?, r?): return l < r
                case (_?, nil): return true
                case (nil, _?): return false
                case (nil, nil): return false
                }
            }
        }
    }

    private func nextEventDate(_ position: Position, today: Date) -> Date? {
        let candidates = [
            Calc.nextFutureDate(from: position.knockOutDates, today: today),
            Calc.nextFutureDate(from: position.couponDates, today: today)
        ]
        return candidates.compactMap { $0 }.min()
    }

    var body: some View {
        NavigationStack {
            Group {
                if services.positions.isEmpty {
                    ContentUnavailableView(
                        "暂无持仓",
                        systemImage: "list.bullet.rectangle.portrait",
                        description: Text("点击右上角 + 录入第一笔合约，或从桌面端导出 CSV 后在此导入")
                    )
                } else {
                    listContent
                }
            }
            .background(Color(.systemGroupedBackground))
            .sensoryFeedback(trigger: importFeedback) { _, _ in
                importResult?.error == nil ? .success : .error
            }
            .navigationTitle("持仓")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingNewForm = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Section {
                            ForEach(SortOption.allCases) { option in
                                Button {
                                    sort = option
                                } label: {
                                    if sort == option {
                                        Label(option.rawValue, systemImage: "checkmark")
                                    } else {
                                        Text(option.rawValue)
                                    }
                                }
                            }
                        } header: {
                            Text("排序")
                        } footer: {
                            Text(sort == .default ? "名义本金由大到小 · 起息日期由近到远 · 最近敲出/派息在前" : sort.hint)
                        }
                        Section {
                            Button {
                                showingImporter = true
                            } label: {
                                Label("导入 CSV", systemImage: "square.and.arrow.down")
                            }
                            Button {
                                exportCSV()
                            } label: {
                                Label("导出 CSV", systemImage: "square.and.arrow.up")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .navigationDestination(for: Position.self) { position in
                PositionDetailView(position: position)
            }
            .sheet(isPresented: $showingNewForm) {
                PositionFormView(editing: nil)
            }
            .sheet(item: $importResult) { result in
                if let error = result.error {
                    Text(error)
                        .padding()
                        .presentationDetents([.medium])
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(.green)
                            .symbolEffect(.bounce, value: result.imported)
                        Text("导入完成")
                            .font(.headline)
                        Text("成功 \(result.imported) 条，失败 \(result.failed) 条")
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .presentationDetents([.medium])
                }
            }
            .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.commaSeparatedText]) { result in
                handleImport(result)
            }
            .sheet(item: $exportURL) { url in
                ShareSheet(items: [url])
            }
        }
    }

    private var listContent: some View {
        List {
            Section {
                Picker("状态", selection: $statusFilter) {
                    ForEach(StatusFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                Picker("结构", selection: $structureFilter) {
                    ForEach(StructureFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                ForEach(filtered, id: \.unionKey) { position in
                    NavigationLink(value: position) {
                        PositionRow(position: position, latestPrice: services.latestPrices[position.underlyingCode])
                    }
                }
            } footer: {
                Text("共 \(filtered.count) 条（总 \(services.positions.count) 条）")
            }
        }
        .scrollContentBackground(.hidden)
    }

    // MARK: - CSV

    private func exportCSV() {
        let text = CSV.exportText(positions: services.positions)
        let stamp = Self.fileStamp()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("持仓导出_\(stamp).csv")
        try? text.data(using: .utf8)?.write(to: url)
        exportURL = url
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            importResult = ImportResult(imported: 0, failed: 0, error: "无法读取文件，请选择 UTF-8 编码的 CSV")
            return
        }
        let (importedPositions, failed) = CSV.importPositions(from: text)
        var imported = 0
        for position in importedPositions {
            do {
                _ = try services.savePosition(position)
                imported += 1
            } catch {
                continue
            }
        }
        if imported == 0 && failed > 0 {
            importResult = ImportResult(imported: 0, failed: failed,
                                        error: "全部 \(failed) 行导入失败，请确认文件为本应用导出的持仓 CSV")
        } else {
            importResult = ImportResult(imported: imported, failed: failed, error: nil)
        }
        importFeedback += 1
    }

    nonisolated static func fileStamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmm"
        return formatter.string(from: Date())
    }
}

/// iOS 分享面板（导出 CSV 用）。
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

// MARK: - 行组件

struct PositionRow: View {
    let position: Position
    let latestPrice: Double?

    private var title: String {
        position.productName.isEmpty
            ? (position.contractNo.isEmpty ? "未命名合约" : position.contractNo)
            : position.productName
    }

    private var structureColor: Color {
        position.structureType == .snowball ? .purple : .orange
    }

    private var isSettled: Bool {
        position.status == .knockedOut || position.status == .matured
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: 8)
                // 结构标识与状态标识并列在右侧（与详情页头部一致）
                HStack(spacing: 5) {
                    Text(position.structureType.label)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(structureColor.opacity(0.15)))
                        .foregroundStyle(structureColor)
                    StatusTag(status: position.status)
                }
            }
            Text(position.underlyingCode)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            metrics
        }
        .padding(.vertical, 2)
    }

    /// 核心信息：上排现价 / 安全垫 + 右侧盈亏；下排下一敲出、派息（含剩余天数）。
    @ViewBuilder
    private var metrics: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                if let price = latestPrice, !isSettled {
                    Text(String(format: "%.2f", price))
                        .font(.caption.monospacedDigit().weight(.medium))
                    let margin = Calc.safetyMargin(
                        currentPrice: price,
                        knockInPrice: position.initialPrice * position.knockInBarrier
                    )
                    Text("安全垫 \(Format.percent(margin, digits: 1))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(marginColor(margin))
                }
                Spacer(minLength: 0)
                payoffText
            }
            if !isSettled {
                HStack(spacing: 10) {
                    if let ko = nextKnockOutDate {
                        Text(eventLabel("敲出", date: ko))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.green)
                    }
                    if position.structureType == .phoenix, let cp = nextCouponDate {
                        Text(eventLabel("派息", date: cp))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.blue)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    @ViewBuilder
    private var payoffText: some View {
        let pnl = Calc.pnl(position, currentPrice: latestPrice)
        if position.status != .active, position.terminationPayoff != 0 {
            Text("\(position.status == .knockedOut ? "敲出收益" : "了结收益") \(Format.pnlText(position.terminationPayoff))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(Format.pnlColor(position.terminationPayoff))
        } else if pnl.type == "敲入浮亏" {
            Text("敲入浮亏 \(Format.pnlText(pnl.pnl))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(Format.pnlColor(pnl.pnl))
        }
    }

    private var today: Date { AppDate.startOfToday() }

    private var nextKnockOutDate: Date? {
        Calc.nextFutureDate(from: position.knockOutDates, today: today)
    }

    private var nextCouponDate: Date? {
        Calc.nextFutureDate(from: position.couponDates, today: today)
    }

    /// 「敲出 12-20·28天」形如：日期 + 到下一次观察日的剩余天数。
    private func eventLabel(_ prefix: String, date: Date) -> String {
        let days = AppDate.truncatedDayCount(from: today, to: date)
        let countdown = days > 0 ? "\(days)天" : "今天"
        return "\(prefix) \(shortDate(date))·\(countdown)"
    }

    private func shortDate(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.month, .day], from: date)
        return String(format: "%02d-%02d", components.month ?? 0, components.day ?? 0)
    }

    private func marginColor(_ margin: Double) -> Color {
        if margin <= 0 { return .red }
        if margin < 0.1 { return .orange }
        return .green
    }
}

struct StatusTag: View {
    let status: PositionStatus

    private var color: Color {
        switch status {
        case .active: .blue
        case .knockedIn: .orange
        case .knockedOut: .green
        case .matured: .gray
        }
    }

    var body: some View {
        Text(status.label)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.15)))
            .foregroundStyle(color)
    }
}
