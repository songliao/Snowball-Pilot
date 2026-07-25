import { ipcMain } from 'electron'
import { queryAll, execute, getLastInsertId } from './index'

export function registerEventHandlers(): void {
  // 获取某持仓的所有事件
  ipcMain.handle('events:get-by-position-id', (_event, positionId: number) => {
    return queryAll(
      'SELECT * FROM events WHERE position_id = ? ORDER BY event_date DESC',
      [positionId]
    )
  })

  // 创建事件
  ipcMain.handle('events:create', (_event, data) => {
    execute(`
      INSERT INTO events (position_id, event_type, event_date, description)
      VALUES (?, ?, ?, ?)
    `, [data.position_id, data.event_type, data.event_date, data.description || ''])
    return getLastInsertId()
  })

  // 删除事件
  ipcMain.handle('events:delete', (_event, id: number) => {
    execute('DELETE FROM events WHERE id = ?', [id])
    return true
  })
}
