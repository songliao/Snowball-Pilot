import { ipcMain } from 'electron'
import { queryAll, queryOne, execute } from './index'
import { storeMA } from '../services/index-history'

// A 股周末从不开市：任何周末日期的行情都是脏数据，不应落库也不应展示。
// 此处与 index-history.ts 的 isTradingDay 保持一致，作为手动写入路径的兜底校验。
function isTradingDay(dateStr: string): boolean {
  const day = new Date(dateStr).getUTCDay()
  return day !== 0 && day !== 6 // 0=周日 6=周六
}

export function registerPriceHandlers(): void {
  // 获取某标的的价格历史
  ipcMain.handle('prices:get-by-code', (_event, code: string, limit?: number) => {
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
  })

  // 获取最新价格（仅取交易日记录，非交易日不填充）
  ipcMain.handle('prices:get-latest', (_event, code: string) => {
    return queryOne(
      `SELECT * FROM price_history
       WHERE underlying_code = ? AND strftime('%w', date) NOT IN ('0','6')
       ORDER BY date DESC LIMIT 1`,
      [code]
    )
  })

  // 插入或更新价格（含开高低收与成交量）
  ipcMain.handle('prices:upsert', (_event, data) => {
    // 非交易日保护：A 股周末从不开市，手动写入周末日期属于脏数据，
    // 直接拒绝，避免标的管理列表出现「周末行情」「周末更新日期」等问题。
    if (!isTradingDay(data.date)) {
      console.warn(`[Prices] 拒绝写入非交易日行情：${data.underlying_code} ${data.date}`)
      return { ok: false, reason: '非交易日，无法写入行情' }
    }
    // sql.js 支持 INSERT OR REPLACE；UNIQUE(underlying_code, date) 保证幂等更新
    execute(
      `INSERT OR REPLACE INTO price_history (underlying_code, price, date, source, open, high, low, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.underlying_code,
        data.price,
        data.date,
        data.source || 'manual',
        data.open ?? null,
        data.high ?? null,
        data.low ?? null,
        data.volume ?? null
      ]
    )
    // 手动写入/更新后重算该标的均线（storeMA 仅写内存，execute 已落盘）
    storeMA(data.underlying_code)
    return { ok: true }
  })

  // 读取某标的的 OHLC 历史（升序，用于离线绘制 K 线）
  ipcMain.handle('prices:get-ohlc', (_event, code: string) => {
    return queryAll(
      `SELECT date, price AS close, open, high, low, volume, ma5, ma10, ma20
       FROM price_history WHERE underlying_code = ? ORDER BY date ASC`,
      [code]
    )
  })

  // 删除某标的的所有价格
  ipcMain.handle('prices:delete-by-code', (_event, code: string) => {
    execute('DELETE FROM price_history WHERE underlying_code = ?', [code])
    return true
  })

  // 获取已存行情的标的代码列表（含最新价、前一交易日价、近一周/近一月/近一年基准价）
  // 注意：所有取数均排除周末（strftime('%w') IN (0,6)）记录，
  // 确保「最新行情」「更新日期」只来自真实的 A 股交易日，非交易日绝不填充展示。
  ipcMain.handle('prices:get-codes', () => {
    return queryAll<{
      code: string
      latestPrice: number
      date: string
      prevPrice: number | null
      priceWeekAgo: number | null
      priceMonthAgo: number | null
      priceYearAgo: number | null
    }>(
      `SELECT p1.underlying_code AS code, p1.price AS latestPrice, p1.date AS date,
              (SELECT p2.price FROM price_history p2
               WHERE p2.underlying_code = p1.underlying_code AND p2.date < p1.date
                 AND strftime('%w', p2.date) NOT IN ('0','6')
               ORDER BY p2.date DESC LIMIT 1) AS prevPrice,
              (SELECT p3.price FROM price_history p3
               WHERE p3.underlying_code = p1.underlying_code AND p3.date <= date(p1.date, '-7 days')
                 AND strftime('%w', p3.date) NOT IN ('0','6')
               ORDER BY p3.date DESC LIMIT 1) AS priceWeekAgo,
              (SELECT p4.price FROM price_history p4
               WHERE p4.underlying_code = p1.underlying_code AND p4.date <= date(p1.date, '-30 days')
                 AND strftime('%w', p4.date) NOT IN ('0','6')
               ORDER BY p4.date DESC LIMIT 1) AS priceMonthAgo,
              (SELECT p6.price FROM price_history p6
               WHERE p6.underlying_code = p1.underlying_code AND p6.date <= date(p1.date, '-365 days')
                 AND strftime('%w', p6.date) NOT IN ('0','6')
               ORDER BY p6.date DESC LIMIT 1) AS priceYearAgo
       FROM price_history p1
       WHERE p1.date = (
         SELECT MAX(date) FROM price_history p5
         WHERE p5.underlying_code = p1.underlying_code
           AND strftime('%w', p5.date) NOT IN ('0','6')
       )
       ORDER BY p1.underlying_code`
    )
  })

  // 自选标的：读取显示在总览卡片的标的列表（置顶）
  ipcMain.handle('prices:get-watchlist', () => {
    return queryAll<{ code: string }>('SELECT code FROM watchlist ORDER BY sort_order, rowid').map(
      (r) => r.code
    )
  })

  // 自选标的：全量替换（置顶/取消置顶、批量维护）
  ipcMain.handle('prices:set-watchlist', (_event, codes: string[]) => {
    execute('DELETE FROM watchlist')
    codes.forEach((code, i) => {
      execute('INSERT OR IGNORE INTO watchlist (code, sort_order) VALUES (?, ?)', [code, i])
    })
    return true
  })
}
