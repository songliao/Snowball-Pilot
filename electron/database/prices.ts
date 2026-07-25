import { ipcMain } from 'electron'
import { queryAll, queryOne, execute } from './index'

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

  // 插入或更新价格
  ipcMain.handle('prices:upsert', (_event, data) => {
    // sql.js 支持 INSERT OR REPLACE
    execute(`
      INSERT OR REPLACE INTO price_history (underlying_code, price, date, source)
      VALUES (?, ?, ?, ?)
    `, [data.underlying_code, data.price, data.date, data.source || 'manual'])
    return true
  })

  // 删除某标的的所有价格
  ipcMain.handle('prices:delete-by-code', (_event, code: string) => {
    execute('DELETE FROM price_history WHERE underlying_code = ?', [code])
    return true
  })
}
