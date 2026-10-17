import Foundation

/// 每用户独立数据库（多账号数据隔离，与桌面端一致）。
/// 文件名 snowball-pilot-<base64url(username)>.db，存于 Application Support。
/// nonisolated + @unchecked Sendable：底层连接 FULLMUTEX + WAL；
/// open/close 仅在主线程（登录/登出），业务读写允许回填 actor 与主线程并发。
nonisolated final class UserDatabase: @unchecked Sendable {
    private(set) var database: SQLiteDatabase?
    private(set) var username: String?

    var positions: PositionRepository? {
        database.map(PositionRepository.init)
    }

    var prices: PriceRepository? {
        database.map(PriceRepository.init)
    }

    var events: EventRepository? {
        database.map(EventRepository.init)
    }

    var isOpen: Bool { database != nil }

    /// 登录成功后调用：切换到该用户的独立数据库（幂等）。
    func open(for username: String) throws {
        if self.username == username, database != nil { return }
        close()

        let path = Self.filePath(for: username)
        let db = try SQLiteDatabase(path: path)
        do {
            try Self.setupSchema(db)
        } catch {
            db.close()
            throw error
        }
        database = db
        self.username = username
    }

    /// 登出时调用：关闭当前用户数据库。
    func close() {
        database?.close()
        database = nil
        username = nil
    }

    // MARK: - 路径与建表

    static func baseDirectory() throws -> String {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = support.appendingPathComponent("SnowballPilot", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.path
    }

    static func filePath(for username: String) -> String {
        let encoded = base64URL(Data(username.utf8))
        let name = "snowball-pilot-\(encoded).db"
        let directory = (try? baseDirectory()) ?? NSTemporaryDirectory()
        return (directory as NSString).appendingPathComponent(name)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// 建表 + 默认自选标的（幂等，对新建/已有库均安全）。
    static func setupSchema(_ db: SQLiteDatabase) throws {
        try db.run(Schema.createTableSQL(table: Schema.snowballTable, columns: Schema.columns(for: .snowball)))
        try db.run(Schema.createTableSQL(table: Schema.phoenixTable, columns: Schema.columns(for: .phoenix)))

        try db.run("""
        CREATE TABLE IF NOT EXISTS price_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          underlying_code TEXT NOT NULL,
          price REAL NOT NULL,
          date TEXT NOT NULL,
          source TEXT DEFAULT 'manual',
          open REAL,
          high REAL,
          low REAL,
          volume REAL,
          UNIQUE(underlying_code, date)
        );
        """)

        try db.run("""
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL,
          description TEXT DEFAULT '',
          structure_type TEXT DEFAULT 'snowball',
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
        """)

        try db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);")
        try db.run("CREATE TABLE IF NOT EXISTS watchlist (code TEXT PRIMARY KEY, sort_order INTEGER DEFAULT 0);")

        try db.run("CREATE INDEX IF NOT EXISTS idx_price_history_code ON price_history(underlying_code, date);")
        try db.run("CREATE INDEX IF NOT EXISTS idx_events_position ON events(position_id, structure_type);")
        try db.run("CREATE INDEX IF NOT EXISTS idx_snowball_status ON snowball_positions(status);")
        try db.run("CREATE INDEX IF NOT EXISTS idx_phoenix_status ON phoenix_positions(status);")

        // 首次启动：默认四大宽基指数为自选
        let seeded = try db.firstRow("SELECT value FROM meta WHERE key = 'watchlist_seeded'")
        if seeded == nil {
            let count = try db.firstRow("SELECT COUNT(*) AS c FROM watchlist")
            if (count?.int("c") ?? 0) == 0 {
                for code in ["000852.SH", "000905.SH", "000300.SH", "000016.SH"] {
                    try db.run("INSERT OR IGNORE INTO watchlist (code) VALUES (?)", [.text(code)])
                }
            }
            try db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('watchlist_seeded', '1')")
        }
    }

    // MARK: - meta 键值（回填版本等元数据）

    func meta(_ key: String) throws -> String? {
        guard let db = database else { return nil }
        return try db.firstRow("SELECT value FROM meta WHERE key = ?", [.text(key)])?.string("value")
    }

    func setMeta(_ key: String, _ value: String) throws {
        guard let db = database else { return }
        try db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [.text(key), .text(value)])
    }
}
