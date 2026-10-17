import Foundation
import Testing
@testable import SnowballPilot

@Suite("预警引擎对拍（TS fixtures）")
struct AlertEngineTests {
    private let fixtures: Fixtures

    init() throws {
        self.fixtures = try Fixtures.load()
    }

    @Test("预警结果与桌面端 computeAlerts 一致")
    func alertsMatchDesktop() throws {
        // 与 fixtures 生成时相同的样本（alerts 段按 [positions, prices, cfg] 顺序组织）
        let sampleCases = try alertSampleCases()
        #expect(sampleCases.count == fixtures.alerts.count, "样本组数与 fixtures 不一致")

        for (index, sample) in sampleCases.enumerated() {
            let computed = AlertEngine.compute(
                positions: sample.positions,
                latestPrices: sample.prices,
                config: sample.config
            )
            let expected = fixtures.alerts[index]
            #expect(computed.count == expected.count, "第 \(index) 组预警条数")
            for (a, e) in zip(computed, expected) {
                #expect(a.id == e.id, "第 \(index) 组 id")
                #expect(a.title == e.title, "第 \(index) 组标题")
                #expect(a.code == e.code, "第 \(index) 组代码")
                #expect(a.structureType == e.structureType, "第 \(index) 组结构类型")
                #expect(abs(a.cur - e.cur) < 1e-6, "第 \(index) 组现价")
                #expect(a.reasons.count == e.reasons.count, "第 \(index) 组原因条数")
                for (ar, er) in zip(a.reasons, e.reasons) {
                    #expect(ar.label == er.label, "第 \(index) 组原因标签")
                    #expect(ar.tone == er.tone, "第 \(index) 组原因级别")
                    #expect(ar.date == er.date, "第 \(index) 组原因日期")
                    switch (ar.level, er.level) {
                    case (nil, nil): break
                    case (let al?, let el?): #expect(abs(al - el) < 1e-6, "第 \(index) 组障碍点位")
                    default: #expect(Bool(false), "第 \(index) 组障碍点位缺失不一致")
                    }
                    #expect(abs(ar.gap - er.gap) < 1e-6, "第 \(index) 组差距")
                }
            }
        }
    }

    // MARK: - 与 generate-fixtures.mjs 相同的三组样本

    private struct SampleCase {
        var positions: [Position]
        var prices: [String: Double]
        var config: AlertEngine.Config
    }

    private func alertSampleCases() throws -> [SampleCase] {
        let snowball = try #require(fixtures.pnl.first(where: { $0.pos.structureType == .snowball && $0.price == 5800 })?.pos)
        let phoenix = try #require(fixtures.pnl.first(where: { $0.pos.structureType == .phoenix })?.pos)
        let knockedIn = try #require(fixtures.pnl.first(where: { $0.price == 5800 && $0.pos.status == .knockedIn })?.pos)
        let knockedOut = try #require(fixtures.pnl.first(where: { $0.price == 6400 })?.pos)

        return [
            SampleCase(
                positions: [snowball, phoenix, knockedOut],
                prices: ["000852.SH": 6280, "000300.SH": 3150],
                config: AlertEngine.Config(knockOutLeadDays: 30, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10)
            ),
            SampleCase(
                positions: [snowball, phoenix],
                prices: ["000852.SH": 4700, "000300.SH": 3140],
                config: AlertEngine.Config(knockOutLeadDays: 5, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10)
            ),
            SampleCase(
                positions: [knockedIn],
                prices: ["000852.SH": 4600],
                config: AlertEngine.Config(knockOutLeadDays: 5, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10)
            ),
        ]
    }
}
