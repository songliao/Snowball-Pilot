import SwiftUI

/// 事件日历：月历标注敲出观察日（绿）/派息观察日（蓝），点击查看当日/当月事件。
/// 事件从持仓字段推导（与桌面端 EventCalendar 一致）：已了结合约与早于今天的观察日跳过。
struct EventCalendarView: View {
    @Environment(AppServices.self) private var services

    @State private var monthOffset = 0 // 相对当月的偏移
    @State private var selectedDate: Date?

    /// 事件推导要遍历全部持仓并对每份日期序列做 JSON 解析，开销不小。
    /// 原先是 computed property，42 个日期格各自调用一次 `eventsByDay`（进而全量重算），
    /// 首次进日历页等于把整套推导重复几十轮，主线程直接卡住；这里改为缓存，只在持仓变化时重算。
    @State private var calendarEvents: [CalendarEvent] = []
    @State private var eventsByDay: [String: [CalendarEvent]] = [:]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    calendarCard
                    eventsCard
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .sensoryFeedback(.selection, trigger: selectedDate)
            .navigationTitle("事件日历")
            .navigationDestination(for: Position.self) { position in
                PositionDetailView(position: position)
            }
            // 持仓变化（增删改 / 导入 / 了结）时重新推导，其余重绘走缓存
            .task(id: services.positions) { rebuildEvents() }
        }
    }

    // MARK: - 事件推导

    struct CalendarEvent: Identifiable, Equatable {
        enum Kind: String {
            case knockOut
            case coupon
        }

        let id: String
        let kind: Kind
        let date: Date
        let position: Position
        let barrierPct: Double?   // ko: 障碍百分比
        let couponRatePct: Double? // coupon: 派息率百分比

        var title: String {
            position.productName.isEmpty
                ? (position.contractNo.isEmpty ? "未命名合约" : position.contractNo)
                : position.productName
        }
    }

    private var today: Date { AppDate.startOfToday() }

    private func rebuildEvents() {
        var events: [CalendarEvent] = []
        for position in services.positions {
            guard position.status != .knockedOut, position.status != .matured else { continue }
            let koDates = Calc.stringArray(position.knockOutDates)
            let koBars = Calc.numberArray(position.knockOutBarriers)
            for (index, dateText) in koDates.enumerated() {
                guard let date = AppDate.parse(dateText), date >= today else { continue }
                events.append(CalendarEvent(
                    id: "\(position.unionKey)-ko-\(index)",
                    kind: .knockOut,
                    date: date,
                    position: position,
                    barrierPct: index < koBars.count ? koBars[index] : nil,
                    couponRatePct: nil
                ))
            }
            let couponDates = Calc.stringArray(position.couponDates)
            for (index, dateText) in couponDates.enumerated() {
                guard let date = AppDate.parse(dateText), date >= today else { continue }
                events.append(CalendarEvent(
                    id: "\(position.unionKey)-cp-\(index)",
                    kind: .coupon,
                    date: date,
                    position: position,
                    barrierPct: nil,
                    couponRatePct: position.couponRate * 100
                ))
            }
        }
        calendarEvents = events.sorted { $0.date < $1.date }
        eventsByDay = Dictionary(grouping: calendarEvents) { AppDate.format($0.date) }
    }

    // MARK: - 月历

    private var displayMonth: Date {
        Calendar.current.date(byAdding: .month, value: monthOffset, to: today) ?? today
    }

    /// 42 格（6 周）月历日期，周一起始。
    private var monthCells: [Date] {
        let calendar = Calendar.current
        let firstOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: displayMonth)) ?? today
        let weekday = calendar.component(.weekday, from: firstOfMonth) // 1=周日
        let leading = (weekday + 6) % 7 // 周一为 0
        let gridStart = calendar.date(byAdding: .day, value: -leading, to: firstOfMonth) ?? firstOfMonth
        return (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: gridStart) }
    }

    private var calendarCard: some View {
        VStack(spacing: 10) {
            HStack {
                Button {
                    withAnimation(.snappy) {
                        monthOffset -= 1
                        selectedDate = nil
                    }
                } label: {
                    Image(systemName: "chevron.left")
                }
                Spacer()
                Text(monthTitle)
                    .font(.headline.monospacedDigit())
                    .contentTransition(.numericText())
                Spacer()
                Button {
                    withAnimation(.snappy) {
                        monthOffset += 1
                        selectedDate = nil
                    }
                } label: {
                    Image(systemName: "chevron.right")
                }
            }
            .buttonStyle(.borderless)

            HStack(spacing: 8) {
                Button("今天") { monthOffset = 0; selectedDate = nil }
                    .font(.caption)
                Spacer()
                legendDot(color: .green, label: "敲出观察")
                legendDot(color: .blue, label: "派息观察")
            }

            let weekdayNames = ["一", "二", "三", "四", "五", "六", "日"]
            let todayKey = AppDate.format(today)
            let selectedKey = selectedDate.map { AppDate.format($0) }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 6) {
                ForEach(weekdayNames, id: \.self) { name in
                    Text(name)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                ForEach(monthCells, id: \.self) { cell in
                    dayCell(
                        cell,
                        day: Self.calendar.component(.day, from: cell),
                        inMonth: Self.calendar.isDate(cell, equalTo: displayMonth, toGranularity: .month),
                        events: eventsByDay[AppDate.format(cell)] ?? [],
                        isToday: AppDate.format(cell) == todayKey,
                        isSelected: AppDate.format(cell) == selectedKey
                    )
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
    }

    private var monthTitle: String {
        let components = Calendar.current.dateComponents([.year, .month], from: displayMonth)
        return "\(components.year ?? 0) 年 \(components.month ?? 0) 月"
    }

    private static let calendar = Calendar.current

    private func dayCell(
        _ date: Date,
        day: Int,
        inMonth: Bool,
        events: [CalendarEvent],
        isToday: Bool,
        isSelected: Bool
    ) -> some View {
        return Button {
            withAnimation(.snappy) {
                selectedDate = isSelected ? nil : date
            }
        } label: {
            VStack(spacing: 3) {
                Text("\(day)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(dayTextColor(inMonth: inMonth, isToday: isToday, isSelected: isSelected))
                    .frame(width: 26, height: 26)
                    .background(
                        Circle().fill(isSelected ? Color.accentColor : (isToday ? Color.accentColor.opacity(0.15) : .clear))
                    )
                HStack(spacing: 2) {
                    ForEach(events.prefix(3), id: \.id) { event in
                        Circle()
                            .fill(event.kind == .knockOut ? Color.green : Color.blue)
                            .frame(width: 4, height: 4)
                    }
                    if events.count > 3 {
                        Text("+\(events.count - 3)")
                            .font(.system(size: 7))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    private func dayTextColor(inMonth: Bool, isToday: Bool, isSelected: Bool) -> Color {
        if isSelected { return .white }
        if !inMonth { return Color(.tertiaryLabel) }
        return isToday ? .accent : .primary
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    // MARK: - 事件列表

    private var eventsCard: some View {
        let events = selectedDayEvents
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(listTitle)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if selectedDate != nil {
                    Button("查看整月") { selectedDate = nil }
                        .font(.caption)
                }
            }
            if events.isEmpty {
                Text("暂无事件")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            } else {
                ForEach(events) { event in
                    NavigationLink(value: event.position) {
                        EventRow(event: event)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
    }

    private var selectedDayEvents: [CalendarEvent] {
        if let selectedDate {
            return eventsByDay[AppDate.format(selectedDate)] ?? []
        }
        let prefix = monthPrefix
        return calendarEvents.filter { AppDate.format($0.date).hasPrefix(prefix) }
    }

    private var monthPrefix: String {
        let components = Calendar.current.dateComponents([.year, .month], from: displayMonth)
        return String(format: "%04d-%02d", components.year ?? 0, components.month ?? 0)
    }

    private var listTitle: String {
        if let selectedDate {
            let components = Calendar.current.dateComponents([.month, .day], from: selectedDate)
            return "\(components.month ?? 0) 月 \(components.day ?? 0) 日"
        }
        return "当月"
    }
}

private struct EventRow: View {
    let event: EventCalendarView.CalendarEvent

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(event.kind == .knockOut ? Color.green : Color.blue)
                        .frame(width: 7, height: 7)
                    Text(event.title)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Text(event.position.structureType.label)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(structureColor.opacity(0.12)))
                        .foregroundStyle(structureColor)
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(dayText)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        // 卡片式行（与总览页合约预警行一致），整行可点
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.08)))
        .contentShape(Rectangle())
    }

    private var tint: Color {
        event.kind == .knockOut ? .green : .blue
    }

    private var structureColor: Color {
        event.position.structureType == .snowball ? .purple : .orange
    }

    private var subtitle: String {
        let underlying = event.position.underlyingCode
        if event.kind == .knockOut, let barrier = event.barrierPct {
            return "\(underlying) · 障碍 \(String(format: "%.2f", barrier))%"
        }
        if event.kind == .coupon, let rate = event.couponRatePct {
            return "\(underlying) · 派息率 \(String(format: "%.2f", rate))%"
        }
        return underlying
    }

    private var dayText: String {
        let components = Calendar.current.dateComponents([.month, .day], from: event.date)
        return String(format: "%02d-%02d", components.month ?? 0, components.day ?? 0)
    }
}
