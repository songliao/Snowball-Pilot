/**
 * 指数历史数据服务
 * - 每日收盘后自动保存当日收盘价
 * - 支持拉取历史K线数据补足
 */

import { queryOne, queryAll, execute } from '../database'

// 需要跟踪的宽基指数
const TRACKED_INDICES = [
  { code: '000852.SH', secid: '1.000852', name: '中证1000' },
  { code: '000905.SH', secid: '1.000905', name: '中证500' },
  { code: '000300.SH', secid: '1.000300', name: '沪深300' },
  { code: '000016.SH', secid: '1.000016', name: '上证50' }
]

interface KlineItem {
  date: string
  close: number
}

/**
 * 从东方财富拉取日K线历史数据
 * @param secid 东方财富 secid (如 1.000852)
 * @param limit 获取条数
 */
async function fetchKlineHistory(secid: string, limit = 365): Promise<KlineItem[]> {
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&end=20500101&lmt=${limit}&ut=fa5fd1943c7b386f172d6893dbbd1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: 'https://quote.eastmoney.com/'
      }
    })

    if (!response.ok) return []

    const json = await response.json()
    const klines: string[] = json?.data?.klines || []

    return klines.map((line) => {
      const parts = line.split(',')
      return {
        date: parts[0],       // 日期 yyyy-MM-dd
        close: parseFloat(parts[2]) / 100  // 收盘价（×100整数）
      }
    }).filter((item) => item.close > 0)
  } catch (error) {
    console.error(`Failed to fetch kline for ${secid}:`, error)
    return []
  }
}

/**
 * 保存单条收盘价到数据库（增量，已存在则跳过）
 */
function saveClosePrice(code: string, date: string, price: number): boolean {
  const existing = queryOne(
    'SELECT id FROM price_history WHERE underlying_code = ? AND date = ?',
    [code, date]
  )
  if (existing) return false

  execute(
    'INSERT INTO price_history (underlying_code, price, date, source) VALUES (?, ?, ?, ?)',
    [code, price, date, 'auto']
  )
  return true
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
    const klines = await fetchKlineHistory(idx.secid, 1)
    if (klines.length > 0) {
      const latest = klines[klines.length - 1]
      if (latest.date === today) {
        saveClosePrice(idx.code, today, latest.close)
        saved++
      }
    }

    // 避免请求过快
    await new Promise((r) => setTimeout(r, 300))
  }

  if (saved > 0) {
    console.log(`[IndexHistory] Saved ${saved} closing prices for ${today}`)
  }
  return saved
}

/**
 * 补足历史数据（拉取近N天K线，增量写入）
 * @param days 拉取天数，默认365
 */
export async function backfillHistory(days = 365): Promise<{ code: string; saved: number }> {
  const results: { code: string; saved: number }[] = []

  for (const idx of TRACKED_INDICES) {
    const klines = await fetchKlineHistory(idx.secid, days)
    let saved = 0

    for (const k of klines) {
      if (saveClosePrice(idx.code, k.date, k.close)) {
        saved++
      }
    }

    results.push({ code: idx.code, saved })
    console.log(`[IndexHistory] Backfill ${idx.name}(${idx.code}): ${saved} new records`)

    // 避免请求过快
    await new Promise((r) => setTimeout(r, 500))
  }

  return results
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
