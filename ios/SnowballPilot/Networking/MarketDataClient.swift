import Foundation

/// 腾讯财经行情客户端（对应桌面端 electron/services/market-data.ts）。
/// 实时行情 qt.gtimg.cn（GBK 编码），历史 K 线 web.ifzq.gtimg.cn（JSON）。
/// nonisolated：被 IndexHistoryService actor 后台调用，网络与解码不占主线程。
nonisolated struct MarketDataClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    // MARK: - 代码转换

    /// 全角转半角、去空白（防御界面/外部传入的全角代码）。
    static func normalizeCode(_ code: String) -> String {
        let scalars = code.unicodeScalars.map { scalar -> Unicode.Scalar in
            if (0xFF01...0xFF5E).contains(scalar.value) {
                return Unicode.Scalar(scalar.value - 0xFEE0) ?? scalar
            }
            return scalar
        }
        return String(String.UnicodeScalarView(scalars))
            .replacingOccurrences(of: "　", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// "000852.SH" → "sh000852"（腾讯 symbol）。无法识别返回 nil。
    static func toTencentSymbol(_ code: String) -> String? {
        let normalized = normalizeCode(code)
        let parts = normalized.split(separator: ".")
        guard parts.count == 2 else { return nil }
        let prefix = parts[1] == "SH" ? "sh" : "sz"
        return prefix + parts[0]
    }

    // MARK: - 实时行情

    func fetchPrice(code: String) async -> MarketPriceResult? {
        guard let fields = await quoteFields(code: code) else { return nil }
        return Self.parsePrice(fields: fields, code: code)
    }

    func fetchIndexQuote(code: String) async -> IndexQuote? {
        guard let fields = await quoteFields(code: code) else { return nil }
        return Self.parseIndexQuote(fields: fields, code: code)
    }

    /// 从 `~` 分隔的字段解析简版报价（纯函数，供离线测试）。
    static func parsePrice(fields: [String], code: String) -> MarketPriceResult? {
        guard let price = flexDouble(fields.count > 3 ? fields[3] : ""), price.isFinite else { return nil }
        return MarketPriceResult(price: price, name: fields.count > 1 ? fields[1] : code)
    }

    /// 从 `~` 分隔的字段解析完整指数行情（纯函数，供离线测试）。
    static func parseIndexQuote(fields: [String], code: String) -> IndexQuote? {
        guard let price = flexDouble(fields.count > 3 ? fields[3] : ""), price.isFinite else { return nil }
        let extra = (fields.count > 35 ? fields[35] : "").split(separator: "/").map(String.init)
        return IndexQuote(
            code: code,
            name: fields.count > 1 ? fields[1] : code,
            price: price,
            change: flexDouble(fields.count > 31 ? fields[31] : "") ?? 0,
            changePct: flexDouble(fields.count > 32 ? fields[32] : "") ?? 0,
            open: flexDouble(fields.count > 5 ? fields[5] : "") ?? 0,
            high: flexDouble(fields.count > 33 ? fields[33] : "") ?? 0,
            low: flexDouble(fields.count > 34 ? fields[34] : "") ?? 0,
            prevClose: flexDouble(fields.count > 4 ? fields[4] : "") ?? 0,
            volume: flexDouble(fields.count > 6 ? fields[6] : "") ?? 0,
            amount: flexDouble(extra.count > 2 ? extra[2] : "") ?? 0,
            updateTime: formatTencentTime(fields.count > 30 ? fields[30] : "")
        )
    }

    /// 批量获取（限并发 8，与桌面端 Promise.all 行为一致但更克制）。
    func fetchPrices(codes: [String]) async -> [String: MarketPriceResult] {
        var results: [String: MarketPriceResult] = [:]
        let chunkSize = 8
        var index = 0
        while index < codes.count {
            let chunk = Array(codes[index..<min(index + chunkSize, codes.count)])
            await withTaskGroup(of: (String, MarketPriceResult?).self) { group in
                for code in chunk {
                    group.addTask { (code, await self.fetchPrice(code: code)) }
                }
                for await (code, result) in group {
                    if let result { results[code] = result }
                }
            }
            index += chunkSize
        }
        return results
    }

    // MARK: - K 线

    /// 历史 OHLC（前复权）。腾讯偶发抖动时重试一次。
    func fetchKline(code: String, days: Int = 365) async -> [KLinePoint] {
        guard let symbol = Self.toTencentSymbol(code) else { return [] }
        // fqkline 接口必须带 qfq 后缀，否则只返回 version、不含 day 数据
        let urlString = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=\(symbol),day,,,\(days),qfq"
        guard let url = URL(string: urlString) else { return [] }

        for attempt in 0..<2 {
            do {
                let (data, response) = try await Self.request(url, session: session)
                if let http = response as? HTTPURLResponse,
                   http.statusCode == 429 || http.statusCode >= 500 {
                    if attempt == 0 { try? await Task.sleep(for: .milliseconds(500)); continue }
                    return []
                }
                return Self.parseKline(data: data, symbol: symbol)
            } catch {
                if attempt == 0 { try? await Task.sleep(for: .milliseconds(500)) }
            }
        }
        return []
    }

    static func parseKline(data: Data, symbol: String) -> [KLinePoint] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataNode = root["data"] as? [String: Any],
              let node = dataNode[symbol] as? [String: Any]
        else { return [] }
        let rows = (node["day"] as? [[Any]]) ?? (node["qfqday"] as? [[Any]]) ?? []
        return rows.compactMap { row -> KLinePoint? in
            guard row.count > 4, let date = row[0] as? String,
                  let open = flexAnyDouble(row[1]),
                  let close = flexAnyDouble(row[2]),
                  let high = flexAnyDouble(row[3]),
                  let low = flexAnyDouble(row[4]),
                  close > 0
            else { return nil }
            return KLinePoint(
                date: date,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: (row.count > 5 ? flexAnyDouble(row[5]) : nil) ?? 0
            )
        }
    }

    // MARK: - Private

    private static func request(_ url: URL, session: URLSession) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        request.setValue("https://gu.qq.com/", forHTTPHeaderField: "Referer")
        return try await session.data(for: request)
    }

    private func quoteFields(code: String) async -> [String]? {
        guard let symbol = Self.toTencentSymbol(code),
              let url = URL(string: "https://qt.gtimg.cn/q=\(symbol)")
        else { return nil }
        do {
            let (data, response) = try await Self.request(url, session: session)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            let text = Self.decodeGBK(data)
            guard let start = text.firstIndex(of: "\""), let end = text.lastIndex(of: "\""), start < end
            else { return nil }
            let content = String(text[text.index(after: start)..<end])
            guard !content.isEmpty else { return nil }
            return content.split(separator: "~", omittingEmptySubsequences: false).map(String.init)
        } catch {
            return nil
        }
    }

    /// 腾讯实时接口返回 GBK；解码保留中文名。
    static func decodeGBK(_ data: Data) -> String {
        let gbk = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(UInt32(CFStringEncodings.GB_18030_2000.rawValue))
        ))
        return String(data: data, encoding: gbk) ?? String(data: data, encoding: .utf8) ?? ""
    }

    /// 腾讯实时时间字段 YYYYMMDDHHMMSS → "HH:MM:SS"。
    static func formatTencentTime(_ raw: String) -> String {
        guard raw.count >= 14 else { return raw }
        let start = raw.index(raw.startIndex, offsetBy: 8)
        let middle = raw.index(raw.startIndex, offsetBy: 10)
        let end = raw.index(raw.startIndex, offsetBy: 12)
        let tail = raw.index(raw.startIndex, offsetBy: 14)
        return "\(raw[start..<middle]):\(raw[middle..<end]):\(raw[end..<tail])"
    }

    static func flexDouble(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return Double(trimmed).flatMap { $0.isFinite ? $0 : nil }
    }

    /// JSON 行内数值可能是数字或字符串（parseFloat 语义）。
    static func flexAnyDouble(_ value: Any) -> Double? {
        if let number = value as? NSNumber {
            let double = number.doubleValue
            return double.isFinite ? double : nil
        }
        if let text = value as? String { return flexDouble(text) }
        return nil
    }
}
