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

    private var filtered: [Position] {
        services.positions.filter { position in
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
            // 核心信息行：现价 / 安全垫 / 下一敲出 / 派息观察；右侧了结收益或浮亏
            HStack(spacing: 10) {
                if isSettled {
                    Spacer()
                } else {
                    if let price = latestPrice {
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
                    if let ko = nextKnockOutShort {
                        Text("敲出 \(ko)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.green)
                    }
                    if position.structureType == .phoenix, let cp = nextCouponShort {
                        Text("派息 \(cp)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.blue)
                    }
                    Spacer()
                }
                payoffText
            }
        }
        .padding(.vertical, 2)
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

    private var nextKnockOutShort: String? {
        let today = AppDate.startOfToday()
        guard let date = Calc.stringArray(position.knockOutDates)
            .compactMap({ AppDate.parse($0) })
            .filter({ $0 >= today })
            .min() else { return nil }
        return shortDate(date)
    }

    private var nextCouponShort: String? {
        let today = AppDate.startOfToday()
        guard let date = Calc.stringArray(position.couponDates)
            .compactMap({ AppDate.parse($0) })
            .filter({ $0 >= today })
            .min() else { return nil }
        return shortDate(date)
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
