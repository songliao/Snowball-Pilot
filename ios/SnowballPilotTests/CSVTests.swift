import Foundation
import Testing
@testable import SnowballPilot

@Suite("CSV 导入导出")
struct CSVTests {
    private let fixtures: Fixtures

    init() throws {
        self.fixtures = try Fixtures.load()
    }

    @Test("RFC4180 解析与桌面端一致")
    func parseSamples() {
        for (index, sample) in fixtures.csv.parseSamples.enumerated() {
            let parsed = CSV.parse(sample.sample)
            #expect(parsed == sample.expected, "样本 \(index)")
        }
    }

    @Test("导出文本与桌面端渲染逐字节一致（BOM 除外）")
    func exportText() throws {
        let positions = try positionsFromFixtures()
        let exported = CSV.exportText(positions: positions)
        #expect(exported.hasPrefix("\u{FEFF}"), "导出必须带 BOM")
        let stripped = String(exported.dropFirst())
        #expect(stripped == fixtures.csv.exportText)
    }

    @Test("导入导出 round-trip 还原全部字段")
    func importRoundTrip() throws {
        let expected = try positionsFromFixtures()
        let (imported, failed) = CSV.importPositions(from: fixtures.csv.exportText)
        #expect(failed == 0)
        #expect(imported == expected)
    }

    @Test("structure_type 非法的行计入 failed")
    func invalidRows() {
        let header = Schema.csvColumns.joined(separator: ",")
        let badRow = "airbag,产品,券商,C1,2026-01-01,000852.SH,100,10,0.75,100,0.1,[],[],daily,100,1,0,0,0,both,0,0,0,0,,active,0,,,,,,,0,0,0,[],[],[],[]"
        let text = header + "\r\n" + badRow + "\r\n"
        let (imported, failed) = CSV.importPositions(from: text)
        #expect(imported.isEmpty)
        #expect(failed == 1)
    }

    @Test("空文件与缺数据行返回失败")
    func emptyFile() {
        #expect(CSV.importPositions(from: "").positions.isEmpty)
        #expect(CSV.importPositions(from: "structure_type,product_name\r\n").positions.isEmpty)
    }

    // MARK: - Helpers

    private func positionsFromFixtures() throws -> [Position] {
        // pnl 用例的 pos 与 CSV 导出用的持仓对象同源（snowball 与 phoenix）
        let snowball = try #require(fixtures.pnl.first(where: { $0.pos.structureType == .snowball && $0.price == 5800 })?.pos)
        let phoenix = try #require(fixtures.pnl.first(where: { $0.pos.structureType == .phoenix })?.pos)
        // CSV 导出样本中雪球的红利票息为 2.5
        var snowballWithCoupon = snowball
        snowballWithCoupon.maturityCoupon = 2.5
        return [snowballWithCoupon, phoenix]
    }
}
