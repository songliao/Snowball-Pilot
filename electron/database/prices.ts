import { ipcMain } from 'electron'
import { queryAll, queryOne, execute } from './index'
import { storeMA } from '../services/index-history'

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

  // 获取最新价格
  ipcMain.handle('prices:get-latest', (_event, code: string) => {
    return queryOne(
      'SELECT * FROM price_history WHERE underlying_code = ? ORDER BY date DESC LIMIT 1',
      [code]
    )
  })

  // 插入或更新价格（含开高低收与成交量）
  ipcMain.handle('prices:upsert', (_event, data) => {
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
    return true
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
               ORDER BY p2.date DESC LIMIT 1) AS prevPrice,
              (SELECT p3.price FROM price_history p3
               WHERE p3.underlying_code = p1.underlying_code AND p3.date <= date(p1.date, '-7 days')
               ORDER BY p3.date DESC LIMIT 1) AS priceWeekAgo,
              (SELECT p4.price FROM price_history p4
               WHERE p4.underlying_code = p1.underlying_code AND p4.date <= date(p1.date, '-30 days')
               ORDER BY p4.date DESC LIMIT 1) AS priceMonthAgo,
              (SELECT p6.price FROM price_history p6
               WHERE p6.underlying_code = p1.underlying_code AND p6.date <= date(p1.date, '-365 days')
               ORDER BY p6.date DESC LIMIT 1) AS priceYearAgo
       FROM price_history p1
       WHERE p1.date = (
         SELECT MAX(date) FROM price_history p5 WHERE p5.underlying_code = p1.underlying_code
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
