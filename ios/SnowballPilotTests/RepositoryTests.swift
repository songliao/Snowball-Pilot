import Foundation
import Testing
@testable import SnowballPilot

@Suite("SQLite 仓储")
struct RepositoryTests {
    private func makeDB() throws -> SQLiteDatabase {
        try SQLiteDatabase(path: nil) // 内存库
    }

    private func sampleSnowball() -> Position {
        var p = Position(structureType: .snowball)
        p.productName = "中证1000雪球"
        p.broker = "测试券商"
        p.contractNo = "SB-001"
        p.tradeStartDate = "2025-03-05"
        p.underlyingCode = "000852.SH"
        p.notional = 2000000
        p.initialPrice = 6213.44
        p.knockInBarrier = 0.75
        p.knockInStrike = 100
        p.marginRatio = 0.12
        p.knockOutDates = "[\"2025-09-05\",\"2026-03-05\"]"
        p.knockOutBarriers = "[102,102]"
        p.knockOutCoupons = "[15.2,16.8]"
        p.notes = "带,逗号 与\"引号\""
        return p
    }

    @Test("持仓 create → fetchAll → fetch → update → delete 全链路")
    func positionRoundTrip() throws {
        let db = try makeDB()
        try UserDatabase.setupSchema(db)
        let repo = PositionRepository(database: db)

        let snowball = sampleSnowball()
        let id = try repo.create(snowball)
        #expect(id > 0)

        var phoenix = Position(structureType: .phoenix)
        phoenix.productName = "凤凰DCN"
        phoenix.underlyingCode = "000300.SH"
        phoenix.notional = 1000000
        phoenix.couponBarrier = 0.8
        phoenix.couponRate = 0.042
        let phoenixId = try repo.create(phoenix)
        #expect(phoenixId > 0)

        let all = try repo.fetchAll()
        #expect(all.count == 2)
        #expect(all.contains { $0.structureType == .snowball && $0.productName == "中证1000雪球" })
        #expect(all.contains { $0.structureType == .phoenix && $0.couponRate == 0.042 })

        // 两表 id 独立：按类型取
        let fetchedSnowball = try #require(try repo.fetch(id: id, type: .snowball))
        var expectedSnowball = snowball
        expectedSnowball.id = id
        expectedSnowball.createdAt = fetchedSnowball.createdAt // DB 写入 datetime('now','localtime')
        #expect(fetchedSnowball == expectedSnowball)
        let fetchedPhoenix = try #require(try repo.fetch(id: phoenixId, type: .phoenix))
        #expect(fetchedPhoenix.notional == 1000000)
        #expect(fetchedPhoenix.couponBarrier == 0.8)
        // 不存在的 id 查不到；同号 id 也必须按 structure_type 定位到正确的表
        #expect(try repo.fetch(id: 999_999, type: .snowball) == nil)
        #expect(try repo.fetch(id: 999_999, type: .phoenix) == nil)

        // 全量更新
        var updated = fetchedSnowball
        updated.notional = 2500000
        updated.status = .knockedOut
        updated.terminationDate = "2025-09-05"
        updated.terminationPayoff = 152340.56
        try repo.update(updated)
        let reloaded = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(reloaded.notional == 2500000)
        #expect(reloaded.status == .knockedOut)
        #expect(reloaded.terminationDate == "2025-09-05")
        #expect(reloaded.terminationPayoff == 152340.56)

        // 删除（含事件级联）
        let eventRepo = EventRepository(database: db)
        _ = try eventRepo.create(positionId: id, eventType: "knock_out", eventDate: "2025-09-05",
                                 description: "敲出", structureType: .snowball)
        _ = reloaded
        try repo.delete(id: id, type: .snowball)
        #expect(try repo.fetch(id: id, type: .snowball) == nil)
        #expect(try eventRepo.events(positionId: id, structureType: .snowball).isEmpty)
    }

    @Test("状态流转：敲入标记/撤销、了结登记")
    func statusTransitions() throws {
        let db = try makeDB()
        try UserDatabase.setupSchema(db)
        let repo = PositionRepository(database: db)

        let id = try repo.create(sampleSnowball())

        // 标记敲入
        try repo.updateStatus(id: id, type: .snowball, status: .knockedIn,
                              isKi: true, knockInDate: "2025-11-14")
        var p = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(p.status == .knockedIn)
        #expect(p.isKi)
        #expect(p.knockInDate == "2025-11-14")

        // 撤销敲入
        try repo.updateStatus(id: id, type: .snowball, status: .active, isKi: false)
        p = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(p.status == .active)
        #expect(!p.isKi)
        #expect(p.knockInDate.isEmpty)

        // 了结登记（收益清空路径）
        try repo.updateStatus(id: id, type: .snowball, status: .knockedOut,
                              terminationDate: "2026-03-05", payoff: .some(nil))
        p = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(p.terminationDate == "2026-03-05")

        // 了结收益赋值
        try repo.updateStatus(id: id, type: .snowball, status: .knockedOut, payoff: .some(999.5))
        p = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(p.terminationPayoff == 999.5)

        // 非法日期不写入
        try repo.updateStatus(id: id, type: .snowball, status: .knockedIn,
                              isKi: true, knockInDate: "2025/11/14")
        p = try #require(try repo.fetch(id: id, type: .snowball))
        #expect(p.knockInDate.isEmpty)
    }

    @Test("行情：upsert 幂等、周末拒绝")
    func priceUpsert() throws {
        let db = try makeDB()
        try UserDatabase.setupSchema(db)
        let repo = PriceRepository(database: db)

        // 2026-10-12(周一) ~ 2026-10-16(周五)
        let closes: [(String, Double)] = [
            ("2026-10-12", 10), ("2026-10-13", 11), ("2026-10-14", 12),
            ("2026-10-15", 13), ("2026-10-16", 14)
        ]
        for (index, (date, close)) in closes.enumerated() {
            let point = PricePoint(id: 0, underlyingCode: "000852.SH", price: close, date: date,
                                   source: "auto", open: close - 0.5, high: close + 0.5,
                                   low: close - 1, volume: 1000 + Double(index))
            #expect(try repo.upsert(point))
        }
        // 周六拒绝
        let weekend = PricePoint(id: 0, underlyingCode: "000852.SH", price: 99, date: "2026-10-17",
                                 source: "manual", open: nil, high: nil, low: nil, volume: nil)
        #expect(try !repo.upsert(weekend))

        // 幂等覆盖：同 code+date 更新
        #expect(try repo.upsert(PricePoint(id: 0, underlyingCode: "000852.SH", price: 12.5,
                                           date: "2026-10-14", source: "auto",
                                           open: 12, high: 13, low: 11.5, volume: 2000)))
        let history = try repo.history(code: "000852.SH")
        #expect(history.count == 5)
        #expect(try #require(try repo.latest(code: "000852.SH")).price == 14)

        let ohlc = try repo.ohlcHistory(code: "000852.SH")
        #expect(ohlc.count == 5)
        #expect(ohlc[2].close == 12.5) // 10-14 已被覆盖
        #expect(ohlc[3].close == 13)

        #expect(try repo.latestDate() != nil)
        try repo.deleteByCode(code: "000852.SH")
        #expect(try repo.history(code: "000852.SH").isEmpty)
    }

    @Test("自选标的：默认种子与全量替换")
    func watchlist() throws {
        let db = try makeDB()
        try UserDatabase.setupSchema(db)
        let repo = PriceRepository(database: db)

        // 默认四大宽基
        let seeded = try repo.watchlist()
        #expect(seeded == ["000852.SH", "000905.SH", "000300.SH", "000016.SH"])

        try repo.setWatchlist(["000300.SH", "000001.SH"])
        #expect(try repo.watchlist() == ["000300.SH", "000001.SH"])
    }

    @Test("事件：按持仓+结构类型隔离")
    func events() throws {
        let db = try makeDB()
        try UserDatabase.setupSchema(db)
        let repo = EventRepository(database: db)

        _ = try repo.create(positionId: 1, eventType: "knock_in", eventDate: "2025-11-14",
                            description: "敲入登记", structureType: .snowball)
        _ = try repo.create(positionId: 1, eventType: "dividend", eventDate: "2025-09-10",
                            description: "派息", structureType: .phoenix)

        let snowballEvents = try repo.events(positionId: 1, structureType: .snowball)
        #expect(snowballEvents.count == 1)
        #expect(snowballEvents[0].eventType == "knock_in")

        let phoenixEvents = try repo.events(positionId: 1, structureType: .phoenix)
        #expect(phoenixEvents.count == 1)
        #expect(phoenixEvents[0].eventType == "dividend")

        // 升序
        let all = try repo.all()
        #expect(all.map(\.eventDate) == ["2025-09-10", "2025-11-14"])

        try repo.delete(id: snowballEvents[0].id)
        #expect(try repo.events(positionId: 1, structureType: .snowball).isEmpty)
    }

    @Test("用户库路径与 meta 键值")
    func userDatabase() throws {
        let userDB = UserDatabase()
        let path = UserDatabase.filePath(for: "测试用户A")
        #expect(path.contains("snowball-pilot-"))
        #expect(!path.contains("测试用户A")) // base64url 编码后不含原始用户名

        try userDB.open(for: "测试用户A")
        #expect(userDB.isOpen)
        try userDB.setMeta("backfill-version", "730")
        #expect(try userDB.meta("backfill-version") == "730")
        try userDB.open(for: "user-b") // 切换账号
        #expect(try userDB.meta("backfill-version") == nil)
        userDB.close()
        #expect(!userDB.isOpen)
    }
}
