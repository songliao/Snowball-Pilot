import Foundation

/// 行情历史与自选标的（对应桌面端 electron/database/prices.ts）。
/// nonisolated + @unchecked Sendable：连接 FULLMUTEX + WAL，UI 主线程与回填 actor 可并发访问。
nonisolated final class PriceRepository: @unchecked Sendable {
    private let db: SQLiteDatabase

    init(database: SQLiteDatabase) {
        self.db = database
    }

    // MARK: - 查询

    /// 某标的价格历史：limit 为空时按日期升序返回全部，否则取最近 limit 条（降序）。
    func history(code: String, limit: Int? = nil) throws -> [PricePoint] {
        let rows: [SQLRow]
        if let limit {
            rows = try db.query(
                "SELECT * FROM price_history WHERE underlying_code = ? ORDER BY date DESC LIMIT ?",
                [.text(code), .int(limit)]
            )
        } else {
            rows = try db.query(
                "SELECT * FROM price_history WHERE underlying_code = ? ORDER BY date ASC",
                [.text(code)]
            )
        }
        return rows.map(Self.point(from:))
    }

    /// 最新价格（仅交易日记录，周末不填充）。
    func latest(code: String) throws -> PricePoint? {
        let row = try db.firstRow(
            """
            SELECT * FROM price_history
            WHERE underlying_code = ? AND strftime('%w', date) NOT IN ('0','6')
            ORDER BY date DESC LIMIT 1
            """,
            [.text(code)]
        )
        return row.map(Self.point(from:))
    }

    /// 全表最新行情日期（数据截止日期提示用）。
    func latestDate() throws -> String? {
        try db.firstRow(
            "SELECT MAX(date) AS date FROM price_history WHERE strftime('%w', date) NOT IN ('0','6')"
        )?.string("date")
    }

    /// OHLC 升序序列（离线读取历史行情）。
    func ohlcHistory(code: String) throws -> [KLinePoint] {
        try db.query(
            """
            SELECT date, price AS close, open, high, low, volume
            FROM price_history WHERE underlying_code = ? ORDER BY date ASC
            """,
            [.text(code)]
        ).map { row in
            KLinePoint(
                date: row.string("date", or: ""),
                open: row.double("open") ?? 0,
                high: row.double("high") ?? 0,
                low: row.double("low") ?? 0,
                close: row.double("close", or: 0),
                volume: row.double("volume") ?? 0
            )
        }
    }

    /// 已存行情标的汇总（含最新价、前一交易日与近周/近月/近年基准价，全部排除周末）。
    func codeSummaries() throws -> [PriceCodeSummary] {
        try db.query("""
        SELECT p1.underlying_code AS code, p1.price AS latestPrice, p1.date AS date,
               (SELECT p2.price FROM price_history p2
                WHERE p2.underlying_code = p1.underlying_code AND p2.date < p1.date
                  AND strftime('%w', p2.date) NOT IN ('0','6')
                ORDER BY p2.date DESC LIMIT 1) AS prevPrice,
               (SELECT p3.price FROM price_history p3
                WHERE p3.underlying_code = p1.underlying_code AND p3.date <= date(p1.date, '-7 days')
                  AND strftime('%w', p3.date) NOT IN ('0','6')
                ORDER BY p3.date DESC LIMIT 1) AS priceWeekAgo,
               (SELECT p4.price FROM price_history p4
                WHERE p4.underlying_code = p1.underlying_code AND p4.date <= date(p1.date, '-30 days')
                  AND strftime('%w', p4.date) NOT IN ('0','6')
                ORDER BY p4.date DESC LIMIT 1) AS priceMonthAgo,
               (SELECT p6.price FROM price_history p6
                WHERE p6.underlying_code = p1.underlying_code AND p6.date <= date(p1.date, '-365 days')
                  AND strftime('%w', p6.date) NOT IN ('0','6')
                ORDER BY p6.date DESC LIMIT 1) AS priceYearAgo
        FROM price_history p1
        WHERE p1.date = (
          SELECT MAX(date) FROM price_history p5
          WHERE p5.underlying_code = p1.underlying_code
            AND strftime('%w', p5.date) NOT IN ('0','6')
        )
        ORDER BY p1.underlying_code
        """).map { row in
            PriceCodeSummary(
                code: row.string("code", or: ""),
                latestPrice: row.double("latestPrice", or: 0),
                date: row.string("date", or: ""),
                prevPrice: row.double("prevPrice"),
                priceWeekAgo: row.double("priceWeekAgo"),
                priceMonthAgo: row.double("priceMonthAgo"),
                priceYearAgo: row.double("priceYearAgo")
            )
        }
    }

    // MARK: - 写入

    enum UpsertError: Error, Equatable {
        case nonTradingDay
    }

    /// 插入或更新行情（UNIQUE(underlying_code, date) 幂等）。周末数据直接拒绝。
    /// 不在此处重算均线：MA 是全序列重算，逐行触发是 O(N²)；批量写入后由调用方显式调 storeMA。
    @discardableResult
    func upsert(_ point: PricePoint) throws -> Bool {
        guard Self.isTradingDay(point.date) else { return false }
        try db.run(
            """
            INSERT OR REPLACE INTO price_history (underlying_code, price, date, source, open, high, low, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                .text(point.underlyingCode),
                .real(point.price),
                .text(point.date),
                .text(point.source),
                point.open.map(SQLValue.real) ?? .null,
                point.high.map(SQLValue.real) ?? .null,
                point.low.map(SQLValue.real) ?? .null,
                point.volume.map(SQLValue.real) ?? .null,
            ]
        )
        return true
    }

    func deleteByCode(code: String) throws {
        try db.run("DELETE FROM price_history WHERE underlying_code = ?", [.text(code)])
    }

    // MARK: - 自选标的

    func watchlist() throws -> [String] {
        try db.query("SELECT code FROM watchlist ORDER BY sort_order, rowid").compactMap { $0.string("code") }
    }

    func setWatchlist(_ codes: [String]) throws {
        try db.run("DELETE FROM watchlist")
        for (index, code) in codes.enumerated() {
            try db.run("INSERT OR IGNORE INTO watchlist (code, sort_order) VALUES (?, ?)",
                       [.text(code), .int(index)])
        }
    }

    // MARK: - 工具

    /// A 股周末从不开市：周末日期一律视为非交易日（与桌面端 isTradingDay 一致，按 UTC 解析星期）。
    static func isTradingDay(_ dateText: String) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        guard let date = AppDate.parseUTC(dateText) else { return false }
        let weekday = calendar.component(.weekday, from: date) // 1=周日 7=周六
        return weekday != 1 && weekday != 7
    }

    private static func point(from row: SQLRow) -> PricePoint {
        PricePoint(
            id: row.int("id") ?? 0,
            underlyingCode: row.string("underlying_code", or: ""),
            price: row.double("price", or: 0),
            date: row.string("date", or: ""),
            source: row.string("source", or: "manual"),
            open: row.double("open"),
            high: row.double("high"),
            low: row.double("low"),
            volume: row.double("volume")
        )
    }
}
