/**
 * 指数 / 标的 历史数据服务
 * - 每日收盘后自动保存当日收盘价
 * - 支持拉取历史K线数据补足（近2年）
 * - 首次启动（或数据缺失时）自动补足标的历史数据
 */

import { queryOne, queryAll, execute, getDatabase, saveDatabase, getMeta, setMeta } from '../database'
import { fetchKline } from './market-data'

// 需要跟踪的宽基指数（仪表盘展示用）
const TRACKED_INDICES = [
  { code: '000852.SH', name: '中证1000' },
  { code: '000905.SH', name: '中证500' },
  { code: '000300.SH', name: '沪深300' },
  { code: '000016.SH', name: '上证50' }
]

// 历史数据回填版本标记：升级该版本号可强制重建全部历史
const BACKFILL_VERSION = '3'
const BACKFILL_VERSION_KEY = 'history_backfill_version'

// 近2年（交易日约 480 天，多取一些余量确保覆盖）
const TWO_YEARS_DAYS = 730
// 判断历史是否足够的交易日阈值
const MIN_TRADING_DAYS = 460

interface KlineItem {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带超时与重试的 JSON 拉取。
 * 东方财富免费接口在高频 / 弱网（尤其 Windows）下偶发返回 5xx、429 或网络抖动，
 * 通过重试 + 退避可消化绝大多数间歇失败，避免新增标的时误报「未获取到行情」。
 */
async function fetchJsonWithRetry(
  url: string,
  options: RequestInit = {},
  {
    retries = 3,
    timeoutMs = 15000,
    baseDelayMs = 500
  }: { retries?: number; timeoutMs?: number; baseDelayMs?: number } = {}
): Promise<any | null> {
  const host = url.split('?')[0]
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 300
      console.warn(`[IndexHistory] 拉取 ${host} 第 ${attempt} 次重试（${Math.round(delay)}ms 后）`)
      await sleep(delay)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)
      if (!response.ok) {
        // 429（限流）与 5xx（服务端错误）值得重试；其他 4xx（通常为代码/参数错误）直接放弃
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable) {
          console.warn(`[IndexHistory] 请求被拒(${response.status})：${host}`)
          return null
        }
        lastErr = new Error(`HTTP ${response.status}`)
        continue
      }
      return await response.json()
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      // 超时（abort）或网络异常：继续重试
    }
  }
  console.error(`[IndexHistory] 拉取 ${host} 失败，已重试 ${retries} 次：`, lastErr)
  return null
}

/**
 * 从腾讯财经拉取日K线历史数据（替代东方财富，避免其 IP 限流导致新增标的失败）
 * @param code 标的代码（如 000852.SH）
 * @param days 获取条数
 */
async function fetchKlineHistory(code: string, days = TWO_YEARS_DAYS): Promise<KlineItem[]> {
  const klines = await fetchKline(code, days)
  if (!klines.length) {
    console.warn(`[IndexHistory] ${code} 行情接口返回为空，可能代码无效或腾讯暂无数据`)
  }
  return klines as KlineItem[]
}

/**
 * 保存单条日K（开高低收+成交量）到数据库（增量写入；已存在则更新，以覆盖旧数据）
 */
function saveClosePrice(code: string, item: KlineItem): boolean {
  // 注意：这里只写入内存，不立即落盘；由调用方在批量写入后统一 saveDatabase()，
  // 避免每条记录都触发一次全库导出（约 730 次），否则新增标的可能卡顿十几秒。
  getDatabase().run(
    'INSERT OR REPLACE INTO price_history (underlying_code, price, date, source, open, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [code, item.close, item.date, 'auto', item.open, item.high, item.low, item.volume]
  )
  return true
}

// 计算移动平均线（不足周期返回 null，形成断点）
function computeMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    result.push(i >= period - 1 ? Number((sum / period).toFixed(3)) : null)
  }
  return result
}

/**
 * 基于已存收盘价序列计算 MA5 / MA10 / MA20 并写回该标的的全部记录。
 * 仅写入内存，由调用方在批量操作后统一 saveDatabase()。
 */
export function storeMA(code: string): void {
  const rows = queryAll<{ id: number; price: number }>(
    'SELECT id, price FROM price_history WHERE underlying_code = ? ORDER BY date ASC',
    [code]
  )
  if (rows.length === 0) return
  const closes = rows.map((r) => r.price)
  const ma5 = computeMA(closes, 5)
  const ma10 = computeMA(closes, 10)
  const ma20 = computeMA(closes, 20)
  const db = getDatabase()
  for (let i = 0; i < rows.length; i++) {
    db.run('UPDATE price_history SET ma5 = ?, ma10 = ?, ma20 = ? WHERE id = ?', [
      ma5[i],
      ma10[i],
      ma20[i],
      rows[i].id
    ])
  }
}

/**
 * 保存今日收盘价（每日收盘后调用）
 */
export async function saveDailyClose(): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  let saved = 0

  for (const idx of TRACKED_INDICES) {
    // 检查今天是否已保存
    const existing = queryOne(
      'SELECT id FROM price_history WHERE underlying_code = ? AND date = ?',
      [idx.code, today]
    )
    if (existing) continue

    // 拉取最近1条K线即为今日收盘
    const klines = await fetchKlineHistory(idx.code, 1)
    if (klines.length > 0) {
      const latest = klines[klines.length - 1]
      if (latest.date === today) {
        saveClosePrice(idx.code, latest)
        saved++
        // 新增当日数据后重算均线
        storeMA(idx.code)
      }
    }

    // 避免请求过快
    await sleep(300)
  }

  if (saved > 0) {
    saveDatabase() // 当日收盘写入完成后统一落盘一次
    console.log(`[IndexHistory] Saved ${saved} closing prices for ${today}`)
  }
  return saved
}

/**
 * 获取需要补足历史数据的标的列表：
 * 持仓中的全部标的代码 + 跟踪的宽基指数（去重）
 */
function getBackfillTargets(): string[] {
  const set = new Set<string>()
  for (const idx of TRACKED_INDICES) set.add(idx.code)
  const rows = queryAll<{ underlying_code: string }>(
    `SELECT underlying_code FROM snowball_positions WHERE underlying_code IS NOT NULL AND underlying_code != ''
     UNION
     SELECT underlying_code FROM phoenix_positions WHERE underlying_code IS NOT NULL AND underlying_code != ''`
  )
  for (const r of rows) {
    if (r.underlying_code) set.add(r.underlying_code)
  }
  return [...set]
}

/**
 * 判断某标的的历史数据是否需要补足（缺失或不足近2年）
 */
function needsBackfill(code: string): boolean {
  const row = queryOne<{ cnt: number; minDate: string | null }>(
    'SELECT COUNT(*) AS cnt, MIN(date) AS minDate FROM price_history WHERE underlying_code = ?',
    [code]
  )
  if (!row || row.cnt === 0) return true

  // 最早日期都在近两年内（说明历史深度不够），或记录数不足 → 需要补足
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const threshold = twoYearsAgo.toISOString().split('T')[0]
  if (row.minDate && row.minDate > threshold) return true
  return row.cnt < MIN_TRADING_DAYS
}

/**
 * 补足某标的近 N 天历史数据
 * @param clean 为 true 时先删除该标的已有历史，再全量重建（用于覆盖错误的旧数据）
 */
async function backfillCodes(codes: string[], days = TWO_YEARS_DAYS, clean = false): Promise<{ code: string; saved: number }[]> {
  const results: { code: string; saved: number }[] = []
  for (const code of codes) {
    let saved = 0
    try {
      // 先拉取行情，成功后再清空旧数据（避免拉取失败时误删已有历史）
      const klines = await fetchKlineHistory(code, days)
      if (clean) {
        execute('DELETE FROM price_history WHERE underlying_code = ?', [code])
      }
      for (const k of klines) {
        if (saveClosePrice(code, k)) saved++
      }
      storeMA(code) // 批量写入后计算并存储均线
      saveDatabase() // 单个标的批量写入完成后统一落盘一次
      console.log(`[IndexHistory] 补足 ${code}: ${saved} 条新记录${clean ? '（已清空旧数据）' : ''}`)
    } catch (e) {
      // 单个标的失败不影响其他标的：已写入内存的数据落盘保留（至少比全丢好），
      // 下次启动时若历史不足会自动触发补足
      try { saveDatabase() } catch { /* 落盘失败则放弃 */ }
      console.error(`[IndexHistory] 补足 ${code} 失败：`, e)
    }
    results.push({ code, saved })
    // 避免请求过快
    await sleep(500)
  }
  return results
}

/**
 * 补足历史数据（拉取近 N 天 K线，增量写入）
 * @param days 拉取天数，默认 730（近2年）
 * @param clean 为 true 时先删除已有历史再全量重建（覆盖错误数据）
 */
export async function backfillHistory(days = TWO_YEARS_DAYS, clean = false): Promise<{ code: string; saved: number }[]> {
  return backfillCodes(getBackfillTargets(), days, clean)
}

/**
 * 补足单个标的的历史数据（新增标的时调用）
 * @param code 标的代码（如 000852.SH）
 * @param days 拉取天数，默认 730（近2年）
 */
export async function backfillSingleCode(
  code: string,
  days = TWO_YEARS_DAYS
): Promise<{ code: string; saved: number; reason?: string }> {
  if (!code) return { code, saved: 0, reason: '代码为空' }
  // 先拉取行情；仅当成功拿到数据后再清空并重建，
  // 避免拉取偶发失败时误删该标的已有的历史数据（如重复新增刷新场景）
  const klines = await fetchKlineHistory(code, days)
  let saved = 0
  if (klines.length > 0) {
    execute('DELETE FROM price_history WHERE underlying_code = ?', [code])
    for (const k of klines) {
      if (saveClosePrice(code, k)) saved++
    }
    storeMA(code) // 批量写入后计算并存储均线
  }
  saveDatabase() // 批量写入完成后统一落盘一次
  if (saved === 0) {
    return {
      code,
      saved: 0,
      reason: `行情接口未返回「${code}」的K线数据（可能代码格式不正确，或当前网络无法访问腾讯财经行情接口）`
    }
  }
  return { code, saved }
}

/**
 * 刷新：为每个已存标的补足「最后一条记录 → 今天」之间缺失的收盘价。
 * 增量写入（INSERT OR REPLACE），不重建全量历史；同时重算均线。
 */
export async function refreshToToday(): Promise<{ code: string; added: number }[]> {
  const rows = queryAll<{ underlying_code: string }>(
    'SELECT DISTINCT underlying_code FROM price_history'
  )
  const today = new Date()
  const results: { code: string; added: number }[] = []
  for (const r of rows) {
    const last = queryOne<{ maxDate: string | null }>(
      'SELECT MAX(date) AS maxDate FROM price_history WHERE underlying_code = ?',
      [r.underlying_code]
    )
    const lastStr = last?.maxDate ?? ''
    // 计算从最后记录到今天需要的天数，并留足节假日缓冲（至少 30 天）
    let days = 30
    if (lastStr) {
      const diff = Math.ceil(
        (today.getTime() - new Date(lastStr).getTime()) / 86400000
      )
      days = Math.max(30, diff + 10)
    }
    const klines = await fetchKlineHistory(r.underlying_code, days)
    let added = 0
    for (const k of klines) {
      if (!lastStr || k.date > lastStr) added++ // 仅统计新增的缺失交易日
      saveClosePrice(r.underlying_code, k)
    }
    storeMA(r.underlying_code)
    saveDatabase()
    results.push({ code: r.underlying_code, added })
    await sleep(400) // 避免请求过快
  }
  return results
}

/**
 * 存量数据迁移：为已有 price_history 记录补齐 开/高/低/成交量。
 * 仅执行一次（由 meta 标记 ohlc_migrated 控制）。离线时不阻塞，下次联网启动再补。
 */
async function migrateOhlc(): Promise<void> {
  if (getMeta('ohlc_migrated') === '1') return
  const rows = queryAll<{ underlying_code: string }>(
    'SELECT DISTINCT underlying_code FROM price_history'
  )
  if (rows.length === 0) {
    setMeta('ohlc_migrated', '1')
    return
  }
  for (const r of rows) {
    const klines = await fetchKlineHistory(r.underlying_code, TWO_YEARS_DAYS)
    for (const k of klines) {
      getDatabase().run(
        'UPDATE price_history SET open = ?, high = ?, low = ?, volume = ? WHERE underlying_code = ? AND date = ?',
        [k.open, k.high, k.low, k.volume, r.underlying_code, k.date]
      )
    }
    storeMA(r.underlying_code) // 同步计算并存储均线
    await sleep(400)
  }
  saveDatabase() // 迁移完成后统一落盘一次
  setMeta('ohlc_migrated', '1')
  console.log('[IndexHistory] OHLC 存量数据迁移完成')
}

/**
 * 存量数据迁移：为已有 price_history 记录补齐 MA5 / MA10 / MA20。
 * 独立于 OHLC 迁移（标记 ma_migrated），保证 OHLC 迁移已执行过的库也能补算均线。
 */
async function migrateMA(): Promise<void> {
  if (getMeta('ma_migrated') === '1') return
  const rows = queryAll<{ underlying_code: string }>(
    'SELECT DISTINCT underlying_code FROM price_history'
  )
  for (const r of rows) {
    storeMA(r.underlying_code)
  }
  saveDatabase() // 迁移完成后统一落盘一次
  setMeta('ma_migrated', '1')
  console.log('[IndexHistory] MA 存量数据迁移完成')
}

/**
 * 启动时的补足逻辑：
 * - 首次启动（或版本升级）时，全量重建所有标的近2年历史（覆盖旧的错误数据）
 * - 之后仅在新增标的、且历史不足时按需补足，避免每次启动都打 API
 */
export async function ensureHistoryBackfilled(): Promise<void> {
  // 先补齐已有记录的 开/高/低/成交量（一次性）
  await migrateOhlc()
  // 补齐均线（一次性，独立于 OHLC 迁移）
  await migrateMA()

  const currentVersion = getMeta(BACKFILL_VERSION_KEY)

  if (currentVersion === BACKFILL_VERSION) {
    // 常规启动：仅补足缺失历史的新标的
    const targets = getBackfillTargets().filter(needsBackfill)
    if (targets.length === 0) {
      console.log('[IndexHistory] 历史数据已完整，无需补足')
      return
    }
    console.log(`[IndexHistory] 发现 ${targets.length} 个标的缺少历史数据，开始补足...`)
    await backfillCodes(targets, TWO_YEARS_DAYS)
  } else {
    // 首次启动或版本升级：清空并全量重建所有标的近2年历史（覆盖错误的旧数据）
    const targets = getBackfillTargets()
    console.log(`[IndexHistory] 初始化历史数据，清空并补足 ${targets.length} 个标的近2年数据...`)
    await backfillCodes(targets, TWO_YEARS_DAYS, true)
    setMeta(BACKFILL_VERSION_KEY, BACKFILL_VERSION)
  }
}

/**
 * 获取某指数的历史收盘价
 */
export function getIndexHistory(code: string, limit?: number) {
  if (limit) {
    return queryAll(
      'SELECT * FROM price_history WHERE underlying_code = ? ORDER BY date DESC LIMIT ?',
      [code, limit]
    )
  }
  return queryAll(
    'SELECT * FROM price_history WHERE underlying_code = ? ORDER BY date ASC',
    [code]
  )
}
