import SwiftUI
import Charts

/// 持仓分析：按标的/结构的名义本金环形图 + 风险散点图（只统计存续中合约）。
struct PositionAnalysisView: View {
    @Environment(AppServices.self) private var services

    @AppStorage("position-analysis-code") private var selectedCode = "__all__"
    @AppStorage("position-analysis-xmode") private var xMode = "pct"
    @State private var refreshing = false

    enum XMode: String, CaseIterable, Identifiable {
        case point
        case pct
        var id: String { rawValue }
        var label: String { self == .point ? "价格点位" : "相对现价%" }
    }

    private var activePositions: [Position] {
        services.positions.filter { $0.status == .active }
    }

    var body: some View {
        List {
            if activePositions.isEmpty {
                ContentUnavailableView("暂无存续合约", systemImage: "chart.pie")
            } else {
                donutSection
                scatterSection
            }
        }
        .navigationTitle("持仓分析")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refreshPrices() }
                } label: {
                    if refreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
            }
        }
        .task { await refreshPrices() }
    }

    private func refreshPrices() async {
        refreshing = true
        await services.refreshAlertPrices()
        refreshing = false
    }

    // MARK: - 环形图

    private var donutSection: some View {
        let total = activePositions.reduce(0.0) { $0 + $1.notional }
        let byUnderlying = aggregate(\.underlyingCode)
        let byStructure = aggregate { $0.structureType.label }
        return Section("名义本金分布") {
            HStack(alignment: .center, spacing: 16) {
                DonutChart(slices: byUnderlying, centerTitle: "按标的")
                    .frame(width: 150, height: 150)
                DonutChart(slices: byStructure, centerTitle: "按结构")
                    .frame(width: 150, height: 150)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)

            ForEach(Array(byUnderlying.prefix(6).enumerated()), id: \.offset) { index, slice in
                LabeledContent {
                    Text("\(Format.money(slice.value)) · \(total > 0 ? String(format: "%.1f%%", slice.value / total * 100) : "-")")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                } label: {
                    HStack(spacing: 6) {
                        Circle().fill(DonutPalette.color(index)).frame(width: 8, height: 8)
                        Text(slice.label)
                            .font(.caption)
                    }
                }
            }
        }
    }

    private func aggregate(_ keyPath: KeyPath<Position, String>) -> [DonutSlice] {
        aggregate { $0[keyPath: keyPath] }
    }

    private func aggregate(_ key: (Position) -> String) -> [DonutSlice] {
        var groups: [String: Double] = [:]
        for position in activePositions {
            let key = key(position).isEmpty ? "未指定" : key(position)
            groups[key, default: 0] += position.notional
        }
        return groups
            .map { DonutSlice(label: $0.key, value: $0.value) }
            .sorted { $0.value > $1.value }
    }

    // MARK: - 风险散点

    struct ScatterPoint: Identifiable {
        let id: String
        let x: Double
        let y: Double
        let sizeValue: Double
        let radius: Double
        let kind: Kind

        enum Kind {
            case knockOut
            case couponBarrier
            case knockIn
        }
    }

    private var scatterSection: some View {
        let codes = Array(Set(activePositions.map(\.underlyingCode))).sorted()
        let effectiveCode = codes.contains(selectedCode) ? selectedCode : "__all__"
        let scoped = effectiveCode == "__all__"
            ? activePositions
            : activePositions.filter { $0.underlyingCode == effectiveCode }
        let points = scatterPoints(for: scoped)

        return Section("风险分布") {
            Picker("标的", selection: Binding(
                get: { effectiveCode },
                set: { selectedCode = $0 }
            )) {
                Text("全部标的").tag("__all__")
                ForEach(codes, id: \.self) { code in
                    Text(code).tag(code)
                }
            }
            Picker("横轴模式", selection: $xMode) {
                ForEach(XMode.allCases) { mode in
                    Text(mode.label).tag(mode.rawValue)
                }
            }
            .pickerStyle(.segmented)

            if points.isEmpty {
                Text("所选范围内无可绘制数据（缺行情或敲出参数）")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            } else {
                scatterChart(points)
                    .frame(height: 320)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 8))
            }

            legendRows
        }
    }

    private func scatterPoints(for positions: [Position]) -> [ScatterPoint] {
        var result: [ScatterPoint] = []
        var sizeValues: [Double] = []
        var prepared: [(position: Position, x: Double, y: Double, size: Double, kind: ScatterPoint.Kind)] = []

        for position in positions {
            let latest = services.latestPrices[position.underlyingCode] ?? position.initialPrice
            guard latest > 0 else { continue }
            let expected = max(0, Calc.estimateExpectedProfit(position) ?? 0)

            // 敲出点：barriers[0] 即最近观察日障碍（数组序 = 时间正序）
            let barriers = Calc.numberArray(position.knockOutBarriers)
            if let firstBarrier = barriers.first, firstBarrier > 0 {
                let koPrice = position.initialPrice * firstBarrier / 100
                let x = xValue(koPrice, latest)
                if let x {
                    prepared.append((position, x, position.notional, expected, .knockOut))
                    sizeValues.append(expected)
                }
            }
            // 凤凰派息障碍点
            if position.structureType == .phoenix, position.couponBarrier > 0 {
                let cpPrice = position.initialPrice * position.couponBarrier
                if let x = xValue(cpPrice, latest) {
                    prepared.append((position, x, position.notional, expected, .couponBarrier))
                    sizeValues.append(expected)
                }
            }
            // 敲入柱
            if position.knockInBarrier > 0 {
                let kiPrice = position.initialPrice * position.knockInBarrier
                if let x = xValue(kiPrice, latest) {
                    let loss = position.notional * position.maxLossPct
                    prepared.append((position, x, loss, 0, .knockIn))
                }
            }
        }

        let maxSize = max(sizeValues.max() ?? 0, 1)
        for (index, item) in prepared.enumerated() {
            let radius = item.kind == .knockIn ? 5 : 8 + 34 * (item.size / maxSize).squareRoot()
            result.append(ScatterPoint(
                id: "\(item.position.id)-\(item.position.structureType.rawValue)-\(index)",
                x: item.x,
                y: item.y,
                sizeValue: item.size,
                radius: radius,
                kind: item.kind
            ))
        }
        return result
    }

    private func xValue(_ price: Double, _ latest: Double) -> Double? {
        if xMode == "pct" {
            return price / latest * 100
        }
        return price
    }

    @ViewBuilder
    private func scatterChart(_ points: [ScatterPoint]) -> some View {
        let xDomain = xAxisDomain(points)
        // 顶部留 12% 余量：最大名义本金的气泡不被绘图区上缘裁掉
        let yMax = (points.map(\.y).max() ?? 1) * 1.12 + 1
        Chart {
            // 现价参考线
            let effectiveCode = codes.contains(selectedCode) ? selectedCode : "__all__"
            if effectiveCode != "__all__", let latest = services.latestPrices[effectiveCode] {
                RuleMark(x: .value("现价", xMode == "pct" ? 100.0 : latest))
                    .foregroundStyle(Color.red)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(position: .top) {
                        Text(xMode == "pct" ? "现价 100%" : "现价 \(String(format: "%.0f", latest))")
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
            }
            ForEach(points) { point in
                switch point.kind {
                case .knockIn:
                    BarMark(
                        x: .value("障碍", point.x),
                        yStart: .value("0", 0),
                        yEnd: .value("最大亏损", point.y),
                        width: .fixed(10)
                    )
                    .foregroundStyle(Color.gray.opacity(0.65))
                case .knockOut:
                    PointMark(
                        x: .value("障碍", point.x),
                        y: .value("名义本金", point.y)
                    )
                    .symbolSize(point.radius * point.radius)
                    .foregroundStyle(Color.accentColor.opacity(0.85))
                case .couponBarrier:
                    PointMark(
                        x: .value("障碍", point.x),
                        y: .value("名义本金", point.y)
                    )
                    .symbol(.triangle)
                    .symbolSize(point.radius * point.radius)
                    .foregroundStyle(Color.blue.opacity(0.85))
                }
            }
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: 0...yMax)
        .chartPlotStyle { plot in
            plot.background(Color(.secondarySystemBackground))
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6))
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 5)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(Format.money(number))
                            .font(.caption2)
                    }
                }
            }
        }
    }

    private var codes: [String] {
        Array(Set(activePositions.map(\.underlyingCode))).sorted()
    }

    private func xAxisDomain(_ points: [ScatterPoint]) -> ClosedRange<Double> {
        let xs = points.map(\.x)
        let lo = (xs.min() ?? 0)
        let hi = (xs.max() ?? 1)
        // 两侧各留 15%：最大气泡半径（约 42pt ≈ 绘图宽度的 13%）不越出绘图区被裁剪
        let pad = (hi - lo) * 0.15 + 0.5
        return max(0, lo - pad)...(hi + pad)
    }

    private var legendRows: some View {
        VStack(alignment: .leading, spacing: 6) {
            legendItem(color: .accent, shape: "circle.fill", text: "敲出障碍（气泡 = 预期收益）")
            legendItem(color: .blue, shape: "triangle.fill", text: "派息障碍（凤凰）")
            legendItem(color: .gray, shape: "rectangle.fill", text: "敲入障碍（柱高 = 最大亏损）")
            legendItem(color: .red, shape: "line.diagonal", text: "现价参考线")
        }
        .padding(.vertical, 4)
    }

    private func legendItem(color: Color, shape: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: shape)
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 16)
            Text(text).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// MARK: - 环形图组件（Canvas 实现，iOS 17 可用）

struct DonutSlice: Identifiable, Equatable {
    let label: String
    let value: Double
    var id: String { label }
}

enum DonutPalette {
    static let colors: [Color] = [
        Color(red: 0.42, green: 0.55, blue: 0.95),
        Color(red: 0.95, green: 0.62, blue: 0.35),
        Color(red: 0.36, green: 0.78, blue: 0.55),
        Color(red: 0.85, green: 0.45, blue: 0.75),
        Color(red: 0.55, green: 0.78, blue: 0.85),
        Color(red: 0.95, green: 0.80, blue: 0.42),
        Color(red: 0.62, green: 0.62, blue: 0.70),
    ]

    static func color(_ index: Int) -> Color {
        colors[index % colors.count]
    }

    static func structureColor(_ label: String) -> Color {
        label == "雪球" ? Color(red: 0.49, green: 0.23, blue: 0.93) : Color(red: 0.76, green: 0.25, blue: 0.05)
    }
}

struct DonutChart: View {
    let slices: [DonutSlice]
    let centerTitle: String

    var body: some View {
        let total = slices.reduce(0) { $0 + $1.value }
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let outer = min(size.width, size.height) / 2
            let inner = outer * 0.62
            guard total > 0 else {
                context.stroke(
                    Path(ellipseIn: CGRect(x: center.x - outer, y: center.y - outer,
                                           width: outer * 2, height: outer * 2)),
                    with: .color(.secondary.opacity(0.2)), lineWidth: 1
                )
                return
            }
            var startAngle = Angle.degrees(-90)
            for (index, slice) in slices.enumerated() {
                let sweep = Angle.degrees(slice.value / total * 360)
                let endAngle = startAngle + sweep
                var path = Path()
                path.addArc(center: center, radius: outer,
                            startAngle: startAngle, endAngle: endAngle, clockwise: false)
                path.addArc(center: center, radius: inner,
                            startAngle: endAngle, endAngle: startAngle, clockwise: true)
                path.closeSubpath()
                let color = slices.count == 1
                    ? (slice.label == "雪球" || slice.label == "凤凰"
                        ? DonutPalette.structureColor(slice.label)
                        : DonutPalette.color(index))
                    : DonutPalette.color(index)
                context.fill(path, with: .color(color))
                startAngle = endAngle
            }
        }
        .overlay {
            VStack(spacing: 2) {
                Text(centerTitle)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text(Format.money(total))
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
    }
}
