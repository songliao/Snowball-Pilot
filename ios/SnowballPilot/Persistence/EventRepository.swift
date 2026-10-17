import Foundation

/// 事件记录（敲入/敲出/到期/派息登记，对应桌面端 electron/database/events.ts）。
/// nonisolated：连接 FULLMUTEX + WAL，UI 主线程与回填 actor 可并发访问。
nonisolated final class EventRepository {
    private let db: SQLiteDatabase

    init(database: SQLiteDatabase) {
        self.db = database
    }

    /// 按持仓查询事件（position_id + structure_type 定位，避免两表同 id 混淆）。
    func events(positionId: Int, structureType: StructureType) throws -> [MarketEvent] {
        try db.query(
            "SELECT * FROM events WHERE position_id = ? AND structure_type = ? ORDER BY event_date DESC",
            [.int(positionId), .text(structureType.rawValue)]
        ).map(Self.event(from:))
    }

    /// 全部事件（事件日历用）。
    func all() throws -> [MarketEvent] {
        try db.query("SELECT * FROM events ORDER BY event_date ASC").map(Self.event(from:))
    }

    @discardableResult
    func create(positionId: Int, eventType: String, eventDate: String,
                 description: String, structureType: StructureType) throws -> Int {
        try db.run(
            """
            INSERT INTO events (position_id, event_type, event_date, description, structure_type)
            VALUES (?, ?, ?, ?, ?)
            """,
            [.int(positionId), .text(eventType), .text(eventDate), .text(description), .text(structureType.rawValue)]
        )
        return db.lastInsertRowid()
    }

    func delete(id: Int) throws {
        try db.run("DELETE FROM events WHERE id = ?", [.int(id)])
    }

    private static func event(from row: SQLRow) -> MarketEvent {
        MarketEvent(
            id: row.int("id") ?? 0,
            positionId: row.int("position_id") ?? 0,
            eventType: row.string("event_type", or: ""),
            eventDate: row.string("event_date", or: ""),
            description: row.string("description", or: ""),
            structureType: StructureType(rawValue: row.string("structure_type", or: "snowball")) ?? .snowball,
            createdAt: row.string("created_at", or: "")
        )
    }
}
