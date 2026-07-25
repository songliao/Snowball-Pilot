import { ipcMain } from 'electron'
import { queryAll, queryOne, execute, getLastInsertId } from './index'

export function registerPositionHandlers(): void {
  // 获取所有持仓
  ipcMain.handle('positions:get-all', () => {
    return queryAll('SELECT * FROM positions ORDER BY created_at DESC')
  })

  // 根据 ID 获取持仓
  ipcMain.handle('positions:get-by-id', (_event, id: number) => {
    return queryOne('SELECT * FROM positions WHERE id = ?', [id])
  })

  // 创建持仓
  ipcMain.handle('positions:create', (_event, data) => {
    execute(`
      INSERT INTO positions (
        product_name, broker, underlying, underlying_code, notional,
        trade_date, effective_date, maturity_date, initial_price,
        knock_in_pct, knock_out_pct, coupon_rate, margin_rate, observation_freq,
        knock_in_observed, knock_out_observed, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.product_name,
      data.broker || '',
      data.underlying,
      data.underlying_code || '',
      data.notional,
      data.trade_date,
      data.effective_date,
      data.maturity_date,
      data.initial_price,
      data.knock_in_pct,
      data.knock_out_pct || 1.0,
      data.coupon_rate,
      data.margin_rate || 0,
      data.observation_freq || 'monthly',
      data.knock_in_observed || 0,
      data.knock_out_observed || 0,
      data.status || 'active',
      data.notes || ''
    ])
    return getLastInsertId()
  })

  // 更新持仓
  ipcMain.handle('positions:update', (_event, id: number, data) => {
    const fields: string[] = []
    const values: unknown[] = []

    const allowedFields = [
      'product_name', 'broker', 'underlying', 'underlying_code', 'notional',
      'trade_date', 'effective_date', 'maturity_date', 'initial_price',
      'knock_in_pct', 'knock_out_pct', 'coupon_rate', 'margin_rate', 'observation_freq',
      'knock_in_observed', 'knock_out_observed', 'status', 'notes'
    ]

    for (const field of allowedFields) {
      if (field in data && data[field] !== undefined) {
        fields.push(`${field} = ?`)
        values.push(data[field])
      }
    }

    if (fields.length === 0) return false

    fields.push("updated_at = datetime('now', 'localtime')")
    values.push(id)
    execute(`UPDATE positions SET ${fields.join(', ')} WHERE id = ?`, values)
    return true
  })

  // 删除持仓
  ipcMain.handle('positions:delete', (_event, id: number) => {
    execute('DELETE FROM events WHERE position_id = ?', [id])
    execute('DELETE FROM positions WHERE id = ?', [id])
    return true
  })

  // 更新状态
  ipcMain.handle('positions:update-status', (_event, id: number, status: string) => {
    if (status === 'knocked_in') {
      execute(
        "UPDATE positions SET status = ?, knock_in_observed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [status, id]
      )
    } else if (status === 'knocked_out') {
      execute(
        "UPDATE positions SET status = ?, knock_out_observed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [status, id]
      )
    } else {
      execute(
        "UPDATE positions SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
        [status, id]
      )
    }
    return true
  })
}
