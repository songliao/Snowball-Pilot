import Foundation

/// 持仓核心计算——与桌面端 src/utils/calc.ts 逐函数对齐（数值口径完全一致）。
enum Calc {
    // MARK: - JSON 序列字段解析

    /// 兼容「字符串里嵌 JSON」的双重编码形态（桌面端 parseJsonField）。
    static func parseJSONField(_ raw: String?) -> Any? {
        var value: Any? = raw
        for _ in 0..<3 {
            guard let text = value as? String else { break }
            guard let data = text.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data)
            else { break }
            value = parsed
        }
        return value
    }

    static func stringArray(_ raw: String?) -> [String] {
        guard let array = parseJSONField(raw) as? [Any] else { return [] }
        return array.map { value -> String in
            if let text = value as? String { return text }
            if let number = value as? NSNumber { return number.stringValue }
            return String(describing: value)
        }
    }

    static func numberArray(_ raw: String?) -> [Double] {
        guard let array = parseJSONField(raw) as? [Any] else { return [] }
        return array.compactMap { value in
            if let number = value as? NSNumber { return number.doubleValue }
            if let text = value as? String, let number = Double(text), number.isFinite { return number }
            return nil
        }
    }

    // MARK: - 基础计算

    /// 持有天数：max(0, end.diff(start, 'day'))。
    static func holdingDays(effectiveDate: String, endDate: Date? = nil) -> Int {
        guard let start = AppDate.parse(effectiveDate) else { return 0 }
        let end = endDate ?? Date()
        return max(0, AppDate.truncatedDayCount(from: start, to: end))
    }

    static func knockInPrice(initialPrice: Double, knockInPct: Double) -> Double {
        initialPrice * knockInPct
    }

    static func knockOutPrice(initialPrice: Double, knockOutPct: Double) -> Double {
        initialPrice * knockOutPct
    }

    /// 安全垫 = (当前价 - 敲入价) / 当前价。
    static func safetyMargin(currentPrice: Double, knockInPrice: Double) -> Double {
        guard currentPrice > 0 else { return 0 }
        return (currentPrice - knockInPrice) / currentPrice
    }

    struct PnLResult: Equatable, Codable {
        var pnl: Double
        var pnlRate: Double
        var type: String
    }

    /// 浮动盈亏（口径与桌面端 calcPnL 完全一致）。
    static func pnl(_ position: Position, currentPrice: Double?) -> PnLResult {
        switch position.status {
        case .knockedOut:
            return PnLResult(pnl: 0, pnlRate: 0, type: "已敲出")
        case .knockedIn:
            if let currentPrice, currentPrice > 0, position.initialPrice > 0 {
                let value = position.notional * (currentPrice / position.initialPrice - 1)
                return PnLResult(pnl: value, pnlRate: value / position.notional * 100, type: "敲入浮亏")
            }
            return PnLResult(pnl: 0, pnlRate: 0, type: "敲入待估")
        case .matured:
            if let currentPrice, currentPrice > 0, currentPrice < position.initialPrice, position.initialPrice > 0 {
                let value = position.notional * (currentPrice / position.initialPrice - 1)
                return PnLResult(pnl: value, pnlRate: value / position.notional * 100, type: "到期亏损")
            }
            return PnLResult(pnl: 0, pnlRate: 0, type: "到期收益")
        case .active:
            return PnLResult(pnl: 0, pnlRate: 0, type: "浮动票息")
        }
    }

    /// 距到期天数（可为负）。
    static func daysToMaturity(_ maturityDate: String) -> Int {
        guard let maturity = AppDate.parse(maturityDate) else { return 0 }
        return AppDate.truncatedDayCount(from: Date(), to: maturity)
    }

    static func annualizedReturn(pnlRate: Double, holdingDays: Int) -> Double {
        guard holdingDays > 0 else { return 0 }
        return (pnlRate / 100) * (365.0 / Double(holdingDays)) * 100
    }

    // MARK: - 敲出收益

    struct KnockOutProfitInput: Codable {
        var notional: Double
        var couponPct: Double            // 敲出票息率（百分比，如 15 表示 15%）
        var tradeStartDate: String       // 起息日 YYYY-MM-DD
        var koObservationDate: String    // 敲出观察日 YYYY-MM-DD
        var accrualBasis: String         // both 双含 / one 单含
        var accrualSettleTplus: Int
        var rebateAnnualPct: Double      // 年化后端返息（小数）
        var rebateAbsFrontPct: Double
        var rebateAbsBackPct: Double
        var absFeePct: Double
        var annualFeePct: Double
        var incomeDividendPct: Double
    }

    struct KnockOutProfit: Equatable, Codable {
        var settleDate: String
        var holdingDays: Int
        var holdingYears: Double
        var coupon: Double
        var rebate: Rebate
        var fees: Fees
        var net: Double

        struct Rebate: Equatable, Codable {
            var annual: Double
            var absFront: Double
            var absBack: Double
            var total: Double
        }

        struct Fees: Equatable, Codable {
            var absFee: Double
            var annualFee: Double
            var dividend: Double
            var total: Double
        }
    }

    /// 敲出收益 = 票息 + 返息 - 交易费用（与桌面端 computeKnockOutProfit 一致）。
    static func knockOutProfit(_ input: KnockOutProfitInput) -> KnockOutProfit? {
        guard !input.tradeStartDate.isEmpty, !input.koObservationDate.isEmpty,
              let start = AppDate.parse(input.tradeStartDate),
              let koObs = AppDate.parse(input.koObservationDate)
        else { return nil }

        let settle = AppDate.addTradingDays(from: koObs, n: max(0, input.accrualSettleTplus))
        let rawDays = AppDate.truncatedDayCount(from: start, to: settle)
        // 双含：两端都计入 → +1；单含：计入一端 → 不补
        let holdingDays = max(0, input.accrualBasis == "both" ? rawDays + 1 : rawDays)
        let holdingYears = Double(holdingDays) / 365.0

        let coupon = input.notional * (input.couponPct / 100) * holdingYears

        let rebateAnnual = input.notional * input.rebateAnnualPct * holdingYears
        let rebateAbsFront = input.notional * input.rebateAbsFrontPct
        let rebateAbsBack = input.notional * input.rebateAbsBackPct
        let rebateTotal = rebateAnnual + rebateAbsFront + rebateAbsBack

        let feeAbs = input.notional * input.absFeePct
        let feeAnnual = input.notional * input.annualFeePct * holdingYears
        let feeDividend = coupon * input.incomeDividendPct
        let feeTotal = feeAbs + feeAnnual + feeDividend

        return KnockOutProfit(
            settleDate: AppDate.format(settle),
            holdingDays: holdingDays,
            holdingYears: holdingYears,
            coupon: coupon,
            rebate: KnockOutProfit.Rebate(annual: rebateAnnual, absFront: rebateAbsFront, absBack: rebateAbsBack, total: rebateTotal),
            fees: KnockOutProfit.Fees(absFee: feeAbs, annualFee: feeAnnual, dividend: feeDividend, total: feeTotal),
            net: coupon + rebateTotal - feeTotal
        )
    }

    // MARK: - 预期收益估算

    /// 今天及之后最近敲出观察日的数组下标；无未来观察日返回 nil。
    private static func nearestFutureKnockOutIndex(_ position: Position) -> Int? {
        let dates = stringArray(position.knockOutDates)
        let today = AppDate.startOfToday()

        var nearestIndex = -1
        var nearestDiff = Int.max
        for (index, dateText) in dates.enumerated() {
            guard let date = AppDate.parse(dateText) else { continue }
            let dayStart = AppDate.startOfDay(date)
            guard dayStart >= today else { continue }
            let diff = AppDate.truncatedDayCount(from: today, to: dayStart)
            if diff < nearestDiff {
                nearestDiff = diff
                nearestIndex = index
            }
        }
        guard nearestIndex >= 0, nearestIndex < dates.count else { return nil }
        return nearestIndex
    }

    /// 最近敲出观察日的敲出收益（票息率取当期敲出票息序列）。
    private static func knockOutProfit(_ position: Position) -> KnockOutProfit? {
        guard let nearestIndex = nearestFutureKnockOutIndex(position) else { return nil }
        let dates = stringArray(position.knockOutDates)
        let koCoupons = numberArray(position.knockOutCoupons)
        let nearestCoupon = nearestIndex < koCoupons.count ? koCoupons[nearestIndex] : 0
        return knockOutProfit(KnockOutProfitInput(
            notional: position.notional,
            couponPct: nearestCoupon,
            tradeStartDate: position.tradeStartDate,
            koObservationDate: dates[nearestIndex],
            accrualBasis: position.accrualBasis,
            accrualSettleTplus: position.accrualSettleTplus,
            rebateAnnualPct: position.rebateAnnualPct / 100,
            rebateAbsFrontPct: position.rebateAbsoluteFrontPct / 100,
            rebateAbsBackPct: position.rebateAbsoluteBackPct / 100,
            absFeePct: position.absFeePct / 100,
            annualFeePct: position.annualFeePct / 100,
            incomeDividendPct: position.incomeDividendPct / 100
        ))
    }

    /// 存续合约「预期收益」估算（与桌面端 estimateExpectedProfit 一致）：
    /// - 凤凰：最近一期派息净收益 = 名义本金 × 派息率 × (1 - 收益分红比例)
    /// - 雪球：今天及之后最近敲出观察日的敲出净收益
    /// 返回 nil 表示无法估算。
    static func estimateExpectedProfit(_ position: Position) -> Double? {
        if position.structureType == .phoenix {
            return position.notional * position.couponRate * (1 - position.incomeDividendPct)
        }
        return knockOutProfit(position)?.net
    }

    /// 雪球最近敲出观察日的预估敲出票息（毛票息金额，不含返息与费用）；无法估算返回 nil。
    static func estimateKnockOutCoupon(_ position: Position) -> Double? {
        knockOutProfit(position)?.coupon
    }
}
