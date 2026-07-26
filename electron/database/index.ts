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
  dbPath = join(app.getPath('userData'), 'snowball-pilot.db')

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

  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_code ON price_history(underlying_code, date);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_position ON events(position_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);`)

  // 自选标的（勾选后显示在总览页面的行情卡片）
  db.run(`
    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      sort_order INTEGER DEFAULT 0
    );
  `)

  // 迁移：添加 margin_rate 字段
  try {
    db.run(`ALTER TABLE positions ADD COLUMN margin_rate REAL DEFAULT 0;`)
  } catch { /* 字段已存在则忽略 */ }

  // 迁移：结构类型（snowball 雪球 / phoenix 凤凰）
  try {
    db.run(`ALTER TABLE positions ADD COLUMN structure_type TEXT DEFAULT 'snowball';`)
  } catch { /* 字段已存在则忽略 */ }

  // 迁移：凤凰类字段（派息障碍比例、派息观察频率）
  try {
    db.run(`ALTER TABLE positions ADD COLUMN coupon_barrier_pct REAL DEFAULT 0;`)
  } catch { /* 字段已存在则忽略 */ }
  try {
    db.run(`ALTER TABLE positions ADD COLUMN coupon_freq TEXT DEFAULT '';`)
  } catch { /* 字段已存在则忽略 */ }

  // 迁移：雪球簿记字段
  const snowballColumns = [
    `contract_no TEXT DEFAULT ''`,                 // 合约编号
    `interest_start_date TEXT DEFAULT ''`,          // 起息日
    `knock_out_dates TEXT DEFAULT ''`,              // 敲出观察日（日期序列，JSON）
    `knock_out_barriers TEXT DEFAULT ''`,           // 敲出障碍价格（百分比序列，JSON）
    `knock_out_coupons TEXT DEFAULT ''`,            // 敲出票息（百分比序列，JSON）
    `knock_out_enhance_participation REAL DEFAULT 0`, // 敲出增强参与率（百分比，默认0）
    `dividend_coupon REAL DEFAULT 0`,               // 红利票息（百分比，默认0）
    `knock_in_observation TEXT DEFAULT 'daily'`,    // 敲入观察方式（daily 每日 / maturity 到期）
    `knock_in_strike_pct REAL DEFAULT 100`,         // 敲入执行价格（百分比，默认100）
    `knock_in_participation REAL DEFAULT 100`,      // 敲入参与率（百分比，默认100）
    `max_loss_pct REAL DEFAULT 0`,                  // 最大亏损（百分比，默认与保证金比例一致）
    `rebate_annual_pct REAL DEFAULT 0`,             // 年化后端返息（百分比，默认0）
    `rebate_absolute_back_pct REAL DEFAULT 0`,      // 绝对后端返息（百分比，默认0）
    `rebate_absolute_front_pct REAL DEFAULT 0`,     // 绝对前端返息（百分比，默认0）
    `accrual_basis TEXT DEFAULT 'both'`,            // 计息规则（both 双含 / one 单含，默认双含）
    `accrual_settle_tplus INTEGER DEFAULT 0`,        // 计息结算T+（整数，默认0）
    `abs_fee_pct REAL DEFAULT 0`,                    // 绝对费用（按名义本金的百分比）
    `annual_fee_pct REAL DEFAULT 0`,                 // 年化费用（按名义本金百分比年化）
    `income_dividend_pct REAL DEFAULT 0`,            // 收益分红（按票息的百分比）
    `dividend_observation_dates TEXT DEFAULT ''`,    // 派息观察日（日期序列，JSON）
    `dividend_rate_pct REAL DEFAULT 0`               // 派息率（按名义本金绝对，百分比）
  ]
  for (const col of snowballColumns) {
    try {
      db.run(`ALTER TABLE positions ADD COLUMN ${col};`)
    } catch { /* 字段已存在则忽略 */ }
  }

  // 迁移：price_history 增加 开/高/低/成交量 字段（用于蜡烛图展示真实 K 线）
  for (const col of ['open REAL', 'high REAL', 'low REAL', 'volume REAL']) {
    try {
      db.run(`ALTER TABLE price_history ADD COLUMN ${col};`)
    } catch { /* 字段已存在则忽略 */ }
  }

  // 迁移：price_history 增加 均线 字段（MA5 / MA10 / MA20，基于收盘价）
  for (const col of ['ma5 REAL', 'ma10 REAL', 'ma20 REAL']) {
    try {
      db.run(`ALTER TABLE price_history ADD COLUMN ${col};`)
    } catch { /* 字段已存在则忽略 */ }
  }

  // 首次启动：把默认 4 个宽基指数设为默认自选（仅在从未初始化过时）
  if (!getMeta('watchlist_seeded')) {
    const cnt = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM watchlist')
    if (!cnt || cnt.c === 0) {
      const defaults = ['000852.SH', '000905.SH', '000300.SH', '000016.SH']
      for (const code of defaults) {
        db.run('INSERT OR IGNORE INTO watchlist (code) VALUES (?)', [code])
      }
    }
    setMeta('watchlist_seeded', '1')
  }

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

// 键值存储（用于保存回填版本等元数据）
export function getMeta(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
}
