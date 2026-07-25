import { BrowserWindow, Notification } from 'electron'
import { queryAll, queryOne } from '../database'

interface PositionRow {
  id: number
  product_name: string
  underlying: string
  underlying_code: string
  maturity_date: string
  knock_in_pct: number
  initial_price: number
  status: string
}

/**
 * 检查并发送通知
 * - 敲入预警：安全垫 < 5%
 * - 到期提醒：距到期日 < 7 天
 */
export async function checkAndNotify(mainWindow: BrowserWindow | null): Promise<string[]> {
  const notifications: string[] = []

  // 获取所有活跃持仓
  const positions = queryAll<PositionRow>(
    "SELECT * FROM positions WHERE status IN ('active', 'knocked_in')"
  )

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  for (const pos of positions) {
    // 到期提醒
    const maturityDate = new Date(pos.maturity_date)
    const daysToMaturity = Math.ceil(
      (maturityDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysToMaturity > 0 && daysToMaturity <= 7) {
      const msg = `【到期提醒】${pos.product_name}（${pos.underlying}）将于 ${daysToMaturity} 天后到期`
      notifications.push(msg)
    }

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
          const msg = `【敲入预警】${pos.product_name}（${pos.underlying}）安全垫仅 ${(safetyMargin * 100).toFixed(1)}%，当前价 ${latestPrice.price.toFixed(2)}，敲入价 ${knockInPrice.toFixed(2)}`
          notifications.push(msg)
        } else if (safetyMargin <= 0) {
          const msg = `【敲入警告】${pos.product_name}（${pos.underlying}）已跌破敲入价！当前价 ${latestPrice.price.toFixed(2)}，敲入价 ${knockInPrice.toFixed(2)}`
          notifications.push(msg)
        }
      }
    }
  }

  // 发送系统通知
  if (notifications.length > 0 && Notification.isSupported()) {
    for (const msg of notifications) {
      const notification = new Notification({
        title: '雪球持仓管理',
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
