import SwiftUI

/// 表单与 DB 之间的序列字段转换（JSON 数组文本），与桌面端 PositionForm 一致。
enum FormLists {
    /// 字符串数组 → JSON 字符串数组文本。
    static func stringsJSON(_ items: [String]) -> String {
        guard !items.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: items),
              let json = String(data: data, encoding: .utf8)
        else { return "" }
        return json
    }

    /// 数值数组 → JSON 数值数组文本。
    static func numbersJSON(_ items: [Double]) -> String {
        guard !items.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: items),
              let json = String(data: data, encoding: .utf8)
        else { return "" }
        return json
    }

    /// 输入行清洗：去 %、千分位与空白。
    static func cleanNumber(_ text: String) -> String {
        text.replacingOccurrences(of: "%", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
    }
}

/// 合约录入 / 编辑表单（雪球、凤凰两套专属字段 + 粘贴要素文本自动解析）。
struct PositionFormView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss

    let editing: Position?

    @State private var position = Position()
    @State private var isNew = true
    @State private var showingPasteSheet = false
    @State private var pasteText = ""
    @State private var parseWarnings: [String]?
    @State private var errorMessage: String?
    @State private var saving = false

    // 敲出条款逐行编辑：一行 = 观察日 + 障碍（%）+ 票息（%，仅雪球）
    struct ObservationRow: Identifiable {
        let id = UUID()
        var date: Date = AppDate.startOfToday()
        var barrierText = ""
        var couponText = ""
    }

    // 派息观察日逐行编辑
    struct DateRow: Identifiable {
        let id = UUID()
        var date: Date
    }

    @State private var knockOutRows: [ObservationRow] = []
    @State private var couponRows: [DateRow] = []
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                pasteImportSection
                basicSection
                termsSection
                knockOutSection
                if position.structureType == .phoenix {
                    phoenixSection
                }
                rebateSection
                tradeFeeSection
                notesSection
            }
            .navigationTitle(isNew ? "录入合约" : "编辑合约")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("保存") { Task { await save() } }
                            .disabled(position.underlyingCode.isEmpty || position.notional <= 0)
                    }
                }
            }
            .sheet(isPresented: $showingPasteSheet) { pasteSheet }
            .alert("部分字段已忽略", isPresented: Binding(
                get: { parseWarnings != nil },
                set: { if !$0 { parseWarnings = nil } }
            )) {
                Button("知道了") { parseWarnings = nil }
            } message: {
                Text("以下字段未映射到表单：\n" + (parseWarnings ?? []).prefix(6).joined(separator: "、"))
            }
            .alert("保存失败", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好的") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .task {
                guard !loaded else { return }
                loaded = true
                loadEditing()
            }
        }
    }

    // MARK: - 分区

    private var pasteImportSection: some View {
        Section {
            Button {
                // 每次打开都是空编辑框，取消后重开不残留上次的文本。
                pasteText = ""
                showingPasteSheet = true
            } label: {
                Label("粘贴合约要素文本自动填充", systemImage: "doc.on.clipboard")
            }
        } footer: {
            Text("支持券商导出的标准要素文本，自动识别结构与字段")
        }
    }

    private var basicSection: some View {
        Section("基本信息") {
            Picker("结构类型", selection: Binding(
                get: { position.structureType },
                set: { position.structureType = $0 }
            )) {
                ForEach(StructureType.allCases) { type in
                    Text(type.label).tag(type)
                }
            }
            .disabled(!isNew)

            LabeledTextField("产品名称", text: $position.productName, placeholder: "选填")
            LabeledTextField("券商 / 交易对手", text: $position.broker, placeholder: "选填")
            LabeledTextField("合约编号", text: $position.contractNo, placeholder: "选填")
        }
    }

    /// 要素分组与详情页「基础条款」一致：起息日、标的、本金、期初价、保证金/风控、敲入参数（雪球另有红利票息/增强参与率）。
    private var termsSection: some View {
        Section("基础条款") {
            DatePicker(
                "起息日",
                selection: dateStringBinding($position.tradeStartDate),
                displayedComponents: .date
            )
            LabeledTextField("标的代码", text: $position.underlyingCode, placeholder: "如 000852.SH")
                .onSubmit { position.underlyingCode = position.underlyingCode.uppercased() }
            NumberField("名义本金", value: $position.notional)
            NumberField("期初价格", value: $position.initialPrice)
            PercentField("保证金比例", decimal: $position.marginRatio)
            PercentField("最大亏损", decimal: $position.maxLossPct, allowZero: true)
            Picker("敲入观察", selection: $position.knockInObservation) {
                Text("每日观察").tag("daily")
                Text("到期观察").tag("maturity")
            }
            PercentField("敲入障碍", decimal: $position.knockInBarrier)
            PercentField("敲入执行价", decimal: $position.knockInStrike, allowZero: false, defaultValue: 100)
            PercentField("敲入参与率", decimal: $position.knockInParticipation, allowZero: false, defaultValue: 100)
            if position.structureType == .snowball {
                PercentField("红利票息", decimal: $position.maturityCoupon, allowZero: true)
                PercentField("敲出增强参与率", decimal: $position.knockOutEnhanceParticipation, allowZero: true)
            }
        }
    }

    private var knockOutSection: some View {
        Section {
            ForEach($knockOutRows) { $row in
                observationRowEditor($row)
            }
            .onDelete { knockOutRows.remove(atOffsets: $0) }

            Button {
                knockOutRows.append(ObservationRow(date: suggestedDate(from: knockOutRows.map(\.date))))
            } label: {
                Label("添加观察日", systemImage: "plus.circle")
            }
        } header: {
            Text("敲出条款")
        } footer: {
            Text(position.structureType == .snowball
                 ? "每行一组：观察日、障碍价格（%）与票息（%）一一对应，左滑删除"
                 : "每行一组：观察日与障碍价格（%）一一对应，左滑删除")
        }
    }

    @ViewBuilder
    private func observationRowEditor(_ row: Binding<ObservationRow>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DatePicker("观察日", selection: row.date, displayedComponents: .date)
            HStack(spacing: 8) {
                Text("障碍价格（%）")
                Spacer()
                TextField("如 102", text: row.barrierText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 90)
            }
            .font(.subheadline)
            if position.structureType == .snowball {
                HStack(spacing: 8) {
                    Text("票息（%）")
                    Spacer()
                    TextField("如 5", text: row.couponText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)
                }
                .font(.subheadline)
            }
        }
        .padding(.vertical, 2)
    }

    private var rebateSection: some View {
        Section("返息与费用") {
            PercentField("年化后端返息", decimal: $position.rebateAnnualPct, allowZero: true)
            PercentField("绝对后端返息", decimal: $position.rebateAbsoluteBackPct, allowZero: true)
            PercentField("绝对前端返息", decimal: $position.rebateAbsoluteFrontPct, allowZero: true)
            Picker("计息规则", selection: $position.accrualBasis) {
                Text("双含").tag("both")
                Text("单含").tag("one")
            }
            Stepper("计息结算 T+\(position.accrualSettleTplus)", value: $position.accrualSettleTplus, in: 0...10)
        }
    }

    private var tradeFeeSection: some View {
        Section("交易费用") {
            PercentField("交易佣金（绝对）", decimal: $position.absFeePct, allowZero: true)
            PercentField("年化费用", decimal: $position.annualFeePct, allowZero: true)
            PercentField("收益分红", decimal: $position.incomeDividendPct, allowZero: true)
        }
    }

    private var phoenixSection: some View {
        Section {
            PercentField("派息障碍", decimal: $position.couponBarrier)
            PercentField("派息率", decimal: $position.couponRate)
            ForEach($couponRows) { $row in
                DatePicker("派息观察日", selection: $row.date, displayedComponents: .date)
            }
            .onDelete { couponRows.remove(atOffsets: $0) }
            Button {
                couponRows.append(DateRow(date: suggestedDate(from: couponRows.map(\.date))))
            } label: {
                Label("添加派息观察日", systemImage: "plus.circle")
            }
        } header: {
            Text("派息条款")
        } footer: {
            Text("派息率适用于全部派息观察日，左滑删除单行")
        }
    }

    private var notesSection: some View {
        Section("备注") {
            TextField("备注信息", text: $position.notes, axis: .vertical)
                .lineLimit(2...5)
        }
    }

    /// 新增行的建议日期：最后一行 + 1 个月，否则今天。
    private func suggestedDate(from dates: [Date]) -> Date {
        if let last = dates.max() {
            return Calendar.current.date(byAdding: .month, value: 1, to: last) ?? last
        }
        return AppDate.startOfToday()
    }

    // MARK: - 粘贴解析

    /// 粘贴文本去空白后是否为空（与「解析填充」按钮的启用条件一致）。
    private var pasteIsEmpty: Bool {
        pasteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var pasteSheet: some View {
        NavigationStack {
            TextEditor(text: $pasteText)
                .font(.footnote.monospaced())
                .padding(8)
                .navigationTitle("粘贴合约文本")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { showingPasteSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("解析填充") { applyPaste() }
                            .disabled(pasteIsEmpty)
                    }
                }
        }
        .presentationDetents([.large])
    }

    private func applyPaste() {
        let parsed = ContractParser.parse(pasteText)
        if parsed.structureType == .phoenix { position.structureType = .phoenix }
        ContractParser.apply(parsed, to: &position)
        knockOutRows = observationRows(datesText: parsed.knockOutDates ?? "",
                                       barriersText: parsed.knockOutBarriers,
                                       couponsText: parsed.knockOutCoupons)
        couponRows = dateRows(from: parsed.couponDates)
        showingPasteSheet = false
        if !parsed.warnings.isEmpty {
            parseWarnings = parsed.warnings
        }
    }

    /// 多行日期/障碍/票息文本 → 逐行编辑数据（按行号一一对应，缺项留空）。
    private func observationRows(datesText: String, barriersText: String?, couponsText: String?) -> [ObservationRow] {
        let dates = textLines(datesText)
        guard !dates.isEmpty else { return [] }
        let barriers = textLines(barriersText ?? "")
        let coupons = textLines(couponsText ?? "")
        return dates.enumerated().map { index, line in
            ObservationRow(
                date: AppDate.parse(line) ?? AppDate.startOfToday(),
                barrierText: index < barriers.count ? barriers[index] : "",
                couponText: index < coupons.count ? coupons[index] : ""
            )
        }
    }

    private func dateRows(from text: String?) -> [DateRow] {
        textLines(text ?? "").compactMap { line in
            AppDate.parse(line).map(DateRow.init)
        }
    }

    private func textLines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    // MARK: - 装载与保存

    private func loadEditing() {
        guard let editing else {
            // 新建合约：预置一行空的敲出观察日
            if knockOutRows.isEmpty {
                knockOutRows.append(ObservationRow())
            }
            return
        }
        position = editing
        isNew = false
        let barriers = Calc.numberArray(editing.knockOutBarriers)
        let coupons = Calc.numberArray(editing.knockOutCoupons)
        knockOutRows = Calc.stringArray(editing.knockOutDates).enumerated().map { index, text in
            ObservationRow(
                date: AppDate.parse(text) ?? AppDate.startOfToday(),
                barrierText: index < barriers.count ? CSV.jsNumber(barriers[index]) : "",
                couponText: index < coupons.count ? CSV.jsNumber(coupons[index]) : ""
            )
        }
        couponRows = Calc.stringArray(editing.couponDates).map { text in
            DateRow(date: AppDate.parse(text) ?? AppDate.startOfToday())
        }
    }

    private func save() async {
        position.knockOutDates = FormLists.stringsJSON(knockOutRows.map { AppDate.format($0.date) })
        position.knockOutBarriers = FormLists.numbersJSON(knockOutRows.map {
            Double(FormLists.cleanNumber($0.barrierText)) ?? 0
        })
        position.knockOutCoupons = position.structureType == .snowball
            ? FormLists.numbersJSON(knockOutRows.map { Double(FormLists.cleanNumber($0.couponText)) ?? 0 })
            : ""
        position.couponDates = FormLists.stringsJSON(couponRows.map { AppDate.format($0.date) })

        saving = true
        defer { saving = false }
        do {
            _ = try services.savePosition(position)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - 字段组件

/// 文本字段（紧凑行样式）。
struct LabeledTextField: View {
    let title: String
    @Binding var text: String
    var placeholder = ""

    init(_ title: String, text: Binding<String>, placeholder: String = "") {
        self.title = title
        self._text = text
        self.placeholder = placeholder
    }

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField(placeholder.isEmpty ? title : placeholder, text: $text)
                .multilineTextAlignment(.trailing)
                .foregroundColor(.secondary)
        }
    }
}

/// 数值字段（DB 小数直存）。
struct NumberField: View {
    let title: String
    @Binding var value: Double
    @State private var text = ""
    @FocusState private var focused: Bool

    init(_ title: String, value: Binding<Double>) {
        self.title = title
        self._value = value
    }

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .focused($focused)
                .frame(width: 140)
                .onChange(of: text) { _, newText in
                    if let parsed = Double(newText) { value = parsed }
                }
                .onChange(of: value) { _, newValue in
                    if !focused, let parsed = Double(text), parsed == newValue { return }
                    if !focused { text = CSV.jsNumber(newValue) }
                }
                .onAppear { text = value == 0 ? "" : CSV.jsNumber(value) }
        }
    }
}

/// 百分比字段：DB 存小数（0.75），输入显示百分比（75）。
struct PercentField: View {
    let title: String
    @Binding var decimal: Double
    var allowZero = false
    var defaultValue = 0.0

    @State private var text = ""
    @FocusState private var focused: Bool

    init(_ title: String, decimal: Binding<Double>, allowZero: Bool = false, defaultValue: Double = 0) {
        self.title = title
        self._decimal = decimal
        self.allowZero = allowZero
        self.defaultValue = defaultValue
    }

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            HStack(spacing: 2) {
                TextField(allowZero ? "0" : "100", text: $text)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .focused($focused)
                    .frame(width: 90)
                Text("%")
                    .foregroundStyle(.secondary)
            }
            .onChange(of: text) { _, newText in
                if let parsed = Double(newText) {
                    decimal = parsed / 100
                }
            }
            .onChange(of: decimal) { _, newValue in
                let percent = newValue * 100
                if !focused, let parsed = Double(text), abs(parsed - percent) < 0.0001 { return }
                if !focused { text = CSV.jsNumber(percent) }
            }
            .onAppear {
                let percent = decimal * 100
                text = percent == 0 && allowZero ? "" : CSV.jsNumber(percent)
            }
        }
    }
}

/// DatePicker ↔ "YYYY-MM-DD" 字符串绑定。
private func dateStringBinding(_ binding: Binding<String>) -> Binding<Date> {
    Binding<Date>(
        get: { AppDate.parse(binding.wrappedValue) ?? Date() },
        set: { binding.wrappedValue = AppDate.format($0) }
    )
}
