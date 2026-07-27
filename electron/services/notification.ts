import { BrowserWindow, Notification } from 'electron'
import { queryAll, queryOne } from '../database'

interface PositionRow {
  id: number
  product_name: string
  underlying?: string
  underlying_code: string
  knock_in_pct: number
  initial_price: number
  status: string
}

/**
 * 检查并发送通知
 * - 敲入预警：安全垫 < 5%
 */
export async function checkAndNotify(mainWindow: BrowserWindow | null): Promise<string[]> {
  const notifications: string[] = []

  // 获取所有活跃持仓（雪球 + 凤凰 两张表）
  const positions = queryAll<PositionRow>(
    `SELECT product_name, underlying_code, initial_price, knock_in_barrier AS knock_in_pct, status
       FROM snowball_positions WHERE status IN ('active', 'knocked_in')
     UNION ALL
     SELECT product_name, underlying_code, initial_price, knock_in_barrier AS knock_in_pct, status
       FROM phoenix_positions WHERE status IN ('active', 'knocked_in')`
  )

  for (const pos of positions) {
    // 敲入预警（仅对 active 状态）
    if (pos.status === 'active' && pos.underlying_code) {
      const latestPrice = queryOne<{ price: number }>(
        'SELECT price FROM price_history WHERE underlying_code = ? ORDER BY date DESC LIMIT 1',
        [pos.underlying_code]
      )

      if (latestPrice) {
        const knockInPrice = pos.initial_price * pos.knock_in_pct
        const safetyMargin = (latestPrice.price - knockInPrice) / latestPrice.price

        if (safetyMargin < 0.05 && safetyMargin > 0) {
          const msg = `【敲入预警】${pos.product_name}（${pos.underlying_code || pos.underlying}）安全垫仅 ${(safetyMargin * 100).toFixed(1)}%，当前价 ${latestPrice.price.toFixed(2)}，敲入价 ${knockInPrice.toFixed(2)}`
          notifications.push(msg)
        } else if (safetyMargin <= 0) {
          const msg = `【敲入警告】${pos.product_name}（${pos.underlying_code || pos.underlying}）已跌破敲入价！当前价 ${latestPrice.price.toFixed(2)}，敲入价 ${knockInPrice.toFixed(2)}`
          notifications.push(msg)
        }
      }
    }
  }

  // 发送系统通知
  if (notifications.length > 0 && Notification.isSupported()) {
    for (const msg of notifications) {
      const notification = new Notification({
        title: 'Snowball Pilot',
        body: msg
      })
      notification.show()
    }
  }

  // 通知渲染进程
  if (mainWindow && notifications.length > 0) {
    mainWindow.webContents.send('notification:new', notifications)
  }

  return notifications
}
