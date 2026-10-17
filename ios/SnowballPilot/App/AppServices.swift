import Foundation
import Observation

/// 登录后的应用服务容器：持有用户数据库与全部业务状态。
/// 视图通过 @Environment 读取；所有可变状态集中在此，保证 UI 响应式。
@Observable
final class AppServices {
    let userDatabase = UserDatabase()
    let market = MarketDataClient()

    private(set) var positions: [Position] = []
    private(set) var latestPrices: [String: Double] = [:]      // 标的最新价（快照或实时）
    private(set) var watchlist: [String] = []                  // 自选指数
    private(set) var indexQuotes: [String: IndexQuote] = [:]   // 自选指数实时行情
    private(set) var latestDataDate: String?                   // 行情数据截止日期

    // MARK: - 预警设置（UserDefaults 持久化）

    private static let alertConfigKey = "alert-config"

    var alertConfig: AlertEngine.Config {
        get {
            guard let data = UserDefaults.standard.data(forKey: Self.alertConfigKey),
                  let config = try? JSONDecoder().decode(AlertEngine.Config.self, from: data)
            else { return .defaults }
            return config
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: Self.alertConfigKey)
            }
        }
    }

    // MARK: - 生命周期

    /// 回填单飞门（AppServices 默认 MainActor 隔离，静态门跨实例生效）：
    /// openDatabase 在启动期可能被竞态地多次触发，不加门会出现多个回填并行
    /// 删旧重建行情库，与主线程争抢 SQLite 连接，表现为界面周期性卡死。
    private static var backfillInFlight = false
    private var historyTask: Task<Void, Never>?

    func openDatabase(username: String) throws {
        try userDatabase.open(for: username)
        reloadPositions()
        loadWatchlist()
        loadStoredPrices()
        // 后台补足行情历史（首次全量 730 天，之后增量到今天），不阻塞进入主界面
        guard !Self.backfillInFlight else { return }
        Self.backfillInFlight = true
        historyTask = Task {
            await ensureHistoryBackfilled()
            Self.backfillInFlight = false
        }
    }

    /// 与桌面端 ensureHistoryBackfilled 一致：meta 版本门控全量回填 + 每次增量补足至今天。
    private func ensureHistoryBackfilled() async {
        let service = IndexHistoryService(database: userDatabase, market: market)
        let backfillVersion = "730"
        if (try? userDatabase.meta("history_backfill_version")) != backfillVersion {
            let report = await service.backfillAll(days: 730, clean: true)
            if report.saved > 0 {
                try? userDatabase.setMeta("history_backfill_version", backfillVersion)
            }
        }
        _ = await service.refreshToToday()
        loadStoredPrices()
    }

    func closeDatabase() {
        historyTask?.cancel()
        historyTask = nil
        Self.backfillInFlight = false
        userDatabase.close()
        positions = []
        latestPrices = [:]
        watchlist = []
        indexQuotes = [:]
        latestDataDate = nil
    }

    // MARK: - 持仓

    func reloadPositions() {
        positions = (try? userDatabase.positions?.fetchAll()) ?? []
    }

    /// 新建或全量更新持仓，返回带 id 的记录。
    @discardableResult
    func savePosition(_ position: Position) throws -> Position {
        guard let repo = userDatabase.positions else { throw ServicesError.databaseClosed }
        if position.id == 0 {
            var newOne = position
            newOne.id = try repo.create(position)
            reloadPositions()
            return newOne
        }
        try repo.update(position)
        reloadPositions()
        return position
    }

    func deletePosition(_ position: Position) throws {
        guard let repo = userDatabase.positions else { throw ServicesError.databaseClosed }
        try repo.delete(id: position.id, type: position.structureType)
        reloadPositions()
    }

    /// 状态流转（敲入/撤销敲入/了结），并联动事件登记由调用方处理。
    func updateStatus(_ position: Position, status: PositionStatus,
                      isKi: Bool? = nil, knockInDate: String? = nil,
                      terminationDate: String? = nil, payoff: Double?? = nil) throws {
        guard let repo = userDatabase.positions else { throw ServicesError.databaseClosed }
        try repo.updateStatus(id: position.id, type: position.structureType, status: status,
                              isKi: isKi, knockInDate: knockInDate,
                              terminationDate: terminationDate, payoff: payoff)
        reloadPositions()
    }

    // MARK: - 事件

    func events(for position: Position) -> [MarketEvent] {
        guard let repo = userDatabase.events else { return [] }
        return (try? repo.events(positionId: position.id, structureType: position.structureType)) ?? []
    }

    @discardableResult
    func createEvent(_ position: Position, type: String, date: String, description: String) -> Bool {
        guard let repo = userDatabase.events else { return false }
        return (try? repo.create(positionId: position.id, eventType: type, eventDate: date,
                                 description: description, structureType: position.structureType)) != nil
    }

    // MARK: - 行情价格

    /// 打开页面时用本地行情快照填充最新价（不联网）。
    /// 聚合查询放后台执行、结果回主线程套用——避免随机时机的主线程 SQL 造成 UI 卡顿。
    func loadStoredPrices() {
        guard let repo = userDatabase.prices else { return }
        Task {
            let result = await Self.readPriceSnapshot(repo: repo)
            latestDataDate = result.latest
            var snapshot = latestPrices
            for summary in result.summaries where summary.latestPrice > 0 {
                snapshot[summary.code] = summary.latestPrice
            }
            latestPrices = snapshot
        }
    }

    private nonisolated static func readPriceSnapshot(repo: PriceRepository) async -> (latest: String?, summaries: [PriceCodeSummary]) {
        await Task.detached(priority: .utility) {
            ((try? repo.latestDate()) ?? nil, (try? repo.codeSummaries()) ?? [])
        }.value
    }

    /// 批量拉取实时价（仅内存，与桌面端 fetchBatchLatest 同源语义）。
    func refreshLatestPrices(codes: [String]) async {
        let unique = Array(Set(codes)).sorted()
        guard !unique.isEmpty else { return }
        let results = await market.fetchPrices(codes: unique)
        var updated = latestPrices
        for (code, result) in results where result.price > 0 {
            updated[code] = result.price
        }
        latestPrices = updated
    }

    /// 存续合约的标的最新的实时价。
    func refreshAlertPrices() async {
        let codes = positions
            .filter { $0.status != .knockedOut && $0.status != .matured }
            .compactMap { $0.underlyingCode.isEmpty ? nil : $0.underlyingCode }
        await refreshLatestPrices(codes: codes)
    }

    /// 拉取某标的实时价并落库（详情页用）。落库放后台：主线程不做 SQLite 写入。
    func fetchAndStorePrice(for position: Position) async -> Double? {
        guard let repo = userDatabase.prices,
              let result = await market.fetchPrice(code: position.underlyingCode)
        else { return nil }
        let point = PricePoint(id: 0, underlyingCode: position.underlyingCode,
                               price: result.price, date: AppDate.todayUTCString(), source: "auto",
                               open: nil, high: nil, low: nil, volume: nil)
        latestPrices[position.underlyingCode] = result.price
        let latest: String? = await Task.detached(priority: .utility) {
            _ = try? repo.upsert(point)
            return (try? repo.latestDate()) ?? nil
        }.value
        latestDataDate = latest ?? latestDataDate
        return result.price
    }

    // MARK: - 自选指数

    func loadWatchlist() {
        watchlist = (try? userDatabase.prices?.watchlist()) ?? []
    }

    func setWatchlist(_ codes: [String]) {
        guard let repo = userDatabase.prices else { return }
        try? repo.setWatchlist(codes)
        loadWatchlist()
    }

    /// 拉取自选指数实时行情并落库（总览页）。行情落库放后台：主线程不做 SQLite 写入，
    /// 避免与后台回填争抢写锁（busy_timeout 最长 3 秒）时卡 UI。
    func refreshQuotes() async {
        guard !watchlist.isEmpty else { return }
        var results = indexQuotes
        let today = AppDate.todayUTCString()
        for code in watchlist {
            guard let quote = await market.fetchIndexQuote(code: code) else { continue }
            results[code] = quote
            // 自动保存快照，重开页面仍展示
            if let repo = userDatabase.prices {
                let point = PricePoint(id: 0, underlyingCode: code, price: quote.price,
                                       date: today, source: "auto", open: quote.open,
                                       high: quote.high, low: quote.low, volume: quote.volume)
                Task.detached(priority: .utility) {
                    _ = try? repo.upsert(point)
                }
            }
        }
        indexQuotes = results
        let repo = userDatabase.prices
        let latest: String? = await Task.detached(priority: .utility) {
            (try? repo?.latestDate()) ?? nil
        }.value
        latestDataDate = latest ?? latestDataDate
    }

    // MARK: - 预警

    func computeAlerts() -> [AlertEngine.Item] {
        AlertEngine.compute(positions: positions, latestPrices: latestPrices, config: alertConfig)
    }

    // MARK: - 总览统计（口径与桌面端 Dashboard 一致）

    struct Summary: Equatable {
        var activeNotional: Double
        var totalNotional: Double
        var activeMargin: Double
        var totalMargin: Double
        var activeContracts: Int
        var totalContracts: Int
        var settledGain: Double
        var snowballSettledGain: Double
        var phoenixSettledGain: Double
        var phoenixCouponGain: Double
    }

    var summary: Summary {
        let active = positions.filter { $0.status == .active }
        let activeNotional = active.reduce(0) { $0 + $1.notional }
        let totalNotional = positions.reduce(0) { $0 + $1.notional }
        let activeMargin = active.reduce(0) { $0 + $1.notional * $1.marginRatio }
        let totalMargin = positions.reduce(0) { $0 + $1.notional * $1.marginRatio }

        let isSettled = { (p: Position) in p.status == .knockedOut || p.status == .matured }
        let snowballSettled = positions
            .filter { $0.structureType == .snowball && isSettled($0) }
            .reduce(0) { $0 + $1.terminationPayoff }
        let phoenixSettled = positions
            .filter { $0.structureType == .phoenix && isSettled($0) }
            .reduce(0) { $0 + $1.terminationPayoff }
        let phoenixCoupons = positions
            .filter { $0.structureType == .phoenix }
            .reduce(0) { $0 + Calc.numberArray($1.couponReceived).reduce(0, +) }
        return Summary(
            activeNotional: activeNotional,
            totalNotional: totalNotional,
            activeMargin: activeMargin,
            totalMargin: totalMargin,
            activeContracts: active.count,
            totalContracts: positions.count,
            settledGain: snowballSettled + phoenixSettled + phoenixCoupons,
            snowballSettledGain: snowballSettled,
            phoenixSettledGain: phoenixSettled,
            phoenixCouponGain: phoenixCoupons
        )
    }

    enum ServicesError: Error {
        case databaseClosed
    }
}
