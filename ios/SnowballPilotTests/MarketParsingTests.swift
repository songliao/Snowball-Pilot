import Foundation
import Testing
@testable import SnowballPilot

@Suite("行情解析")
struct MarketParsingTests {
    private let fixtures: Fixtures

    init() throws {
        self.fixtures = try Fixtures.load()
    }

    @Test("代码转换：全角归一化 + 市场前缀")
    func symbolConversion() {
        #expect(MarketDataClient.toTencentSymbol("000852.SH") == "sh000852")
        #expect(MarketDataClient.toTencentSymbol("399006.SZ") == "sz399006")
        #expect(MarketDataClient.toTencentSymbol("０００８５２．ＳＨ") == "sh000852")
        #expect(MarketDataClient.toTencentSymbol(" 000300.SH ") == "sh000300")
        #expect(MarketDataClient.toTencentSymbol("000852") == nil)
    }

    @Test("GBK 解码保留中文名称")
    func gbkDecoding() {
        // "中证1000" 的 GBK 字节：中=D6D0 证=D6A4 + ASCII
        let bytes: [UInt8] = [0xD6, 0xD0, 0xD6, 0xA4] + Array("1000".utf8)
        #expect(MarketDataClient.decodeGBK(Data(bytes)) == "中证1000")
        // "沪深300" 的 GBK 字节：沪=BBA6 深=C9EE + ASCII
        let sh: [UInt8] = [0xBB, 0xA6, 0xC9, 0xEE] + Array("300".utf8)
        #expect(MarketDataClient.decodeGBK(Data(sh)) == "沪深300")
    }

    @Test("腾讯时间字段格式化")
    func tencentTime() {
        #expect(MarketDataClient.formatTencentTime("20261015150003") == "15:00:03")
        #expect(MarketDataClient.formatTencentTime("short") == "short")
        #expect(MarketDataClient.formatTencentTime("") == "")
    }

    @Test("实时行情字段解析（离线样本）")
    func indexQuoteParsing() throws {
        let line = fixtures.tencent.quoteLine
        guard let start = line.firstIndex(of: "\""), let end = line.lastIndex(of: "\""), start < end else {
            Issue.record("样本缺少引号")
            return
        }
        let fields = String(line[line.index(after: start)..<end])
            .split(separator: "~", omittingEmptySubsequences: false)
            .map(String.init)

        let quote = try #require(MarketDataClient.parseIndexQuote(fields: fields, code: "000852.SH"))
        #expect(quote.name == "中证1000")
        #expect(abs(quote.price - 6280.55) < 1e-9)
        #expect(abs(quote.prevClose - 6235.10) < 1e-9)
        #expect(abs(quote.open - 6240.00) < 1e-9)
        #expect(abs(quote.high - 6301.20) < 1e-9)
        #expect(abs(quote.low - 6220.10) < 1e-9)
        #expect(abs(quote.change - 45.45) < 1e-9)
        #expect(abs(quote.changePct - 0.73) < 1e-9)
        #expect(abs(quote.volume - 123456789) < 1e-9)
        #expect(abs(quote.amount - 98765432100) < 1e-9)
        #expect(quote.updateTime == "15:00:03")

        let simple = try #require(MarketDataClient.parsePrice(fields: fields, code: "000852.SH"))
        #expect(simple.price == quote.price)
        #expect(simple.name == "中证1000")
    }

    @Test("K 线 JSON 解析（升序 OHLC）")
    func klineParsing() throws {
        let json = fixtures.tencent.klineJSON.data(using: .utf8)!
        let points = MarketDataClient.parseKline(data: json, symbol: "sh000852")
        #expect(points.count == 4)
        let first = try #require(points.first)
        #expect(first.date == "2026-10-12")
        #expect(abs(first.open - 6210.10) < 1e-9)
        #expect(abs(first.close - 6235.10) < 1e-9)
        #expect(abs(first.high - 6255.00) < 1e-9)
        #expect(abs(first.low - 6200.50) < 1e-9)
        #expect(abs(first.volume - 98765432) < 1e-9)
        let last = try #require(points.last)
        #expect(last.date == "2026-10-15")
        #expect(abs(last.close - 6280.55) < 1e-9)
    }

    @Test("K 线 JSON 缺 day 数据返回空")
    func klineMissingData() {
        let empty = #"{"code":0,"data":{"sh000852":{"version":"1.1"}}}"#
        let points = MarketDataClient.parseKline(data: Data(empty.utf8), symbol: "sh000852")
        #expect(points.isEmpty)
    }

    @Test("交易日判断：周末拒绝")
    func tradingDayChecks() {
        // 2026-10-17 是周六，2026-10-18 是周日，2026-10-15 是周四
        #expect(!PriceRepository.isTradingDay("2026-10-17"))
        #expect(!PriceRepository.isTradingDay("2026-10-18"))
        #expect(PriceRepository.isTradingDay("2026-10-15"))
        #expect(!PriceRepository.isTradingDay("not-a-date"))
    }
}
