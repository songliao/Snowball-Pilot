import Foundation
import SQLite3

/// SQLite 动态类型的 Swift 映射。
nonisolated enum SQLValue: Equatable {
    case null
    case text(String)
    case int(Int)
    case real(Double)
    case blob(Data)

    var stringValue: String? {
        if case .text(let value) = self { value } else { nil }
    }

    var doubleValue: Double? {
        switch self {
        case .real(let value): value
        case .int(let value): Double(value)
        default: nil
        }
    }

    var intValue: Int? {
        switch self {
        case .int(let value): value
        case .real(let value): Int(value)
        default: nil
        }
    }

    var boolValue: Bool? {
        switch self {
        case .int(let value): value != 0
        case .real(let value): value != 0
        default: nil
        }
    }
}

/// 一行查询结果（列名 → 值），提供带默认值的类型化读取。
nonisolated struct SQLRow {
    private let values: [String: SQLValue]

    init(values: [String: SQLValue]) {
        self.values = values
    }

    subscript(_ column: String) -> SQLValue { values[column] ?? .null }

    func string(_ column: String) -> String? { self[column].stringValue }
    func string(_ column: String, or fallback: String) -> String { self[column].stringValue ?? fallback }
    func double(_ column: String) -> Double? { self[column].doubleValue }
    func double(_ column: String, or fallback: Double) -> Double { self[column].doubleValue ?? fallback }
    func int(_ column: String) -> Int? { self[column].intValue }
    func int(_ column: String, or fallback: Int) -> Int { self[column].intValue ?? fallback }
    func bool(_ column: String) -> Bool { self[column].boolValue ?? false }
}

nonisolated enum SQLDatabaseError: Error, Equatable {
    case openFailed(String)
    case prepareFailed(String)
    case stepFailed(String)
    case bindFailed(String)
}

/// sqlite3 C API 的薄封装。
/// UI 读写在主线程；行情回填/增量更新在 IndexHistoryService actor（后台线程）。
/// 连接以 FULLMUTEX 打开并启用 WAL + busy_timeout，跨线程并发安全；
/// 批量写入用 transaction() 包裹，避免逐行隐式事务的 fsync 放大。
nonisolated final class SQLiteDatabase: @unchecked Sendable {
    nonisolated(unsafe) private var handle: OpaquePointer?

    /// - Parameter path: 数据库文件路径；`nil` 表示内存库（测试用）。
    init(path: String?) throws {
        let cPath = path ?? ":memory:"
        var dbHandle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(cPath, &dbHandle, flags, nil) == SQLITE_OK, let dbHandle else {
            let message = dbHandle.map { String(cString: sqlite3_errmsg($0)) } ?? "无法打开数据库"
            sqlite3_close(dbHandle)
            throw SQLDatabaseError.openFailed(message)
        }
        handle = dbHandle
        sqlite3_busy_timeout(dbHandle, 3000)
        // WAL：后台写事务不再阻塞主线程读；NORMAL 在 WAL 下崩溃最多丢最后一次事务，可接受
        _ = try? query("PRAGMA journal_mode=WAL")
        try? run("PRAGMA synchronous=NORMAL")
    }

    deinit {
        if let handle { sqlite3_close_v2(handle) }
    }

    func close() {
        if let handle {
            sqlite3_close_v2(handle)
            self.handle = nil
        }
    }

    /// 执行写操作（INSERT / UPDATE / DELETE / DDL）
    func run(_ sql: String, _ params: [SQLValue] = []) throws {
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw SQLDatabaseError.stepFailed(errorMessage)
        }
    }

    func query(_ sql: String, _ params: [SQLValue] = []) throws -> [SQLRow] {
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        let columnCount = sqlite3_column_count(statement)
        let names = (0..<columnCount).map { String(cString: sqlite3_column_name(statement, $0)) }
        var rows: [SQLRow] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            var values: [String: SQLValue] = [:]
            values.reserveCapacity(names.count)
            for (index, name) in names.enumerated() {
                values[name] = Self.columnValue(statement, index: Int32(index))
            }
            rows.append(SQLRow(values: values))
        }
        return rows
    }

    func firstRow(_ sql: String, _ params: [SQLValue] = []) throws -> SQLRow? {
        try query(sql, params).first
    }

    /// 事务批量执行：BEGIN IMMEDIATE … COMMIT；body 抛错则整体 ROLLBACK。
    func transaction<T>(_ body: () throws -> T) throws -> T {
        try run("BEGIN IMMEDIATE TRANSACTION")
        do {
            let result = try body()
            try run("COMMIT")
            return result
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    func lastInsertRowid() -> Int {
        Int(sqlite3_last_insert_rowid(handle))
    }

    // MARK: - Private

    private var errorMessage: String {
        handle.map { String(cString: sqlite3_errmsg($0)) } ?? "数据库未打开"
    }

    private func prepare(_ sql: String, _ params: [SQLValue]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw SQLDatabaseError.prepareFailed(errorMessage)
        }
        do {
            try bind(params, to: statement)
        } catch {
            sqlite3_finalize(statement)
            throw error
        }
        return statement
    }

    private func bind(_ params: [SQLValue], to statement: OpaquePointer) throws {
        // SQLITE_TRANSIENT：让 SQLite 立即复制文本/blob 值
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (offset, param) in params.enumerated() {
            let index = Int32(offset + 1)
            let status: Int32
            switch param {
            case .null:
                status = sqlite3_bind_null(statement, index)
            case .text(let value):
                status = sqlite3_bind_text(statement, index, value, -1, transient)
            case .int(let value):
                status = sqlite3_bind_int64(statement, index, Int64(value))            case .real(let value):
                status = sqlite3_bind_double(statement, index, value)
            case .blob(let data):
                status = data.withUnsafeBytes { buffer in
                    sqlite3_bind_blob(statement, index, buffer.baseAddress, Int32(data.count), transient)
                }
            }
            guard status == SQLITE_OK else { throw SQLDatabaseError.bindFailed(errorMessage) }
        }
    }

    private static func columnValue(_ statement: OpaquePointer, index: Int32) -> SQLValue {
        switch sqlite3_column_type(statement, index) {
        case SQLITE_INTEGER: .int(Int(sqlite3_column_int64(statement, index)))
        case SQLITE_FLOAT: .real(sqlite3_column_double(statement, index))
        case SQLITE_TEXT: .text(String(cString: sqlite3_column_text(statement, index)))
        case SQLITE_BLOB:
            if let bytes = sqlite3_column_blob(statement, index) {
                .blob(Data(bytes: bytes.assumingMemoryBound(to: UInt8.self),
                           count: Int(sqlite3_column_bytes(statement, index))))
            } else {
                .blob(Data())
            }
        default: .null
        }
    }
}
