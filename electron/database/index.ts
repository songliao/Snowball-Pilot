import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { SNOWBALL_TABLE, PHOENIX_TABLE, SNOWBALL_COLS, PHOENIX_COLS } from './schema'

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let currentUser: string | null = null
let SQL: any = null

// ——— 多用户数据隔离 ———
// 每个用户使用独立的数据库文件：snowball-pilot-<username>.db。
// 登录（auth:login / auth:resume）成功后由主进程切换到相应用户的库，
// 登出（auth:logout）则关闭当前库。不同账号的持仓 / 行情 / 自选 / 事件等数据完全不互通。

// 文件名仅保留安全字符，避免路径穿越与非法文件名（Windows 不允许 \ / : * ? " < > |）
function safeUserFile(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return safe ? safe.slice(0, 64) : 'default'
}

export function getUserDbPath(username: string): string {
  return join(app.getPath('userData'), `snowball-pilot-${safeUserFile(username)}.db`)
}

export function getCurrentUser(): string | null {
  return currentUser
}

// 应用级元数据（不随用户隔离），用于把旧版单库数据一次性迁移给首个登录的用户
function getRootMetaPath(): string {
  return join(app.getPath('userData'), 'app-meta.json')
}
function readRootMeta(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(getRootMetaPath(), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeRootMeta(meta: Record<string, unknown>): void {
  writeFileSync(getRootMetaPath(), JSON.stringify(meta, null, 2))
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized (no user logged in)')
  }
  return db
}

export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
  }
}

// sql.js 运行需要加载 sql-wasm.wasm。开发模式下从 node_modules 加载；
// 打包后 node_modules 已被排除，wasm 通过 electron-builder 的 extraResources
// 拷贝到 resources 目录，这里统一从 resourcesPath 定位。
function getSqlWasmLocateFile(): (file: string) => string {
  if (app.isPackaged) {
    return (s: string) => join(process.resourcesPath, s)
  }
  // 开发模式：从项目根下的 node_modules/sql.js/dist 加载
  return (s: string) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', s)
}

// 仅加载一次 sql.js 引擎（不依赖具体用户库）
async function loadSqlEngine(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: getSqlWasmLocateFile() })
  }
}

// 建表 + 历史迁移（每次打开用户库时执行，对新建 / 已有库均幂等）
function setupSchema(): void {
  // 创建表（雪球 / 凤凰 分表，列定义与 schema.ts 保持一致）
  db!.run(buildCreateSql(SNOWBALL_TABLE, SNOWBALL_COLS))
  db!.run(buildCreateSql(PHOENIX_TABLE, PHOENIX_COLS))

  db!.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      underlying_code TEXT NOT NULL,
      price REAL NOT NULL,
      date TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      UNIQUE(underlying_code, date)
    );
  `)

  db!.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      description TEXT DEFAULT '',
      structure_type TEXT DEFAULT 'snowball',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `)

  db!.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  db!.run(`CREATE INDEX IF NOT EXISTS idx_price_history_code ON price_history(underlying_code, date);`)
  db!.run(`CREATE INDEX IF NOT EXISTS idx_events_position ON events(position_id, structure_type);`)
  db!.run(`CREATE INDEX IF NOT EXISTS idx_snowball_status ON snowball_positions(status);`)
  db!.run(`CREATE INDEX IF NOT EXISTS idx_phoenix_status ON phoenix_positions(status);`)

  // 旧 positions 表迁移到分表（仅首次，迁移后删除旧表）
  migrateFromLegacyPositions()
  // 雪球表字段演进迁移：重命名 / 删除 / 新增（仅对旧库生效）
  migrateSnowballColumns()
  // 凤凰表字段演进迁移（仅对旧库生效）
  migratePhoenixColumns()
  // events 兼容旧数据：补齐 structure_type 列
  try {
    db!.run(`ALTER TABLE events ADD COLUMN structure_type TEXT DEFAULT 'snowball';`)
  } catch { /* 已存在则忽略 */ }

  // 自选标的（勾选后显示在总览页面的行情卡片）
  db!.run(`
    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      sort_order INTEGER DEFAULT 0
    );
  `)

  // 迁移：price_history 增加 开/高/低/成交量 字段（用于蜡烛图展示真实 K 线）
  for (const col of ['open REAL', 'high REAL', 'low REAL', 'volume REAL']) {
    try {
      db!.run(`ALTER TABLE price_history ADD COLUMN ${col};`)
    } catch { /* 字段已存在则忽略 */ }
  }

  // 迁移：price_history 增加 均线 字段（MA5 / MA10 / MA20，基于收盘价）
  for (const col of ['ma5 REAL', 'ma10 REAL', 'ma20 REAL']) {
    try {
      db!.run(`ALTER TABLE price_history ADD COLUMN ${col};`)
    } catch { /* 字段已存在则忽略 */ }
  }

  // 首次启动（针对当前用户库）：把默认 4 个宽基指数设为默认自选
  if (!getMeta('watchlist_seeded')) {
    const cnt = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM watchlist')
    if (!cnt || cnt.c === 0) {
      const defaults = ['000852.SH', '000905.SH', '000300.SH', '000016.SH']
      for (const code of defaults) {
        db!.run('INSERT OR IGNORE INTO watchlist (code) VALUES (?)', [code])
      }
    }
    setMeta('watchlist_seeded', '1')
  }
}

// 打开 / 切换至指定用户的数据库（登录成功后调用）
export async function openUserDatabase(username: string): Promise<void> {
  await loadSqlEngine()

  // 关闭当前已打开的库（如有），先落盘避免数据丢失
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }

  const targetPath = getUserDbPath(username)

  // 一次性迁移：旧版单库 snowball-pilot.db 的数据归属「首个登录」的用户，
  // 避免历史持仓在隔离改造中丢失；之后的用户各自从空库开始。
  if (!existsSync(targetPath)) {
    const legacyPath = join(app.getPath('userData'), 'snowball-pilot.db')
    const rootMeta = readRootMeta()
    if (!rootMeta.legacyMigrated && existsSync(legacyPath)) {
      try {
        copyFileSync(legacyPath, targetPath)
        rootMeta.legacyMigrated = true
        rootMeta.legacyOwner = username
        writeRootMeta(rootMeta)
        console.log(`[DB] 旧版数据已迁移至用户「${username}」的独立数据库`)
      } catch (e) {
        console.error('[DB] 迁移旧版数据失败：', e)
      }
    }
  }

  dbPath = targetPath
  if (existsSync(targetPath)) {
    db = new SQL.Database(readFileSync(targetPath))
  } else {
    db = new SQL.Database()
  }
  currentUser = username

  setupSchema()
  saveDatabase()
  console.log('Database opened for user', username, 'at', dbPath)
}

// 应用启动时调用：仅加载 sql.js 引擎，不打开任何用户库。
// 真正的用户库在登录（auth:login / auth:resume）成功后由 openUserDatabase 打开。
export async function initDatabase(): Promise<void> {
  await loadSqlEngine()
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
  currentUser = null
}

// 键值存储（用于保存回填版本等元数据）
export function getMeta(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
}

// 列类型映射（与 schema.ts 的列定义保持一致，用于动态生成建表语句）
const COL_TYPES: Record<string, string> = {
  product_name: "TEXT DEFAULT ''",
  broker: "TEXT DEFAULT ''",
  contract_no: "TEXT DEFAULT ''",
  underlying_code: "TEXT DEFAULT ''",
  notional: 'REAL DEFAULT 0',
  initial_price: 'REAL DEFAULT 0',
  knock_out_dates: "TEXT DEFAULT ''",
  knock_out_barriers: "TEXT DEFAULT ''",
  knock_in_observation: "TEXT DEFAULT 'daily'",
  knock_in_participation: 'REAL DEFAULT 100',
  max_loss_pct: 'REAL DEFAULT 0',
  rebate_annual_pct: 'REAL DEFAULT 0',
  rebate_absolute_back_pct: 'REAL DEFAULT 0',
  rebate_absolute_front_pct: 'REAL DEFAULT 0',
  accrual_basis: "TEXT DEFAULT 'both'",
  accrual_settle_tplus: 'INTEGER DEFAULT 0',
  abs_fee_pct: 'REAL DEFAULT 0',
  annual_fee_pct: 'REAL DEFAULT 0',
  income_dividend_pct: 'REAL DEFAULT 0',
  notes: "TEXT DEFAULT ''",
  status: "TEXT DEFAULT 'active'",
  is_ki: 'INTEGER DEFAULT 0',
  knock_in_date: "TEXT DEFAULT ''",
  // 雪球专属列
  knock_out_coupons: "TEXT DEFAULT ''",
  knock_out_enhance_participation: 'REAL DEFAULT 0',
  dividend_coupon: 'REAL DEFAULT 0',
  // 雪球新命名列
  trade_start_date: "TEXT DEFAULT ''",
  knock_in_barrier: 'REAL DEFAULT 0',
  knock_in_strike: 'REAL DEFAULT 100',
  margin_ratio: 'REAL DEFAULT 0',
  maturity_coupon: 'REAL DEFAULT 0',
  termination_date: "TEXT DEFAULT ''",
  termination_payoff: 'REAL DEFAULT 0',
  // 凤凰专属列
  coupon_barrier: 'REAL DEFAULT 0',
  coupon_dates: "TEXT DEFAULT ''",
  coupon_rate: 'REAL DEFAULT 0',
  coupon_received: "TEXT DEFAULT '[]'",
  coupon_payment_dates: "TEXT DEFAULT '[]'"
}

// 根据列名列表生成建表 SQL（id + 业务列 + 时间戳）
function buildCreateSql(table: string, cols: string[]): string {
  const defs = cols.map((c) => `  ${c} ${COL_TYPES[c]}`).join(',\n')
  return (
    `CREATE TABLE IF NOT EXISTS ${table} (\n` +
    `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n` +
    `${defs},\n` +
    `  created_at TEXT DEFAULT (datetime('now','localtime')),\n` +
    `  updated_at TEXT DEFAULT (datetime('now','localtime'))\n` +
    `);`
  )
}

// 将旧 positions 表数据按 structure_type 迁移到 snowball_positions / phoenix_positions
// 兼容上一版列名（interest_start_date 等 → 雪球新命名），避免分表前后数据结构变化导致数据丢失
function migrateFromLegacyPositions(): void {
  const legacy = queryOne<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='positions'"
  )
  if (!legacy || !db) return

  // 雪球旧列名 → 新列名
  const snowballRename: Record<string, string> = {
    interest_start_date: 'trade_start_date',
    knock_in_pct: 'knock_in_barrier',
    knock_in_strike_pct: 'knock_in_strike',
    margin_rate: 'margin_ratio',
    dividend_coupon: 'maturity_coupon'
  }
  // 凤凰旧列名 → 新列名
  const phoenixRename: Record<string, string> = {
    coupon_barrier_pct: 'coupon_barrier',
    dividend_observation_dates: 'coupon_dates',
    knock_in_strike_pct: 'knock_in_strike',
    knock_in_pct: 'knock_in_barrier',
    margin_rate: 'margin_ratio'
  }
  const rows = queryAll<Record<string, unknown>>('SELECT * FROM positions')
  for (const row of rows) {
    const isPhoenix = (row.structure_type as string) === 'phoenix'
    const target = isPhoenix ? PHOENIX_TABLE : SNOWBALL_TABLE
    const cols = isPhoenix ? PHOENIX_COLS : SNOWBALL_COLS
    // 归一化旧列名 → 新列名（兼容上一版列名）
    const renameMap = isPhoenix ? phoenixRename : snowballRename
    const norm: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      const nk = renameMap[k] ?? k
      if (!(nk in norm)) norm[nk] = v
    }
    // 仅迁移新表中存在的列（旧表的冗余列忽略）
    const realCols = cols.filter((c) => c in norm)
    const placeholders = realCols.map(() => '?').join(', ')
    const vals = realCols.map((c) => norm[c])
    const created = (row.created_at as string) || new Date().toISOString()
    const updated = (row.updated_at as string) || new Date().toISOString()
    db.run(
      `INSERT INTO ${target} (${realCols.join(', ')}, created_at, updated_at) VALUES (${placeholders}, ?, ?)`,
      [...vals, created, updated] as never[]
    )
  }
  db.run('DROP TABLE IF EXISTS positions')
}

// 雪球表字段演进迁移：重命名 / 删除 / 新增（仅对旧库生效，新库按新 schema 建表无需迁移）
function migrateSnowballColumns(): void {
  if (!db) return
  const cols = queryAll<{ name: string }>(`PRAGMA table_info(${SNOWBALL_TABLE})`).map((r) => r.name)
  const has = (c: string) => cols.includes(c)
  const renames: [string, string][] = [
    ['interest_start_date', 'trade_start_date'],
    ['knock_in_pct', 'knock_in_barrier'],
    ['knock_in_strike_pct', 'knock_in_strike'],
    ['margin_rate', 'margin_ratio'],
    ['dividend_coupon', 'maturity_coupon']
  ]
  for (const [old, neu] of renames) {
    if (has(old) && !has(neu)) {
      db.run(`ALTER TABLE ${SNOWBALL_TABLE} RENAME COLUMN ${old} TO ${neu}`)
    }
  }
  if (has('knock_out_pct')) {
    db.run(`ALTER TABLE ${SNOWBALL_TABLE} DROP COLUMN knock_out_pct`)
  }
  if (!has('termination_date')) {
    db.run(`ALTER TABLE ${SNOWBALL_TABLE} ADD COLUMN termination_date TEXT DEFAULT ''`)
  }
  if (!has('termination_payoff')) {
    db.run(`ALTER TABLE ${SNOWBALL_TABLE} ADD COLUMN termination_payoff REAL DEFAULT 0`)
  }
  if (!has('is_ki')) {
    db.run(`ALTER TABLE ${SNOWBALL_TABLE} ADD COLUMN is_ki INTEGER DEFAULT 0`)
  }
  if (!has('knock_in_date')) {
    db.run(`ALTER TABLE ${SNOWBALL_TABLE} ADD COLUMN knock_in_date TEXT DEFAULT ''`)
  }
}

// 凤凰表字段演进迁移：重命名 / 删除（仅对旧库生效，新库按新 schema 建表无需迁移）
function migratePhoenixColumns(): void {
  if (!db) return
  const cols = queryAll<{ name: string }>(`PRAGMA table_info(${PHOENIX_TABLE})`).map((r) => r.name)
  const has = (c: string) => cols.includes(c)
  const renames: [string, string][] = [
    ['interest_start_date', 'trade_start_date'],
    ['coupon_barrier_pct', 'coupon_barrier'],
    ['dividend_observation_dates', 'coupon_dates'],
    ['knock_in_strike_pct', 'knock_in_strike'],
    ['knock_in_pct', 'knock_in_barrier'],
    ['margin_rate', 'margin_ratio']
  ]
  for (const [old, neu] of renames) {
    if (has(old) && !has(neu)) {
      db.run(`ALTER TABLE ${PHOENIX_TABLE} RENAME COLUMN ${old} TO ${neu}`)
    }
  }
  for (const drop of ['dividend_rate_pct', 'observation_freq', 'knock_in_observed', 'knock_out_observed', 'knock_out_pct']) {
    if (has(drop)) {
      db.run(`ALTER TABLE ${PHOENIX_TABLE} DROP COLUMN ${drop}`)
    }
  }
  if (!has('is_ki')) {
    db.run(`ALTER TABLE ${PHOENIX_TABLE} ADD COLUMN is_ki INTEGER DEFAULT 0`)
  }
  if (!has('knock_in_date')) {
    db.run(`ALTER TABLE ${PHOENIX_TABLE} ADD COLUMN knock_in_date TEXT DEFAULT ''`)
  }
  const phoenixAdd: [string, string][] = [
    ['coupon_rate', 'REAL DEFAULT 0'],
    ['coupon_received', "TEXT DEFAULT '[]'"],
    ['coupon_payment_dates', "TEXT DEFAULT '[]'"],
    ['termination_date', "TEXT DEFAULT ''"],
    ['termination_payoff', 'REAL DEFAULT 0']
  ]
  for (const [c, def] of phoenixAdd) {
    if (!has(c)) db.run(`ALTER TABLE ${PHOENIX_TABLE} ADD COLUMN ${c} ${def}`)
  }
}
