import Foundation
import Testing
@testable import SnowballPilot

/// 对拍测试：用仓库内真实 TS 实现（src/utils/calc.ts 等）生成的 fixtures，
/// 验证 Swift 移植的数值口径与桌面端完全一致。
/// fixtures 由 `node ios/scripts/generate-fixtures.mjs` 生成。
@Suite("Calc 对拍（TS fixtures）")
struct CalcCrossTests {
    private let fixtures: Fixtures

    init() throws {
        self.fixtures = try Fixtures.load()
    }

    private func approxEqual(_ a: Double, _ b: Double, tolerance: Double = 1e-6) -> Bool {
        abs(a - b) < tolerance
    }

    @Test("敲出收益计算与桌面端一致")
    func knockOutProfit() throws {
        for (index, testCase) in fixtures.knockOutProfit.enumerated() {
            let result = Calc.knockOutProfit(testCase.input)
            guard let expected = testCase.output else {
                #expect(result == nil, "用例 \(index)：预期为 nil")
                continue
            }
            let actual = try #require(result, "用例 \(index)：预期有结果")
            #expect(actual.settleDate == expected.settleDate, "用例 \(index) 结算日")
            #expect(actual.holdingDays == expected.holdingDays, "用例 \(index) 持有天数")
            #expect(approxEqual(actual.holdingYears, expected.holdingYears), "用例 \(index) 持有年数")
            #expect(approxEqual(actual.coupon, expected.coupon), "用例 \(index) 票息")
            #expect(approxEqual(actual.rebate.annual, expected.rebate.annual), "用例 \(index) 年化返息")
            #expect(approxEqual(actual.rebate.absFront, expected.rebate.absFront), "用例 \(index) 前端返息")
            #expect(approxEqual(actual.rebate.absBack, expected.rebate.absBack), "用例 \(index) 后端返息")
            #expect(approxEqual(actual.rebate.total, expected.rebate.total), "用例 \(index) 返息合计")
            #expect(approxEqual(actual.fees.absFee, expected.fees.absFee), "用例 \(index) 绝对费用")
            #expect(approxEqual(actual.fees.annualFee, expected.fees.annualFee), "用例 \(index) 年化费用")
            #expect(approxEqual(actual.fees.dividend, expected.fees.dividend), "用例 \(index) 收益分红")
            #expect(approxEqual(actual.fees.total, expected.fees.total), "用例 \(index) 费用合计")
            #expect(approxEqual(actual.net, expected.net), "用例 \(index) 净收益")
        }
    }

    @Test("浮动盈亏与桌面端一致")
    func pnl() {
        for (index, testCase) in fixtures.pnl.enumerated() {
            let actual = Calc.pnl(testCase.pos, currentPrice: testCase.price)
            #expect(actual.type == testCase.output.type, "用例 \(index) 类型标签")
            #expect(approxEqual(actual.pnl, testCase.output.pnl), "用例 \(index) 盈亏金额")
            #expect(approxEqual(actual.pnlRate, testCase.output.pnlRate), "用例 \(index) 盈亏比例")
        }
    }

    @Test("持有天数与桌面端一致（含非法日期降级为 0）")
    func holdingDays() {
        // end 为空的用例，TS 生成时按 fixtures 生成日（generatedAt）计算，Swift 端用同一日期保证可复现
        let generationDate = AppDate.parse(String(fixtures.generatedAt.prefix(10)))
        for (index, testCase) in fixtures.holdingDays.enumerated() {
            let endDate = testCase.end.flatMap(AppDate.parse) ?? generationDate
            let actual = Calc.holdingDays(effectiveDate: testCase.start, endDate: endDate)
            // 桌面端对非法日期返回 NaN（JSON 里是 null），Swift 端有意降级为 0
            let expected = testCase.output ?? 0
            #expect(actual == expected, "用例 \(index)")
        }
    }

    @Test("预期收益估算与桌面端一致")
    func estimateExpectedProfit() {
        for (index, testCase) in fixtures.estimateExpectedProfit.enumerated() {
            let actual = Calc.estimateExpectedProfit(testCase.pos)
            guard let expected = testCase.output else {
                #expect(actual == nil, "用例 \(index)：预期为 nil")
                continue
            }
            #expect(approxEqual(try! actual.unwrap(), expected), "用例 \(index)")
        }
    }
}

extension Optional {
    func unwrap() throws -> Wrapped {
        guard let value = self else { throw FixtureError.missingValue }
        return value
    }
}
