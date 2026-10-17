import SwiftUI

/// 标的管理：已存行情标的列表（涨跌幅）、新增/删除、自选置顶、历史回填。
struct InstrumentManagementView: View {
    @Environment(AppServices.self) private var services

    @State private var summaries: [PriceCodeSummary] = []
    @State private var watchSet: Set<String> = []
    @State private var sortMode: SortMode = .code
    @State private var showingAdd = false
    @State private var newCode = ""
    @State private var addMessage: String?
    @State private var busyMessage: String?

    enum SortMode: String, CaseIterable, Identifiable {
        case code = "代码"
        case day = "日"
        case week = "周"
        case month = "月"
        case year = "年"
        var id: String { rawValue }
    }

    var body: some View {
        List {
            Section {
                ForEach(sorted, id: \.code) { summary in
                    row(summary)
                }
                .onDelete { indexSet in
                    let codes = indexSet.map { sorted[$0] }.map(\.code)
                    delete(codes)
                }
            }

            Section {
                Button {
                    showingAdd = true
                } label: {
                    Label("新增标的", systemImage: "plus.circle")
                }
                Button {
                    Task { await backfillAll() }
                } label: {
                    Label("下载历史行情数据", systemImage: "arrow.down.circle")
                }
                Button {
                    Task { await refreshToToday() }
                } label: {
                    Label("更新标的价格", systemImage: "arrow.clockwise")
                }
                Menu {
                    ForEach(sorted, id: \.code) { summary in
                        Button(role: .destructive) {
                            delete([summary.code])
                        } label: {
                            Text(summary.code)
                        }
                    }
                } label: {
                    Label("删除标的", systemImage: "trash")
                }
            }
        }
        .navigationTitle("标的管理")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("排序", selection: $sortMode) {
                        ForEach(SortMode.allCases) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    Divider()
                    Button {
                        setWatchlist(sorted.map(\.code))
                    } label: {
                        Label("全部收藏", systemImage: "star")
                    }
                    Button {
                        setWatchlist([])
                    } label: {
                        Label("清空收藏", systemImage: "star.slash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingAdd) { addSheet }
        .alert("提示", isPresented: Binding(
            get: { addMessage != nil },
            set: { if !$0 { addMessage = nil } }
        )) {
            Button("好的") { addMessage = nil }
        } message: {
            Text(addMessage ?? "")
        }
        .overlay {
            if let busyMessage {
                VStack(spacing: 10) {
                    ProgressView()
                    Text(busyMessage)
                        .font(.footnote)
                }
                .padding(20)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
            }
        }
        .task { load() }
    }

    // MARK: - 数据

    private func load() {
        summaries = (try? services.userDatabase.prices?.codeSummaries()) ?? []
        watchSet = Set(services.watchlist)
    }

    private var sorted: [PriceCodeSummary] {
        let pctOf: (PriceCodeSummary, Double?) -> Double? = { summary, base in
            guard let base, base != 0 else { return nil }
            return (summary.latestPrice - base) / base * 100
        }
        return summaries.sorted { a, b in
            switch sortMode {
            case .code: return a.code < b.code
            case .day: return (pctOf(a, a.prevPrice) ?? -Double.infinity) > (pctOf(b, b.prevPrice) ?? -Double.infinity)
            case .week: return (pctOf(a, a.priceWeekAgo) ?? -Double.infinity) > (pctOf(b, b.priceWeekAgo) ?? -Double.infinity)
            case .month: return (pctOf(a, a.priceMonthAgo) ?? -Double.infinity) > (pctOf(b, b.priceMonthAgo) ?? -Double.infinity)
            case .year: return (pctOf(a, a.priceYearAgo) ?? -Double.infinity) > (pctOf(b, b.priceYearAgo) ?? -Double.infinity)
            }
        }
    }

    // MARK: - 行

    private func row(_ summary: PriceCodeSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: watchSet.contains(summary.code) ? "star.fill" : "star")
                    .font(.caption)
                    .foregroundStyle(watchSet.contains(summary.code) ? Color.yellow : Color.gray)
                    .onTapGesture { toggleWatch(summary.code) }
                Text(summary.code)
                    .font(.subheadline.weight(.medium).monospacedDigit())
                Spacer()
                Text(String(format: "%.2f", summary.latestPrice))
                    .font(.subheadline.monospacedDigit())
                Text(summary.date)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            HStack(spacing: 12) {
                ChangeBadge(label: "日", pct: changePct(summary, summary.prevPrice))
                ChangeBadge(label: "周", pct: changePct(summary, summary.priceWeekAgo))
                ChangeBadge(label: "月", pct: changePct(summary, summary.priceMonthAgo))
                ChangeBadge(label: "年", pct: changePct(summary, summary.priceYearAgo))
                Spacer()
            }
        }
        .padding(.vertical, 2)
    }

    private func changePct(_ summary: PriceCodeSummary, _ base: Double?) -> Double? {
        guard let base, base != 0 else { return nil }
        return (summary.latestPrice - base) / base * 100
    }

    // MARK: - 动作

    private func toggleWatch(_ code: String) {
        if watchSet.contains(code) {
            watchSet.remove(code)
        } else {
            watchSet.insert(code)
        }
        setWatchlist(sorted.map(\.code))
    }

    private func setWatchlist(_ codes: [String]) {
        let ordered = codes.filter { watchSet.contains($0) }
        services.setWatchlist(ordered)
        watchSet = Set(services.watchlist)
    }

    private func delete(_ codes: [String]) {
        // 存续合约（存续中/已敲入）挂钩的标的不允许删除，避免行情历史缺失
        let activeCodes = Set(services.positions
            .filter { $0.status == .active || $0.status == .knockedIn }
            .map(\.underlyingCode))
        let blocked = codes.filter { activeCodes.contains($0) }
        if !blocked.isEmpty {
            addMessage = "标的 \(blocked.joined(separator: "、")) 有存续合约挂钩，不能删除"
            return
        }
        for code in codes {
            try? services.userDatabase.prices?.deleteByCode(code: code)
        }
        watchSet.subtract(codes)
        setWatchlist(sorted.map(\.code).filter { !codes.contains($0) })
        load()
    }

    private var addSheet: some View {
        NavigationStack {
            Form {
                TextField("标的代码（如 000852.SH）", text: $newCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Button("回填并新增") { Task { await addAndBackfill() } }
                    .disabled(newCode.isEmpty)
            }
            .navigationTitle("新增标的")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { showingAdd = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func addAndBackfill() async {
        // 与桌面端一致：全角归一化、去空白、转大写，正则校验 ^\d{6}\.(SH|SZ)$
        var normalized = MarketDataClient.normalizeCode(newCode).uppercased()
        normalized = normalized.replacingOccurrences(of: " ", with: "")
        guard normalized.contains(Regex(/^\d{6}\.(SH|SZ)$/)) else {
            addMessage = "代码格式应为 000852.SH 或 399006.SZ"
            return
        }
        showingAdd = false
        busyMessage = "回填 \(normalized) 近 2 年行情…"
        let service = IndexHistoryService(database: services.userDatabase, market: services.market)
        let saved = await service.backfillCode(normalized)
        busyMessage = nil
        if saved == 0 {
            addMessage = "未获取到 \(normalized) 的行情数据，请确认代码正确"
        } else {
            addMessage = "已写入 \(saved) 条行情"
        }
        newCode = ""
        load()
    }

    private func backfillAll() async {
        busyMessage = "正在下载历史行情…"
        let service = IndexHistoryService(database: services.userDatabase, market: services.market)
        let report = await service.backfillAll()
        busyMessage = nil
        addMessage = "补足 \(report.saved) 条（\(report.codes) 个标的）" +
            (report.failures.isEmpty ? "" : "，失败：\(report.failures.joined(separator: "、"))")
        load()
    }

    private func refreshToToday() async {
        busyMessage = "正在增量更新…"
        let service = IndexHistoryService(database: services.userDatabase, market: services.market)
        let report = await service.refreshToToday()
        busyMessage = nil
        addMessage = report.saved > 0
            ? "补足 \(report.saved) 条（涉及 \(report.codes) 个标的）"
            : "数据已是最新"
        load()
    }
}

/// 涨跌幅小标签（红涨绿跌，缺数据显示 —）。
struct ChangeBadge: View {
    let label: String
    let pct: Double?

    var body: some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(text)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(color)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color(.tertiarySystemFill)))
    }

    private var text: String {
        guard let pct else { return "—" }
        return String(format: "%+.2f%%", pct)
    }

    private var color: Color {
        guard let pct else { return .secondary }
        if pct >= 0 { return .red }
        return .green
    }
}
