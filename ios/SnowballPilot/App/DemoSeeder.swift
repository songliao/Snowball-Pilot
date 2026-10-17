import Foundation

#if DEBUG
/// 演示模式样例数据（仅 DEBUG 构建）：库为空时注入两笔持仓与 40 天行情，
/// 便于在模拟器中走查全部页面。不影响 Release。
enum DemoSeeder {
    static func seedIfNeeded(_ services: AppServices) {
        guard services.positions.isEmpty,
              let repo = services.userDatabase.prices
        else { return }

        var snowball = Position(structureType: .snowball)
        snowball.productName = "中证1000降敲雪球75-102"
        snowball.broker = "演示券商"
        snowball.contractNo = "DEMO-SB-001"
        snowball.tradeStartDate = recentDateString(-320)
        snowball.underlyingCode = "000852.SH"
        snowball.notional = 2_000_000
        snowball.initialPrice = 5800
        snowball.knockInBarrier = 0.75
        snowball.knockInStrike = 1.0
        snowbookFix(&snowball)
        snowball.marginRatio = 0.12
        snowball.knockOutDates = jsonStrings(datesFromToday(20), datesFromToday(50), datesFromToday(80))
        snowball.knockOutBarriers = "[102,101,100]"
        snowball.knockOutCoupons = "[15.2,16.8,18.5]"
        snowball.knockInObservation = "daily"
        snowball.knockInParticipation = 100
        snowball.maxLossPct = 1
        snowball.rebateAnnualPct = 8.5
        snowball.accrualBasis = "both"
        snowball.accrualSettleTplus = 2
        snowball.absFeePct = 0.15
        snowball.notes = "演示数据（DEBUG 构建）"

        var knockedIn = Position(structureType: .snowball)
        knockedIn.productName = "沪深300雪球（已敲入）"
        knockedIn.broker = "演示券商"
        knockedIn.contractNo = "DEMO-SB-002"
        knockedIn.tradeStartDate = recentDateString(-400)
        knockedIn.underlyingCode = "000300.SH"
        knockedIn.notional = 1_000_000
        knockedIn.initialPrice = 3900
        knockedIn.knockInBarrier = 0.8
        knockedIn.marginRatio = 0.2
        knockedIn.knockOutDates = jsonStrings(datesFromToday(35), datesFromToday(95))
        knockedIn.knockOutBarriers = "[103,100]"
        knockedIn.knockOutCoupons = "[12,15]"
        knockedIn.status = .knockedIn
        knockedIn.isKi = true
        knockedIn.knockInDate = recentDateString(-12)

        var phoenix = Position(structureType: .phoenix)
        phoenix.productName = "凤凰DCN季度派息"
        phoenix.broker = "演示期货"
        phoenix.contractNo = "DEMO-PH-001"
        phoenix.tradeStartDate = recentDateString(-200)
        phoenix.underlyingCode = "000905.SH"
        phoenix.notional = 1_500_000
        phoenix.initialPrice = 4600
        phoenix.knockInBarrier = 0.7
        phoenix.marginRatio = 0.2
        phoenix.knockOutDates = jsonStrings(datesFromToday(60), datesFromToday(120))
        phoenix.knockOutBarriers = "[103,100]"
        phoenix.couponBarrier = 0.95
        phoenix.couponDates = jsonStrings(datesFromToday(6), datesFromToday(30), datesFromToday(66))
        phoenix.couponRate = 0.042
        phoenix.incomeDividendPct = 0.05

        for position in [snowball, knockedIn, phoenix] {
            _ = try? services.userDatabase.positions?.create(position)
        }

        // 行情历史：三大指数近 40 个交易日
        let codes = ["000852.SH", "000300.SH", "000905.SH"]
        let basePrices = ["000852.SH": 5750.0, "000300.SH": 3820.0, "000905.SH": 4550.0]
        let calendar = Calendar.current
        for code in codes {
            guard let base = basePrices[code] else { continue }
            var day = today()
            var count = 0
            var price = base
            while count < 40 {
                let weekday = calendar.component(.weekday, from: day)
                if weekday != 1 && weekday != 7 {
                    let drift = sin(Double(count) * 0.7) * base * 0.008
                    price = base + drift
                    let point = PricePoint(
                        id: 0, underlyingCode: code, price: (price * 100).rounded() / 100,
                        date: AppDate.format(day), source: "auto",
                        open: price - 5, high: price + 18, low: price - 22, volume: 8_000_000
                    )
                    _ = try? repo.upsert(point)
                    count += 1
                }
                guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
                day = previous
            }
        }

        services.reloadPositions()
        services.loadStoredPrices()
    }

    private static func snowbookFix(_ position: inout Position) {
        position.knockOutEnhanceParticipation = 0
        position.maturityCoupon = 0.025
    }

    private static func today() -> Date {
        AppDate.startOfToday()
    }

    private static func datesFromToday(_ offset: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: today()) ?? today()
        return AppDate.format(date)
    }

    private static func recentDateString(_ offset: Int) -> String {
        datesFromToday(offset)
    }

    private static func jsonStrings(_ values: String...) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: values),
              let json = String(data: data, encoding: .utf8)
        else { return "[]" }
        return json
    }
}
#endif
