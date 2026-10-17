import Foundation

/// 指数/标的历史行情回填与增量更新（对应桌面端 electron/services/index-history.ts）。
/// actor 隔离：全部数据库写入跑在后台线程，不阻塞 UI（连接 FULLMUTEX + WAL 保证并发安全）。
actor IndexHistoryService {
    /// 跟踪的宽基指数（与桌面端 TRACKED_INDICES 一致）。
    nonisolated static let trackedIndices = ["000852.SH", "000905.SH", "000300.SH", "000016.SH"]

    private let database: UserDatabase
    private let market: MarketDataClient

    init(database: UserDatabase, market: MarketDataClient) {
        self.database = database
        self.market = market
    }

    struct BackfillReport: Equatable, Sendable {
        var saved: Int
        var codes: Int
        var failures: [String]
    }

    // MARK: - 单标的重建式回填

    /// 拉取近 days 天 K 线，成功后事务内清旧数据再全量重建（与桌面端 backfillCode 一致）。
    /// 返回写入条数；0 表示接口无数据或代码无效。
    func backfillCode(_ code: String, days: Int = 730) async -> Int {
        let klines = await market.fetchKline(code: code, days: days)
        guard !klines.isEmpty, let repo = database.prices, let db = database.database else { return 0 }
        let points = klines.map { kline in
            PricePoint(id: 0, underlyingCode: code, price: kline.close,
                       date: kline.date, source: "auto", open: kline.open,
                       high: kline.high, low: kline.low, volume: kline.volume)
        }
        let saved = (try? db.transaction { () -> Int in
            try repo.deleteByCode(code: code)
            for point in points {
                _ = try repo.upsert(point)
            }
            return points.count
        }) ?? 0
        return saved
    }

    // MARK: - 全量补足

    /// 目标标的 = 跟踪指数 ∪ 两张持仓表的全部标的（去重）。
    func targetCodes() -> [String] {
        var codes = Set(Self.trackedIndices)
        if let all = try? database.positions?.fetchAll() {
            for p in all where !p.underlyingCode.isEmpty { codes.insert(p.underlyingCode) }
        }
        return codes.sorted()
    }

    /// 对全部目标标的做重建式回填（clean = 先删旧数据），标的间 sleep 500ms。
    func backfillAll(days: Int = 730, clean: Bool = true) async -> BackfillReport {
        let codes = targetCodes()
        var report = BackfillReport(saved: 0, codes: 0, failures: [])
        guard let repo = database.prices, let db = database.database else { return report }
        for code in codes {
            let klines = await market.fetchKline(code: code, days: days)
            if klines.isEmpty {
                report.failures.append(code)
                continue
            }
            let points = klines.map { kline in
                PricePoint(id: 0, underlyingCode: code, price: kline.close,
                           date: kline.date, source: "auto", open: kline.open,
                           high: kline.high, low: kline.low, volume: kline.volume)
            }
            // 单个标的一个事务：删除 + 重建原子生效，失败回滚保住旧数据
            let saved = (try? db.transaction { () -> Int in
                if clean {
                    try repo.deleteByCode(code: code)
                }
                for point in points {
                    _ = try repo.upsert(point)
                }
                return points.count
            }) ?? 0
            if saved > 0 {
                report.saved += saved
                report.codes += 1
            } else {
                report.failures.append(code)
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return report
    }

    /// 增量补足已有标的至今天（INSERT OR REPLACE，只统计晚于最后记录日期的新增）。
    func refreshToToday() async -> BackfillReport {
        var report = BackfillReport(saved: 0, codes: 0, failures: [])
        guard let repo = database.prices, let db = database.database else { return report }
        guard let summaries = try? repo.codeSummaries() else { return report }
        let today = AppDate.todayUTCString()
        for summary in summaries {
            let lastDate = summary.date
            let daysSince = Calendar.current.dateComponents(
                [.day],
                from: AppDate.parseUTC(lastDate) ?? Date(),
                to: AppDate.parseUTC(today) ?? Date()
            ).day ?? 0
            let days = max(30, daysSince + 10)
            let klines = await market.fetchKline(code: summary.code, days: days)
            if klines.isEmpty {
                report.failures.append(summary.code)
                continue
            }
            let newRows = klines.filter { $0.date > lastDate }
            let added = (try? db.transaction { () -> Int in
                for kline in newRows {
                    _ = try repo.upsert(PricePoint(id: 0, underlyingCode: summary.code,
                                                   price: kline.close, date: kline.date,
                                                   source: "auto", open: kline.open,
                                                   high: kline.high, low: kline.low,
                                                   volume: kline.volume))
                }
                return newRows.count
            }) ?? 0
            report.saved += added
            report.codes += 1
            try? await Task.sleep(for: .milliseconds(400))
        }
        return report
    }
}
