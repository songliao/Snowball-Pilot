import Foundation
import Testing
@testable import SnowballPilot

/// 已派息判定（Calc.recordedCouponDates）：兼容桌面端/新版 iOS 的
/// couponPaymentDates 形态与旧版 iOS 只写 couponReceived（按观察日索引）的形态。
/// 背景：旧版 iOS 派息登记不写 couponPaymentDates，合约检查按该字段判「已派息」，
/// 导致已登记的派息被误报为漏记。
@Suite("已派息判定")
struct CouponRecordTests {
    private func makePhoenix(
        couponDates: [String],
        received: [String],
        paymentDates: [String]
    ) -> Position {
        var position = Position(id: 1, structureType: .phoenix)
        position.couponDates = JSONHelper.encode(couponDates)
        position.couponReceived = JSONHelper.encode(received)
        position.couponPaymentDates = JSONHelper.encode(paymentDates)
        return position
    }

    private enum JSONHelper {
        static func encode(_ values: [String]) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: values),
                  let json = String(data: data, encoding: .utf8) else { return "[]" }
            return json
        }
    }

    @Test("桌面端/新版形态：couponPaymentDates 直接生效")
    func paymentDatesForm() {
        let position = makePhoenix(
            couponDates: ["2026-04-20", "2026-05-20", "2026-06-22"],
            received: ["1000.00"],
            paymentDates: ["2026-04-20"]
        )
        #expect(Calc.recordedCouponDates(position) == ["2026-04-20"])
    }

    @Test("旧版 iOS 形态：按 couponReceived 索引还原已派息观察日")
    func legacyIndexForm() {
        let position = makePhoenix(
            couponDates: ["2026-04-20", "2026-05-20", "2026-06-22"],
            received: ["1000.00", "", "2000.00"],
            paymentDates: []
        )
        // 第 0、2 期已登记金额 → 对应观察日视为已派息；第 1 期空串不算
        #expect(Calc.recordedCouponDates(position) == ["2026-04-20", "2026-06-22"])
    }

    @Test("旧版 iOS 形态：完全未登记返回空集合")
    func legacyEmpty() {
        let position = makePhoenix(
            couponDates: ["2026-04-20", "2026-05-20"],
            received: ["", ""],
            paymentDates: []
        )
        #expect(Calc.recordedCouponDates(position).isEmpty)
    }

    @Test("金额数组与观察日不等长（桌面端配对形态）：不能按索引解读")
    func mismatchedLengthFallsBack() {
        let position = makePhoenix(
            couponDates: ["2026-04-20", "2026-05-20", "2026-06-22"],
            received: ["1000.00", "2000.00"],
            paymentDates: []
        )
        #expect(Calc.recordedCouponDates(position).isEmpty)
    }

    @Test("两者并存时以 couponPaymentDates 为准")
    func paymentDatesTakePrecedence() {
        let position = makePhoenix(
            couponDates: ["2026-04-20", "2026-05-20"],
            received: ["", "999.00"],
            paymentDates: ["2026-05-20"]
        )
        #expect(Calc.recordedCouponDates(position) == ["2026-05-20"])
    }
}
