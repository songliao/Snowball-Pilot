import { ipcMain } from 'electron'
import { queryAll, queryOne, execute, getLastInsertId } from './index'
import {
  COMMON_COLS,
  PHOENIX_EXTRA,
  colsForType,
  tableForType,
  colValue
} from './schema'

const COMMON_SELECT = COMMON_COLS.join(', ')
// 凤凰专属列在列表中也需要展示（如派息观察日 / 派息障碍），雪球行用 0/'' 占位以对齐 UNION 列数
const PHOENIX_EXTRA_SELECT_SNOW = PHOENIX_EXTRA.map((c) =>
  (c === 'coupon_barrier' || c === 'coupon_rate' ? '0' : "''") + ` as ${c}`
).join(', ')
const PHOENIX_EXTRA_SELECT_PHOENIX = PHOENIX_EXTRA.join(', ')

export function registerPositionHandlers(): void {
  // 列表：两张表 UNION，并带上 structure_type 字面量
  ipcMain.handle('positions:get-all', () => {
    return queryAll(
      `SELECT id, ${COMMON_SELECT}, ${PHOENIX_EXTRA_SELECT_SNOW}, created_at, 'snowball' as structure_type FROM snowball_positions
       UNION ALL
       SELECT id, ${COMMON_SELECT}, ${PHOENIX_EXTRA_SELECT_PHOENIX}, created_at, 'phoenix' as structure_type FROM phoenix_positions
       ORDER BY created_at DESC`
    )
  })

  ipcMain.handle('positions:get-by-id', (_event, id: number) => {
    const snow = queryOne(
      `SELECT *, 'snowball' as structure_type FROM snowball_positions WHERE id = ?`,
      [id]
    )
    if (snow) return snow
    return queryOne(
      `SELECT *, 'phoenix' as structure_type FROM phoenix_positions WHERE id = ?`,
      [id]
    )
  })

  ipcMain.handle('positions:create', (_event, data: Record<string, unknown>) => {
    const table = tableForType(data.structure_type as string)
    const cols = colsForType(data.structure_type as string)
    const values = cols.map((c) => colValue(c, data))
    const placeholders = cols.map(() => '?').join(', ')
    execute(
      `INSERT INTO ${table} (${cols.join(', ')}, created_at, updated_at)
       VALUES (${placeholders}, datetime('now','localtime'), datetime('now','localtime'))`,
      values
    )
    return getLastInsertId()
  })

  ipcMain.handle(
    'positions:update',
    (_event, id: number, data: Record<string, unknown>) => {
      const table = tableForType(data.structure_type as string)
      const cols = colsForType(data.structure_type as string)
      const fields: string[] = []
      const values: unknown[] = []
      for (const col of cols) {
        if (col in data && data[col] !== undefined) {
          fields.push(`${col} = ?`)
          values.push(colValue(col, data))
        }
      }
      if (fields.length === 0) return false
      fields.push("updated_at = datetime('now','localtime')")
      values.push(id)
      execute(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`, values)
      return true
    }
  )

  ipcMain.handle('positions:delete', (_event, id: number, structureType: string) => {
    const table = tableForType(structureType)
    execute('DELETE FROM events WHERE position_id = ?', [id])
    execute(`DELETE FROM ${table} WHERE id = ?`, [id])
    return true
  })

  ipcMain.handle(
    'positions:update-status',
    (
      _event,
      id: number,
      status: string,
      structureType: string,
      isKi?: boolean,
      knockInDate?: string,
      terminationDate?: string,
      payoff?: number
    ) => {
      const table = tableForType(structureType)
      const fields: string[] = ['status = ?']
      const values: unknown[] = [status]

      if (isKi !== undefined) {
        // 敲入状态变更：标记或撤销敲入
        fields.push('is_ki = ?')
        values.push(isKi ? 1 : 0)
        if (isKi) {
          // 标记敲入：记录选定（或留空回退到当前）敲入日期
          const kiValue =
            knockInDate && /^\d{4}-\d{2}-\d{2}$/.test(knockInDate) ? knockInDate : null
          fields.push('knock_in_date = ?')
          values.push(kiValue)
        } else {
          // 撤销敲入：清空敲入日期
          fields.push('knock_in_date = NULL')
        }
      }

      if (terminationDate !== undefined) {
        // 了结（敲出/到期）：记录了结日期
        const tValue =
          terminationDate && /^\d{4}-\d{2}-\d{2}$/.test(terminationDate) ? terminationDate : null
        fields.push('termination_date = ?')
        values.push(tValue)
      }

      if (payoff !== undefined) {
        // 了结收益（绝对金额）；传 null 时清空为 NULL
        fields.push('termination_payoff = ?')
        values.push(payoff == null ? null : Number(payoff) || 0)
      }

      fields.push("updated_at = datetime('now','localtime')")
      values.push(id)
      execute(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`, values)
      return true
    }
  )
}
