import SwiftUI

/// 持仓详情：条款展示、实时行情卡、敲入/敲出/到期/派息登记、事件记录。
struct PositionDetailView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss

    /// 详情页始终展示数据库里的最新值；按 id+结构定位。
    @State private var showingPosition: Position
    @State private var refreshingPrice = false
    @State private var showingEdit = false
    @State private var knockInSheet = false
    @State private var settleSheet: SettleKind?
    @State private var dividendSheet = false
    @State private var confirmingDelete = false
    @State private var errorMessage: String?
    @State private var showCopiedHint = false
    // 事件记录缓存：避免每次 body 渲染都在主线程查一次 SQLite
    @State private var events: [MarketEvent] = []

    enum SettleKind: String, Identifiable {
        case knockOut
        case maturity
        var id: String { rawValue }
        var title: String { self == .knockOut ? "登记敲出了结" : "登记到期了结" }
    }

    init(position: Position) {
        _showingPosition = State(initialValue: position)
    }

    private var position: Position {
        // 优先取服务层最新数据（状态流转后自动反映）
        services.positions.first {
            $0.id == showingPosition.id && $0.structureType == showingPosition.structureType
        } ?? showingPosition
    }

    /// 今天及之后最近的敲出观察日。
    private var nextKnockOutDate: Date? {
        let today = AppDate.startOfToday()
        return Calc.stringArray(position.knockOutDates)
            .compactMap { AppDate.parse($0) }
            .filter { $0 >= today }
            .min()
    }

    /// 最近敲出观察日对应的障碍比例（百分比数值）；无未来观察日为 nil。
    private var nextKnockOutBarrier: Double? {
        guard let next = nextKnockOutDate else { return nil }
        let dates = Calc.stringArray(position.knockOutDates)
        let barriers = Calc.numberArray(position.knockOutBarriers)
        guard let index = dates.firstIndex(where: { AppDate.parse($0) == next }),
              index < barriers.count else { return nil }
        return barriers[index]
    }

    /// 今天及之后最近的派息观察日。
    private var nextCouponDate: Date? {
        let today = AppDate.startOfToday()
        return Calc.stringArray(position.couponDates)
            .compactMap { AppDate.parse($0) }
            .filter { $0 >= today }
            .min()
    }

    /// 顶部标题：优先合约名称，无名称用合约编号，都空则「未命名合约」。
    private var displayTitle: String {
        if !position.productName.isEmpty { return position.productName }
        if !position.contractNo.isEmpty { return position.contractNo }
        return "未命名合约"
    }

    var body: some View {
        List {
            headerSection
            priceSection
            termsSection
            knockOutTermsSection
            if position.structureType == .phoenix {
                phoenixSection
            }
            feeSection
            tradeFeeSection
            actionSection
            eventsSection
        }
        .sensoryFeedback(.error, trigger: errorMessage)
        .sensoryFeedback(.success, trigger: showCopiedHint)
        .overlay(alignment: .bottom) {
            if showCopiedHint {
                Label("已复制到剪贴板", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color(.secondarySystemGroupedBackground)))
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: showCopiedHint)
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        UIPasteboard.general.string = ContractParser.makeText(position)
                        showCopiedHint = true
                        Task {
                            try? await Task.sleep(for: .seconds(1.6))
                            showCopiedHint = false
                        }
                    } label: {
                        Label("复制合约", systemImage: "doc.on.doc")
                    }
                    Button {
                        showingEdit = true
                    } label: {
                        Label("编辑合约", systemImage: "square.and.pencil")
                    }
                    if position.status == .knockedIn {
                        Button(role: .destructive) {
                            applyStatus(.active, isKi: false)
                        } label: {
                            Label("撤销敲入", systemImage: "arrow.uturn.backward")
                        }
                    } else {
                        Button {
                            showingPosition = position
                            knockInSheet = true
                        } label: {
                            Label("标记敲入", systemImage: "arrow.down.right.circle")
                        }
                    }
                    Button {
                        showingPosition = position
                        settleSheet = .knockOut
                    } label: {
                        Label("登记敲出了结", systemImage: "arrow.up.right.circle")
                    }
                    Button {
                        showingPosition = position
                        settleSheet = .maturity
                    } label: {
                        Label("登记到期了结", systemImage: "calendar.badge.checkmark")
                    }
                    if position.structureType == .phoenix {
                        Button {
                            showingPosition = position
                            dividendSheet = true
                        } label: {
                            Label("派息登记", systemImage: "banknote")
                        }
                    }
                    Divider()
                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        Label("删除合约", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $knockInSheet) {
            KnockInSheet { date in
                applyStatus(.knockedIn, isKi: true, knockInDate: date)
            }
        }
        .sheet(isPresented: $showingEdit) {
            PositionFormView(editing: position)
        }
        .sheet(item: $settleSheet) { kind in
            SettleSheet(position: position, kind: kind) { date, payoff in
                let status: PositionStatus = kind == .knockOut ? .knockedOut : .matured
                applyStatus(status, terminationDate: date, payoff: payoff)
                services.createEvent(position,
                                     type: kind == .knockOut ? "knock_out" : "maturity",
                                     date: date,
                                     description: kind == .knockOut ? "敲出了结" : "到期了结")
                reloadEvents()
            }
        }
        .sheet(isPresented: $dividendSheet, onDismiss: { reloadEvents() }) {
            DividendSheet(position: position)
        }
        .confirmationDialog("确认删除该合约？", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("删除", role: .destructive) {
                try? services.deletePosition(position)
                dismiss()
            }
        }
        .alert("操作失败", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好的") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task { reloadEvents() }
        #if DEBUG
        .task {
            // 调试走查：-autoplay-nav 下自动返回，配合总览页自动推入，构成 push/pop 循环
            guard ProcessInfo.processInfo.arguments.contains("-autoplay-nav") else { return }
            try? await Task.sleep(for: .seconds(1.5))
            dismiss()
        }
        #endif
    }

    // MARK: - 分区

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(displayTitle)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
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
                HStack(spacing: 8) {
                    Text(position.underlyingCode)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    // 编号已顶替标题时不再重复展示
                    if !position.contractNo.isEmpty, !position.productName.isEmpty {
                        Text(position.contractNo)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    if !position.broker.isEmpty {
                        Text(position.broker)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                if position.status == .knockedIn, !position.knockInDate.isEmpty {
                    Label("敲入日期 \(position.knockInDate)", systemImage: "arrow.down.right.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                if !position.terminationDate.isEmpty {
                    Label("了结日期 \(position.terminationDate)", systemImage: "checkmark.seal.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var structureColor: Color {
        position.structureType == .snowball ? .purple : .orange
    }

    @ViewBuilder
    private var priceSection: some View {
        let price = services.latestPrices[position.underlyingCode]
        Section("实时行情") {
            if let price {
                let kiPrice = position.initialPrice * position.knockInBarrier
                let margin = Calc.safetyMargin(currentPrice: price, knockInPrice: kiPrice)
                let pnl = Calc.pnl(position, currentPrice: price)
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(String(format: "%.2f", price))
                            .font(.largeTitle.weight(.semibold).monospacedDigit())
                            .contentTransition(.numericText())
                        Text(position.underlyingCode)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Divider()
                    // 关键点位三列对齐：名称 / 点位 / 距离
                    Grid(horizontalSpacing: 12, verticalSpacing: 7) {
                        GridRow {
                            Text("敲入价")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(String(format: "%.2f", kiPrice))
                                .font(.subheadline.monospacedDigit())
                            Text("安全垫 \(Format.signedPercent(margin))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(margin >= 0 ? Color.green : Color.red)
                                .gridColumnAlignment(.trailing)
                        }
                        if let koBarrier = nextKnockOutBarrier {
                            let koPrice = position.initialPrice * koBarrier / 100
                            let gap = price > 0 ? koPrice / price - 1 : 0
                            GridRow {
                                Text("敲出价")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text(String(format: "%.2f", koPrice))
                                    .font(.subheadline.monospacedDigit())
                                Text("距离 \(Format.signedPercent(gap))")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(gap <= 0 ? Color.green : Color.red)
                            }
                        }
                        if position.structureType == .phoenix, position.couponBarrier > 0 {
                            let cpPrice = position.initialPrice * position.couponBarrier
                            let gap = price > 0 ? cpPrice / price - 1 : 0
                            GridRow {
                                Text("派息价")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text(String(format: "%.2f", cpPrice))
                                    .font(.subheadline.monospacedDigit())
                                Text("距离 \(Format.signedPercent(gap))")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(gap <= 0 ? Color.green : Color.red)
                            }
                        }
                    }
                    Divider()
                    if position.status == .knockedIn {
                        LabeledContent("敲入浮亏") {
                            Text(Format.pnlText(pnl.pnl))
                                .foregroundStyle(Format.pnlColor(pnl.pnl))
                                .monospacedDigit()
                        }
                    }
                    if position.structureType == .phoenix {
                        if let expected = Calc.estimateExpectedProfit(position) {
                            LabeledContent("预估派息") {
                                Text(Format.moneyFull(expected))
                                    .foregroundStyle(expected >= 0 ? Color.green : Color.red)
                                    .monospacedDigit()
                            }
                        }
                    } else if let couponEstimate = Calc.estimateKnockOutCoupon(position) {
                        LabeledContent("预估敲出票息") {
                            Text(Format.moneyFull(couponEstimate))
                                .foregroundStyle(couponEstimate >= 0 ? Color.green : Color.red)
                                .monospacedDigit()
                        }
                    }
                }
            } else {
                Button {
                    Task { await refreshPrice() }
                } label: {
                    Label(refreshingPrice ? "获取中…" : "获取实时价", systemImage: "arrow.clockwise")
                }
                .disabled(refreshingPrice)
            }
        }
    }

    private var termsSection: some View {
        Section("基础条款") {
            LabeledContent("起息日") { Text(position.tradeStartDate).monospacedDigit().foregroundStyle(.secondary) }
            LabeledContent("名义本金") { Text(Format.moneyFull(position.notional)).monospacedDigit() }
            LabeledContent("期初价格") { Text(String(format: "%.2f", position.initialPrice)).monospacedDigit() }
            LabeledContent("保证金比例") { Text(Format.percent(position.marginRatio)).monospacedDigit() }
            LabeledContent("最大亏损") { Text(Format.percent(position.maxLossPct)).monospacedDigit() }
            LabeledContent("敲入障碍") { Text(Format.percent(position.knockInBarrier)).monospacedDigit() }
            LabeledContent("敲入执行价") { Text(Format.percent(position.knockInStrike)).monospacedDigit() }
            LabeledContent("敲入观察") { Text(Format.knockInObservationLabel(position.knockInObservation)) }
            if position.structureType == .snowball {
                LabeledContent("红利票息") { Text(Format.percent(position.maturityCoupon)).monospacedDigit() }
                LabeledContent("敲出增强参与率") { Text(Format.percent(position.knockOutEnhanceParticipation)).monospacedDigit() }
            }
        }
    }

    /// 观察日数据行：过去置灰、下一个观察日整行绿字。
    private func observationRow<Content: View>(dateText: String, today: Date, next: Date?,
                                               @ViewBuilder content: () -> Content) -> some View {
        let date = AppDate.parse(dateText)
        let isPast = date.map { $0 < today } ?? false
        let isNext = date != nil && date == next
        return HStack(spacing: 8) { content() }
            .font(.subheadline)
            .foregroundStyle(isNext ? Color.green : (isPast ? Color(.tertiaryLabel) : Color.primary))
            .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
    }

    @ViewBuilder
    private var knockOutTermsSection: some View {
        let dates = Calc.stringArray(position.knockOutDates)
        let barriers = Calc.numberArray(position.knockOutBarriers)
        // 敲出票息序列仅雪球结构存在；凤凰只展示观察日 + 障碍价格两列
        let showCoupons = position.structureType == .snowball
        let coupons = showCoupons ? Calc.numberArray(position.knockOutCoupons) : []
        Section("敲出条款") {
            if dates.isEmpty {
                Text("未设置敲出观察日").foregroundStyle(.tertiary)
            } else {
                let today = AppDate.startOfToday()
                ForEach(Array(dates.enumerated()), id: \.offset) { index, dateText in
                    observationRow(dateText: dateText, today: today, next: nextKnockOutDate) {
                        Text(dateText)
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 3) {
                            Text(index < barriers.count
                                 ? String(format: "%.2f", position.initialPrice * barriers[index] / 100)
                                 : "—")
                            if index < barriers.count {
                                Text(Format.percentRaw(barriers[index]))
                                    .font(.caption2)
                            }
                        }
                        .monospacedDigit()
                        .frame(width: 124, alignment: .trailing)
                        if showCoupons {
                            Text(index < coupons.count ? Format.percentRaw(coupons[index]) : "—")
                                .monospacedDigit()
                                .frame(width: 64, alignment: .trailing)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var phoenixSection: some View {
        let dates = Calc.stringArray(position.couponDates)
        Section("派息条款") {
            LabeledContent("派息障碍") { Text(Format.percent(position.couponBarrier)).monospacedDigit() }
            if dates.isEmpty {
                Text("未设置派息观察日").foregroundStyle(.tertiary)
            } else {
                let today = AppDate.startOfToday()
                ForEach(Array(dates.enumerated()), id: \.offset) { _, dateText in
                    observationRow(dateText: dateText, today: today, next: nextCouponDate) {
                        Text(dateText)
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(Format.percent(position.couponRate))
                            .monospacedDigit()
                            .frame(width: 72, alignment: .trailing)
                    }
                }
            }
        }
    }

    private var feeSection: some View {
        Section("返息与费用") {
            LabeledContent("年化后端返息") { Text(Format.percent(position.rebateAnnualPct)).monospacedDigit() }
            LabeledContent("绝对后端返息") { Text(Format.percent(position.rebateAbsoluteBackPct)).monospacedDigit() }
            LabeledContent("绝对前端返息") { Text(Format.percent(position.rebateAbsoluteFrontPct)).monospacedDigit() }
            LabeledContent("计息规则") { Text(Format.accrualBasisLabel(position.accrualBasis)) }
            LabeledContent("计息结算") { Text("T+\(position.accrualSettleTplus)").monospacedDigit() }
        }
    }

    private var tradeFeeSection: some View {
        Section("交易费用") {
            LabeledContent("交易佣金") { Text(Format.percent(position.absFeePct)).monospacedDigit() }
            LabeledContent("年化费用") { Text(Format.percent(position.annualFeePct)).monospacedDigit() }
            LabeledContent("收益分红") { Text(Format.percent(position.incomeDividendPct)).monospacedDigit() }
        }
    }

    @ViewBuilder
    private var actionSection: some View {
        let notes = position.notes
        if !notes.isEmpty {
            Section("备注") {
                Text(notes)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var eventsSection: some View {
        Section("事件记录") {
            if events.isEmpty {
                Text("暂无事件").foregroundStyle(.tertiary)
            } else {
                ForEach(events) { event in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(eventTypeLabel(event.eventType))
                                .font(.subheadline)
                            Spacer()
                            Text(event.eventDate)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        if !event.description.isEmpty {
                            Text(event.description)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: - 动作

    private func refreshPrice() async {
        refreshingPrice = true
        _ = await services.fetchAndStorePrice(for: position)
        refreshingPrice = false
    }

    private func applyStatus(_ status: PositionStatus,
                             isKi: Bool? = nil, knockInDate: String? = nil,
                             terminationDate: String? = nil, payoff: Double?? = nil) {
        do {
            try services.updateStatus(showingPosition, status: status,
                                      isKi: isKi, knockInDate: knockInDate,
                                      terminationDate: terminationDate, payoff: payoff)
            if isKi == true, let knockInDate {
                services.createEvent(showingPosition, type: "knock_in", date: knockInDate, description: "敲入登记")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        reloadEvents()
    }

    private func reloadEvents() {
        events = services.events(for: position)
    }
}

private func eventTypeLabel(_ type: String) -> String {
    switch type {
    case "knock_in": "敲入"
    case "knock_out": "敲出"
    case "maturity": "到期"
    case "dividend": "派息"
    case "note": "备注"
    default: type
    }
}

// MARK: - 登记弹层

/// 敲入登记：选择敲入日期。
private struct KnockInSheet: View {
    let onDone: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("敲入日期", selection: $date, displayedComponents: .date)
            }
            .navigationTitle("标记敲入")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确认敲入") {
                        onDone(AppDate.format(date))
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// 了结登记：敲出/到期日期 + 了结收益（绝对金额）。
private struct SettleSheet: View {
    let position: Position
    let kind: PositionDetailView.SettleKind
    let onDone: (String, Double?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var payoffText = ""

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(kind == .knockOut ? "敲出日期" : "到期日期", selection: $date, displayedComponents: .date)
                HStack {
                    Text("了结收益")
                    Spacer()
                    TextField("选填", text: $payoffText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 140)
                }
            }
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确认") {
                        let payoff = Double(payoffText)
                        onDone(AppDate.format(date), payoff)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// 凤凰派息登记：逐期录入已派息金额，写入 coupon_received 并生成事件。
private struct DividendSheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss

    let position: Position
    @State private var amounts: [String] = []
    @State private var loaded = false
    @State private var saveError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Array(dates.enumerated()), id: \.offset) { index, dateText in
                        HStack {
                            Text(dateText)
                                .monospacedDigit()
                            Spacer()
                            TextField("派息金额", text: binding(index))
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 120)
                        }
                    }
                } footer: {
                    Text("按派息观察日逐期登记已收到的派息金额")
                }
            }
            .navigationTitle("派息登记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                }
            }
        }
        .presentationDetents([.large])
        .alert("保存失败", isPresented: Binding(
            get: { saveError != nil },
            set: { if !$0 { saveError = nil } }
        )) {
            Button("好的") { saveError = nil }
        } message: {
            Text(saveError ?? "")
        }
        .task {
            guard !loaded else { return }
            loaded = true
            let stored = Calc.stringArray(position.couponReceived)
            amounts = dates.indices.map { index in index < stored.count ? stored[index] : "" }
        }
    }

    private var dates: [String] {
        Calc.stringArray(position.couponDates)
    }

    private func binding(_ index: Int) -> Binding<String> {
        Binding(
            get: { index < amounts.count ? amounts[index] : "" },
            set: { newValue in
                while amounts.count <= index { amounts.append("") }
                amounts[index] = newValue
            }
        )
    }

    private func save() {
        let values = amounts.map { $0.trimmingCharacters(in: .whitespaces) }
        guard let data = try? JSONSerialization.data(withJSONObject: values),
              let json = String(data: data, encoding: .utf8)
        else {
            saveError = "派息记录序列化失败"
            return
        }
        var updated = position
        updated.couponReceived = json
        do {
            _ = try services.savePosition(updated)
        } catch {
            saveError = error.localizedDescription
            return
        }
        // 与桌面端一致：登记派息时补一条 dividend 事件
        if let latest = values.last(where: { !$0.isEmpty }) {
            _ = services.createEvent(position, type: "dividend",
                                     date: dates.last ?? AppDate.todayUTCString(),
                                     description: "派息登记 \(latest)")
        }
        dismiss()
    }
}
