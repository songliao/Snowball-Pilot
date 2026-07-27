import { ipcMain } from 'electron'
import { queryAll, execute, getLastInsertId } from './index'

export function registerEventHandlers(): void {
  // 按 position_id + structure_type 查询，避免雪球/凤凰同 id 的事件混淆
  ipcMain.handle(
    'events:get-by-position-id',
    (_event, positionId: number, structureType: string) => {
      return queryAll(
        'SELECT * FROM events WHERE position_id = ? AND structure_type = ? ORDER BY event_date DESC',
        [positionId, structureType || 'snowball']
      )
    }
  )

  ipcMain.handle('events:create', (_event, data: Record<string, unknown>) => {
    execute(
      `INSERT INTO events (position_id, event_type, event_date, description, structure_type)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.position_id,
        data.event_type,
        data.event_date,
        (data.description as string) || '',
        (data.structure_type as string) || 'snowball'
      ]
    )
    return getLastInsertId()
  })

  ipcMain.handle('events:delete', (_event, id: number) => {
    execute('DELETE FROM events WHERE id = ?', [id])
    return true
  })
}
