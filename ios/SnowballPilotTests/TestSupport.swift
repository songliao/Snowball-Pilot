import Foundation
import Testing
@testable import SnowballPilot

/// 测试 fixtures 加载（fixtures.json 位于测试 bundle 资源）。
enum TestFixtures {
    private final class BundleToken {}

    static func data() throws -> Data {
        let bundle = Bundle(for: BundleToken.self)
        guard let url = bundle.url(forResource: "fixtures", withExtension: "json") else {
            throw FixtureError.missingValue
        }
        return try Data(contentsOf: url)
    }
}

enum FixtureError: Error {
    case missingValue
}

/// fixtures.json 解码模型（snake_case → camelCase）。
struct Fixtures: Decodable {
    var generatedAt: String
    var knockOutProfit: [KOCase]
    var estimateExpectedProfit: [EstimateCase]
    var pnl: [PnLCase]
    var holdingDays: [HoldingCase]
    var alerts: [[AlertEngine.Item]]
    var csv: CsvSection
    var tencent: TencentSection

    static func load() throws -> Fixtures {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(Fixtures.self, from: try TestFixtures.data())
    }

    struct KOCase: Decodable {
        var input: Calc.KnockOutProfitInput
        var output: Calc.KnockOutProfit?
    }

    struct EstimateCase: Decodable {
        var pos: Position
        var output: Double?
    }

    struct PnLCase: Decodable {
        var pos: Position
        var price: Double
        var output: Calc.PnLResult
    }

    struct HoldingCase: Decodable {
        var start: String
        var end: String?
        var output: Int?
    }

    struct CsvSection: Decodable {
        var exportColumns: [String]
        var exportText: String
        var parseSamples: [ParseSample]

        struct ParseSample: Decodable {
            var sample: String
            var expected: [[String]]
        }
    }

    struct TencentSection: Decodable {
        var quoteLine: String
        var klineJSON: String
    }
}
