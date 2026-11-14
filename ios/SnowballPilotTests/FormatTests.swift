import Testing
import Foundation
@testable import SnowballPilot

/// 票息百分比格式化：固定 4 位小数完整展示，与桌面端详情页 toFixed(4) 口径一致。
struct FormatTests {
    @Test func couponPercentFourDecimals() {
        // 小数输入（DB 存储口径）×100 后固定 4 位小数
        #expect(Format.couponPercent(0.0165) == "1.6500%")
        #expect(Format.couponPercent(0.012345) == "1.2345%")
        #expect(Format.couponPercent(0.05) == "5.0000%")
        #expect(Format.couponPercent(0) == "0.0000%")
    }

    @Test func couponPercentRawFourDecimals() {
        // 序列字段存百分数数值，直接格式化
        #expect(Format.couponPercentRaw(1.65) == "1.6500%")
        #expect(Format.couponPercentRaw(1.2345) == "1.2345%")
        #expect(Format.couponPercentRaw(103) == "103.0000%")
    }

    @Test func regularPercentUnchanged() {
        // 常规百分比（保证金、距离等）保持 2 位小数不受影响
        #expect(Format.percent(0.75) == "75.00%")
        #expect(Format.percentRaw(103) == "103.00%")
    }
}
