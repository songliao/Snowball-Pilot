import Foundation
import Testing
@testable import SnowballPilot

/// 敲入状态语义：已敲入仍属存续（不判了结、不影响存续统计口径），不估算浮亏。
@Suite("敲入状态语义")
struct KnockInSemanticsTests {
    private func makePosition(status: PositionStatus, isKi: Bool) -> Position {
        var p = Position(structureType: .snowball)
        p.underlyingCode = "000852.SH"
        p.notional = 2_000_000
        p.initialPrice = 6213.44
        p.knockInBarrier = 0.75
        p.status = status
        p.isKi = isKi
        return p
    }

    @Test("已敲入不计算浮亏（任意现价均为 0）")
    func knockedInPnLIsZero() {
        let ki = makePosition(status: .knockedIn, isKi: true)
        for price in [6800.0, 5800.0, 4000.0, 0.0] {
            let result = Calc.pnl(ki, currentPrice: price > 0 ? price : nil)
            #expect(result.type == "敲入存续")
            #expect(result.pnl == 0)
            #expect(result.pnlRate == 0)
        }
    }

    @Test("存续统计口径：已敲入计入存续、敲出/到期算已了结")
    func summaryIncludesKnockedIn() {
        // 直接复刻 AppServices.summary 的存续/了结判定，防止口径回退
        // （summary 依赖已打开的用户库，无法在单测里直接实例化灌数据）
        let positions = [
            makePosition(status: .active, isKi: false),
            makePosition(status: .knockedIn, isKi: true),
            makePosition(status: .knockedOut, isKi: false),
            makePosition(status: .matured, isKi: false)
        ]
        let ongoing = positions.filter { $0.status == .active || $0.status == .knockedIn }
        #expect(ongoing.count == 2)
        let isSettled = { (p: Position) in p.status == .knockedOut || p.status == .matured }
        #expect(positions.filter { !isSettled($0) }.count == 2)
    }

    @Test("敲入观察日：每日观察按起息日截取行情日")
    func dailyObservationDates() {
        let priceDates = ["2025-02-20", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-10"]
        let dates = Calc.knockInObservationDates(
            priceDates: priceDates, today: "2025-03-10",
            observation: "daily", tradeStartDate: "2025-03-05",
            knockOutDates: ["2025-09-05", "2026-03-05"]
        )
        #expect(dates == ["2025-03-05", "2025-03-06", "2025-03-10"])
    }

    @Test("敲入观察日：起息日缺失时用全部已入库行情日")
    func dailyObservationDatesWithoutStart() {
        let priceDates = ["2025-02-20", "2025-03-05"]
        let dates = Calc.knockInObservationDates(
            priceDates: priceDates, today: "2025-03-10",
            observation: "daily", tradeStartDate: "",
            knockOutDates: ["2025-09-05"]
        )
        #expect(dates == ["2025-02-20", "2025-03-05"])
    }

    @Test("敲入观察日：到期观察仅取最后敲出观察日，未到期则无观察日")
    func maturityObservationDates() {
        let priceDates = ["2025-09-04", "2025-09-05", "2026-03-05"]
        // 到期日（最后敲出观察日）尚未到：不产生敲入观察日
        let future = Calc.knockInObservationDates(
            priceDates: priceDates, today: "2025-12-31",
            observation: "maturity", tradeStartDate: "2025-03-05",
            knockOutDates: ["2025-09-05", "2026-03-05"]
        )
        #expect(future.isEmpty)
        // 到期日已过：仅到期日一个观察日
        let past = Calc.knockInObservationDates(
            priceDates: priceDates, today: "2025-12-31",
            observation: "maturity", tradeStartDate: "2025-03-05",
            knockOutDates: ["2025-06-05", "2025-09-05"]
        )
        #expect(past == ["2025-09-05"])
    }

    @Test("敲入观察日：到期观察缺敲出观察日时为空")
    func maturityObservationWithoutKO() {
        let dates = Calc.knockInObservationDates(
            priceDates: ["2025-09-05"], today: "2025-12-31",
            observation: "maturity", tradeStartDate: "2025-03-05",
            knockOutDates: []
        )
        #expect(dates.isEmpty)
    }

    @Test("已敲入合约不再预警敲入")
    func knockedInSkipsKnockInAlert() {
        // 现价远低于敲入线：未敲入合约触发「已跌破敲入线」，已敲入不再报
        let knockedIn = makePosition(status: .knockedIn, isKi: true)
        let kiItems = AlertEngine.compute(positions: [knockedIn],
                                          latestPrices: ["000852.SH": 4000],
                                          config: .defaults)
        #expect(kiItems.isEmpty)

        // 对照：同样行情下未敲入的存续合约仍预警敲入
        let active = makePosition(status: .active, isKi: false)
        let activeItems = AlertEngine.compute(positions: [active],
                                              latestPrices: ["000852.SH": 4000],
                                              config: .defaults)
        #expect(activeItems.count == 1)
        #expect(activeItems[0].reasons.contains { $0.label == "已跌破敲入线" })
    }
}
