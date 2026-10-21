import SwiftUI

/// 合约检查：用历史行情对账，抓漏记/误记的敲出与派息（与桌面端 ContractCheck 规则一致）。
struct ContractCheckView: View {
    @Environment(AppServices.self) private var services

    struct Issue: Identifiable {
        let id: String
        let kind: Kind
        var position: Position
        let observationDate: String
        let barrierPrice: Double
        let barrierLabel: String   // 已含百分比文案
        let closePrice: Double

        enum Kind: String, CaseIterable {
            case missedKnockOut = "漏记敲出"
            case missedCoupon = "漏记派息"
            case falseKnockOut = "误记敲出"
            case falseCoupon = "误记派息"
        }
    }

    @State private var issues: [Issue] = []
    @State private var dataAsOf: String?
    @State private var running = false
    @State private var hasRun = false
    @State private var notesTarget: Issue?
    @State private var detailTarget: Position?
    @State private var saveError: String?

    var body: some View {
        List {
            Section {
                Button {
                    Task { await run() }
                } label: {
                    HStack {
                        if running {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "magnifyingglass.circle.fill")
                        }
                        Text(running ? "检查中…" : (hasRun ? "重新检查" : "开始检查"))
                    }
                }
                .disabled(running)

                if let dataAsOf {
                    Label(dataAsOf == AppDate.todayUTCString()
                          ? "行情已入库至 \(dataAsOf)，含今日观察日"
                          : "行情截止 \(dataAsOf)，今日观察日按最近交易日收盘价回退判定",
                          systemImage: "calendar.badge.clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if hasRun {
                ForEach(Issue.Kind.allCases, id: \.self) { kind in
                    issueSection(kind)
                }
            }
        }
        .navigationTitle("合约检查")
        .navigationBarTitleDisplayMode(.inline)
        // 详情页走 item 版导航：行内若放 NavigationLink，它会吞掉整行的点击，
        // 导致同一行的「备注」按钮点不到、直接跳详情。
        .navigationDestination(item: $detailTarget) { position in
            PositionDetailView(position: position)
        }
        .sheet(item: $notesTarget) { issue in
            NotesSheet(initialText: prefilledNotes(for: issue)) { newText in
                appendNotes(newText, to: issue)
            }
        }
        .alert("保存失败", isPresented: Binding(
            get: { saveError != nil },
            set: { if !$0 { saveError = nil } }
        )) {
            Button("好的") { saveError = nil }
        } message: {
            Text(saveError ?? "")
        }
    }

    // MARK: - 检查逻辑（与桌面端一致）

    private func run() async {
        running = true
        defer { running = false }

        let today = todayString()
        var result: [Issue] = []
        var maxPriceDate = ""

        // 行情按标的缓存（price 非空、按日期升序）
        var priceCache: [String: [(date: String, price: Double)]] = [:]
        func prices(_ code: String) -> [(date: String, price: Double)] {
            if let cached = priceCache[code] { return cached }
            let rows = (try? services.userDatabase.prices?.history(code: code)) ?? []
            let list = rows
                .filter { $0.price > 0 }
                .map { (date: $0.date, price: $0.price) }
                .sorted { $0.date < $1.date }
            priceCache[code] = list
            return list
        }
        func closePrice(_ code: String, _ date: String) -> Double? {
            let list = prices(code)
            if let exact = list.first(where: { $0.date == date }) { return exact.price }
            return list.last(where: { $0.date < date })?.price
        }

        for position in services.positions {
            let isActive = position.status == .active || position.status == .knockedIn
            let initial = position.initialPrice

            // 1) 漏记敲出：存续中，观察日 ≤ 今天，收盘 ≥ 障碍价
            if isActive, initial > 0 {
                let dates = Calc.stringArray(position.knockOutDates)
                let barriers = Calc.numberArray(position.knockOutBarriers)
                for (index, dateText) in dates.enumerated() where dateText <= today {
                    let barrierPct = index < barriers.count
                        ? barriers[index]
                        : (barriers.last ?? 0)
                    let barrierPrice = initial * barrierPct / 100
                    if let close = closePrice(position.underlyingCode, dateText), close >= barrierPrice {
                        result.append(Issue(
                            id: "\(position.id)-mko-\(index)",
                            kind: .missedKnockOut,
                            position: position,
                            observationDate: dateText,
                            barrierPrice: barrierPrice,
                            barrierLabel: "敲出 \(String(format: "%.2f", barrierPrice))（\(String(format: "%.2f", barrierPct))%）",
                            closePrice: close
                        ))
                    }
                    maxPriceDate = max(maxPriceDate, latestDate(prices(position.underlyingCode), cap: dateText) ?? "")
                }
            }

            // 2) 漏记派息：凤凰、存续中，观察日 ≤ 今天且未在已派息集合，收盘 ≥ 派息障碍
            if isActive, position.structureType == .phoenix, initial > 0, position.couponBarrier > 0 {
                let paidDates = Set(Calc.stringArray(position.couponPaymentDates))
                let dates = Calc.stringArray(position.couponDates)
                for (index, dateText) in dates.enumerated() where dateText <= today && !paidDates.contains(dateText) {
                    let barrierPrice = initial * position.couponBarrier
                    if let close = closePrice(position.underlyingCode, dateText), close >= barrierPrice {
                        result.append(Issue(
                            id: "\(position.id)-mcp-\(index)",
                            kind: .missedCoupon,
                            position: position,
                            observationDate: dateText,
                            barrierPrice: barrierPrice,
                            barrierLabel: "派息 \(String(format: "%.2f", barrierPrice))（\(String(format: "%.2f", position.couponBarrier * 100))%）",
                            closePrice: close
                        ))
                    }
                }
            }

            // 3) 误记敲出：已标记敲出，但没有任何观察日达标
            if position.status == .knockedOut, initial > 0 {
                let dates = Calc.stringArray(position.knockOutDates)
                let barriers = Calc.numberArray(position.knockOutBarriers)
                var anyMet = false
                var latestRef: (date: String, barrier: Double, price: Double, close: Double)?
                for (index, dateText) in dates.enumerated() where dateText <= today {
                    let barrierPct = index < barriers.count ? barriers[index] : (barriers.last ?? 0)
                    let barrierPrice = initial * barrierPct / 100
                    guard let close = closePrice(position.underlyingCode, dateText) else { continue }
                    if close >= barrierPrice { anyMet = true }
                    if latestRef == nil || dateText > latestRef!.date {
                        latestRef = (dateText, barrierPct, barrierPrice, close)
                    }
                }
                if !anyMet, let ref = latestRef {
                    result.append(Issue(
                        id: "\(position.id)-fko",
                        kind: .falseKnockOut,
                        position: position,
                        observationDate: ref.date,
                        barrierPrice: ref.price,
                        barrierLabel: "敲出 \(String(format: "%.2f", ref.price))（\(String(format: "%.2f", ref.barrier))%）",
                        closePrice: ref.close
                    ))
                }
            }

            // 4) 误记派息：凤凰（不限状态），已派息日收盘未达标
            if position.structureType == .phoenix, initial > 0, position.couponBarrier > 0 {
                let dates = Calc.stringArray(position.couponPaymentDates)
                for (index, dateText) in dates.enumerated() where dateText <= today {
                    let barrierPrice = initial * position.couponBarrier
                    if let close = closePrice(position.underlyingCode, dateText), close < barrierPrice {
                        result.append(Issue(
                            id: "\(position.id)-fcp-\(index)",
                            kind: .falseCoupon,
                            position: position,
                            observationDate: dateText,
                            barrierPrice: barrierPrice,
                            barrierLabel: "派息 \(String(format: "%.2f", barrierPrice))（\(String(format: "%.2f", position.couponBarrier * 100))%）",
                            closePrice: close
                        ))
                    }
                }
            }
        }

        // 权威截止日 = 全表最新行情日；缺失回退本次扫描最大值
        dataAsOf = (try? services.userDatabase.prices?.latestDate()) ?? (maxPriceDate.isEmpty ? nil : maxPriceDate)
        issues = result
        hasRun = true
    }

    private func latestDate(_ list: [(date: String, price: Double)], cap: String) -> String? {
        list.last(where: { $0.date <= cap })?.date
    }

    private func todayString() -> String {
        AppDate.todayUTCString()
    }

    // MARK: - 展示

    private func issueSection(_ kind: Issue.Kind) -> some View {
        let kindIssues = issues.filter { $0.kind == kind }
        return Section("\(kind.rawValue)（\(kindIssues.count)）") {
            if kindIssues.isEmpty {
                Text("无").foregroundStyle(.tertiary)
            } else {
                ForEach(kindIssues) { issue in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(issue.position.productName.isEmpty ? issue.position.contractNo : issue.position.productName)
                                .font(.subheadline.weight(.medium))
                                .lineLimit(1)
                            Spacer()
                            Text(issue.observationDate)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        Text("\(issue.position.structureType.label) · \(issue.position.underlyingCode) · 期初 \(String(format: "%.2f", issue.position.initialPrice))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack {
                            Text(issue.barrierLabel)
                                .font(.caption.monospacedDigit())
                            Spacer()
                            Text("收盘 \(String(format: "%.2f", issue.closePrice))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(issue.kind == .missedKnockOut || issue.kind == .missedCoupon ? .green : .red)
                        }
                        // 行内不再用 NavigationLink（会吞并整行点击），两个操作都用按钮，保证触控区
                        HStack(spacing: 10) {
                            Spacer(minLength: 0)
                            Button {
                                detailTarget = issue.position
                            } label: {
                                Label("查看合约", systemImage: "chevron.right")
                                    .labelStyle(.titleAndIcon)
                            }
                            .buttonStyle(.bordered)
                            Button {
                                notesTarget = issue
                            } label: {
                                Label("加备注", systemImage: "square.and.pencil")
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .buttonStyle(.borderless)
                        .font(.subheadline)
                        .padding(.top, 2)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    /// 备注预填 = 既有备注 + 检查摘要（若未包含）。
    private func prefilledNotes(for issue: Issue) -> String {
        let summary = buildSummary(for: issue)
        let existing = issue.position.notes
        return existing.contains(summary) ? existing : (existing.isEmpty ? summary : existing + "\n\n" + summary)
    }

    // MARK: - 备注摘要（与桌面端 buildCheckSummary 一致）

    private func buildSummary(for issue: Issue) -> String {
        let position = issue.position
        var lines: [String] = []
        lines.append("合约号 \(position.contractNo)")
        lines.append("结构（\(position.structureType.label)/\(position.underlyingCode)）")
        lines.append("事件：\(issue.kind.rawValue)")
        lines.append("观察日：\(issue.observationDate)")
        lines.append("\(issue.barrierLabel)")
        lines.append("当日收盘：\(String(format: "%.2f", issue.closePrice))")
        lines.append("名义本金：\(Format.moneyFull(position.notional))")
        if issue.kind == .missedCoupon || issue.kind == .falseCoupon {
            let amount = position.notional * position.couponRate * (1 - position.incomeDividendPct)
            lines.append("派息金额 = \(Format.moneyFull(amount))")
        } else {
            let dates = Calc.stringArray(position.knockOutDates)
            let coupons = Calc.numberArray(position.knockOutCoupons)
            let index = dates.firstIndex(of: issue.observationDate) ?? dates.count - 1
            let rate = index >= 0 && index < coupons.count ? coupons[index] : (coupons.last ?? 0)
            let years = Double(max(0, Calc.holdingDays(effectiveDate: position.tradeStartDate))) / 365.0
            let amount = position.notional * rate / 100 * (years > 0 ? years : 1)
            lines.append("敲出票息金额 = \(Format.moneyFull(amount))")
        }
        return lines.joined(separator: "\n")
    }

    private func appendNotes(_ newText: String, to issue: Issue) {
        var updated = issue.position
        updated.notes = newText
        do {
            _ = try services.savePosition(updated)
            // 回写列表快照，否则再次点同一条的「加备注」仍预填旧内容
            if let index = issues.firstIndex(where: { $0.id == issue.id }) {
                issues[index].position = updated
            }
        } catch {
            saveError = error.localizedDescription
        }
    }
}

/// 备注编辑弹层（预填摘要，可改后保存）。
private struct NotesSheet: View {
    let initialText: String
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section("合约备注") {
                    TextEditor(text: $text)
                        .font(.footnote.monospaced())
                        .frame(minHeight: 200)
                }
            }
            .navigationTitle("备注")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        onSave(text)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
        .task {
            guard !loaded else { return }
            loaded = true
            text = initialText
        }
    }
}
