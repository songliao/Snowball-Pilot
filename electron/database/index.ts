import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

let db: SqlJsDatabase | null = null
let dbPath: string = ''

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
  }
}

export async function initDatabase(): Promise<void> {
  dbPath = join(app.getPath('userData'), 'snowball-manager.db')

  const SQL = await initSqlJs()

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      broker TEXT DEFAULT '',
      underlying TEXT NOT NULL,
      underlying_code TEXT DEFAULT '',
      notional REAL NOT NULL,
      trade_date TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      maturity_date TEXT NOT NULL,
      initial_price REAL NOT NULL,
      knock_in_pct REAL NOT NULL,
      knock_out_pct REAL NOT NULL DEFAULT 1.0,
      coupon_rate REAL NOT NULL,
      observation_freq TEXT DEFAULT 'monthly',
      knock_in_observed INTEGER DEFAULT 0,
      knock_out_observed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      underlying_code TEXT NOT NULL,
      price REAL NOT NULL,
      date TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      UNIQUE(underlying_code, date)
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
    );
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_code ON price_history(underlying_code, date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_position ON events(position_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);`)

  // 迁移：添加 margin_rate 字段
  try {
    db.run(`ALTER TABLE positions ADD COLUMN margin_rate REAL DEFAULT 0;`)
  } catch { /* 字段已存在则忽略 */ }

  saveDatabase()
  console.log('Database initialized at:', dbPath)
}

// 辅助函数：查询多行
export function queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const database = getDatabase()
  const stmt = database.prepare(sql)
  if (params) stmt.bind(params as never[])
  const results: T[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return results
}

// 辅助函数：查询单行
export function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
  const database = getDatabase()
  const stmt = database.prepare(sql)
  if (params) stmt.bind(params as never[])
  let result: T | null = null
  if (stmt.step()) {
    result = stmt.getAsObject() as T
  }
  stmt.free()
  return result
}

// 辅助函数：执行写操作
export function execute(sql: string, params?: unknown[]): void {
  const database = getDatabase()
  if (params) {
    database.run(sql, params as never[])
  } else {
    database.run(sql)
  }
  saveDatabase()
}

// 获取最后插入 ID
export function getLastInsertId(): number {
  const database = getDatabase()
  const result = queryOne<{ id: number }>('SELECT last_insert_rowid() as id')
  return result?.id || 0
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}
