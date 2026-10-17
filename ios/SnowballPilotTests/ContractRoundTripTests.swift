import Testing
import Foundation
@testable import SnowballPilot

/// 「复制合约」→「粘贴回填」互逆性：makeText → parse → apply 后各字段与原持仓一致。
struct ContractRoundTripTests {
    private let epsilon = 1e-9

    /// 解析结果里的多行序列文本 → 行数组（过滤空行）。
    private func lines(_ text: String?) -> [String] {
        (text ?? "")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    @Test func snowballRoundTrip() {
        var position = Position(structureType: .snowball)
        position.productName = "中证500雪球A"
        position.contractNo = "XS2026-001"
        position.broker = "某某证券"
        position.underlyingCode = "000905.SH"
        position.notional = 2_000_000
        position.tradeStartDate = "2026-01-08"
        position.initialPrice = 4321.56
        position.marginRatio = 0.12
        position.maxLossPct = 0.08
        position.knockOutDates = FormLists.stringsJSON(["2026-04-08", "2026-07-08", "2026-10-08"])
        position.knockOutBarriers = FormLists.numbersJSON([103, 102.5, 101])
        position.knockOutCoupons = FormLists.numbersJSON([1.65, 1.7, 1.75])
        position.maturityCoupon = 0.025
        position.knockOutEnhanceParticipation = 0.05
        position.knockInBarrier = 0.8
        position.knockInObservation = "daily"
        position.knockInStrike = 1.0
        position.knockInParticipation = 1.0
        position.rebateAnnualPct = 0.02
        position.rebateAbsoluteBackPct = 0.015
        position.rebateAbsoluteFrontPct = 0.01
        position.accrualBasis = "both"
        position.accrualSettleTplus = 3
        position.absFeePct = 0.0005
        position.annualFeePct = 0.012
        position.incomeDividendPct = 0.003
        position.notes = "逐月对账，风险等级R3"

        let text = ContractParser.makeText(position)
        let parsed = ContractParser.parse(text)

        // 导出的键必须全部被识别；结构与原持仓一致
        #expect(parsed.warnings.isEmpty)
        #expect(parsed.structureType == .snowball)

        var copy = Position()
        ContractParser.apply(parsed, to: &copy)

        #expect(copy.productName == position.productName)
        #expect(copy.contractNo == position.contractNo)
        #expect(copy.broker == position.broker)
        #expect(copy.underlyingCode == position.underlyingCode)
        #expect(copy.tradeStartDate == position.tradeStartDate)
        #expect(copy.knockInObservation == position.knockInObservation)
        #expect(copy.accrualBasis == position.accrualBasis)
        #expect(copy.notes == position.notes)

        #expect(abs(copy.notional - position.notional) < epsilon)
        #expect(abs(copy.initialPrice - position.initialPrice) < epsilon)
        #expect(abs(copy.marginRatio - position.marginRatio) < epsilon)
        #expect(abs(copy.maxLossPct - position.maxLossPct) < epsilon)
        #expect(abs(copy.maturityCoupon - position.maturityCoupon) < epsilon)
        #expect(abs(copy.knockOutEnhanceParticipation - position.knockOutEnhanceParticipation) < epsilon)
        #expect(abs(copy.knockInBarrier - position.knockInBarrier) < epsilon)
        #expect(abs(copy.knockInStrike - position.knockInStrike) < epsilon)
        #expect(abs(copy.knockInParticipation - position.knockInParticipation) < epsilon)
        #expect(abs(copy.rebateAnnualPct - position.rebateAnnualPct) < epsilon)
        #expect(abs(copy.rebateAbsoluteBackPct - position.rebateAbsoluteBackPct) < epsilon)
        #expect(abs(copy.rebateAbsoluteFrontPct - position.rebateAbsoluteFrontPct) < epsilon)
        #expect(copy.accrualSettleTplus == position.accrualSettleTplus)
        #expect(abs(copy.absFeePct - position.absFeePct) < epsilon)
        #expect(abs(copy.annualFeePct - position.annualFeePct) < epsilon)
        #expect(abs(copy.incomeDividendPct - position.incomeDividendPct) < epsilon)

        // 序列字段：逐 token 还原一致
        #expect(lines(parsed.knockOutDates) == ["2026-04-08", "2026-07-08", "2026-10-08"])
        let barriers = lines(parsed.knockOutBarriers).compactMap { Double($0) }
        #expect(barriers.count == 3)
        #expect(zip(barriers, [103.0, 102.5, 101.0]).allSatisfy { abs($0 - $1) < epsilon })
        let coupons = lines(parsed.knockOutCoupons).compactMap { Double($0) }
        #expect(coupons.count == 3)
        #expect(zip(coupons, [1.65, 1.7, 1.75]).allSatisfy { abs($0 - $1) < epsilon })
    }

    @Test func phoenixRoundTrip() {
        var position = Position(structureType: .phoenix)
        position.productName = "中证1000凤凰B"
        position.underlyingCode = "000852.SH"
        position.notional = 1_000_000
        position.tradeStartDate = "2026-02-01"
        position.initialPrice = 6800
        position.marginRatio = 0.5
        position.couponBarrier = 0.95
        position.couponRate = 0.015
        position.couponDates = FormLists.stringsJSON(["2026-05-01", "2026-08-01"])
        position.accrualBasis = "one"

        let text = ContractParser.makeText(position)
        let parsed = ContractParser.parse(text)

        #expect(parsed.warnings.isEmpty)
        #expect(parsed.structureType == .phoenix)

        var copy = Position(structureType: .phoenix)
        ContractParser.apply(parsed, to: &copy)

        #expect(copy.productName == position.productName)
        #expect(copy.underlyingCode == position.underlyingCode)
        #expect(abs(copy.couponBarrier - position.couponBarrier) < epsilon)
        #expect(abs(copy.couponRate - position.couponRate) < epsilon)
        #expect(copy.accrualBasis == "one")
        #expect(lines(parsed.couponDates) == ["2026-05-01", "2026-08-01"])
    }

    @Test func emptyProductResetsFallback() {
        // 产品名为空的持仓：导出「产品名称：」空值行，parse 后产品名保持为空，
        // 不触发「结构类型值兜底」（否则会被错填成「雪球」）。
        var position = Position(structureType: .snowball)
        position.underlyingCode = "000300.SH"
        position.notional = 500_000

        let parsed = ContractParser.parse(ContractParser.makeText(position))
        #expect(parsed.productName == "")
        #expect(parsed.warnings.isEmpty)
    }
}
