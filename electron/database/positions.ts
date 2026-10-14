import { ipcMain, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { queryAll, queryOne, execute, getLastInsertId } from './index'
import {
  COMMON_COLS,
  SNOWBALL_EXTRA,
  PHOENIX_EXTRA,
  colsForType,
  tableForType,
  colValue
} from './schema'

const COMMON_SELECT = COMMON_COLS.join(', ')
// 雪球专属列（敲出票息等）：雪球行取真实列，凤凰行用 0/'' 占位以对齐 UNION 列数
const SNOWBALL_EXTRA_SELECT_SNOW = SNOWBALL_EXTRA.join(', ')
const SNOWBALL_EXTRA_SELECT_PHOENIX = SNOWBALL_EXTRA.map((c) =>
  (c === 'knock_out_enhance_participation' || c === 'maturity_coupon' ? '0' : "''") + ` as ${c}`
).join(', ')
// 凤凰专属列（派息率等）：凤凰行取真实列，雪球行用 0/'' 占位
const PHOENIX_EXTRA_SELECT_SNOW = PHOENIX_EXTRA.map((c) =>
  (c === 'coupon_barrier' || c === 'coupon_rate' ? '0' : "''") + ` as ${c}`
).join(', ')
const PHOENIX_EXTRA_SELECT_PHOENIX = PHOENIX_EXTRA.join(', ')

// UNION 两行列顺序必须完全一致：COMMON + 雪球专属 + 凤凰专属 + created_at + structure_type
const EXTRA_SELECT_SNOW = `${SNOWBALL_EXTRA_SELECT_SNOW}, ${PHOENIX_EXTRA_SELECT_SNOW}`
const EXTRA_SELECT_PHOENIX = `${SNOWBALL_EXTRA_SELECT_PHOENIX}, ${PHOENIX_EXTRA_SELECT_PHOENIX}`

const ALL_POSITIONS_SQL = `SELECT id, ${COMMON_SELECT}, ${EXTRA_SELECT_SNOW}, created_at, 'snowball' as structure_type FROM snowball_positions
   UNION ALL
   SELECT id, ${COMMON_SELECT}, ${EXTRA_SELECT_PHOENIX}, created_at, 'phoenix' as structure_type FROM phoenix_positions
   ORDER BY created_at DESC`

// ——— CSV 导出 / 导入 ———

// CSV 导出列：结构类型 + 全部数据列（两表专属列并存，另一类型留空）
const CSV_COLUMNS = ['structure_type', ...COMMON_COLS, ...SNOWBALL_EXTRA, ...PHOENIX_EXTRA]

// 导入时需要转为数值的列（其余字符串列原样写入，空值交给 colValue 兜底）
const NUMERIC_COLS = new Set([
  'notional',
  'initial_price',
  'knock_in_barrier',
  'knock_in_strike',
  'margin_ratio',
  'knock_in_participation',
  'max_loss_pct',
  'rebate_annual_pct',
  'rebate_absolute_back_pct',
  'rebate_absolute_front_pct',
  'accrual_settle_tplus',
  'abs_fee_pct',
  'annual_fee_pct',
  'income_dividend_pct',
  'termination_payoff',
  'knock_out_enhance_participation',
  'maturity_coupon',
  'coupon_barrier',
  'coupon_rate'
])

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 最小 RFC4180 解析器：支持引号包裹、双引号转义、CRLF
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // 过滤完全空白的行
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function registerPositionHandlers(): void {
  // 列表：两张表 UNION，并带上 structure_type 字面量
  ipcMain.handle('positions:get-all', () => {
    return queryAll(ALL_POSITIONS_SQL)
  })

  // 导出全部持仓为 CSV：弹出保存对话框，带 BOM 便于 Excel 直接打开
  ipcMain.handle('positions:export-csv', async () => {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    const dialogResult = await dialog.showSaveDialog({
      title: '导出持仓',
      defaultPath: `持仓导出_${stamp}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, canceled: true }

    const rows = queryAll<Record<string, unknown>>(ALL_POSITIONS_SQL)
    const lines = [CSV_COLUMNS.join(',')]
    for (const row of rows) {
      lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','))
    }
    try {
      // \uFEFF BOM：Excel 识别 UTF-8 中文
      writeFileSync(dialogResult.filePath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8')
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return { ok: true, path: dialogResult.filePath, count: rows.length }
  })

  // 从 CSV 批量导入持仓：按 structure_type 分表写入，逐行容错
  ipcMain.handle('positions:import-csv', async () => {
    const dialogResult = await dialog.showOpenDialog({
      title: '导入持仓',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile']
    })
    if (dialogResult.canceled || !dialogResult.filePaths.length) return { ok: false, canceled: true }

    let rows: string[][]
    try {
      rows = parseCsv(readFileSync(dialogResult.filePaths[0], 'utf-8'))
    } catch (e) {
      return { ok: false, error: `读取文件失败：${e instanceof Error ? e.message : String(e)}` }
    }
    if (rows.length < 2) return { ok: false, error: '文件为空或缺少数据行' }

    const header = rows[0].map((h) => h.trim())
    let imported = 0
    let failed = 0
    for (let r = 1; r < rows.length; r++) {
      const rec: Record<string, string> = {}
      header.forEach((h, i) => {
        rec[h] = rows[r][i] ?? ''
      })
      try {
        const structureType = (rec.structure_type || '').trim()
        if (structureType !== 'snowball' && structureType !== 'phoenix') throw new Error('无效的 structure_type')
        const cols = colsForType(structureType)
        const data: Record<string, unknown> = { structure_type: structureType }
        for (const col of cols) {
          const raw = (rec[col] ?? '').trim()
          if (raw === '') continue
          data[col] = NUMERIC_COLS.has(col) ? Number(raw) : raw
        }
        data.is_ki = (rec.is_ki ?? '').trim() === '1'
        const values = cols.map((c) => colValue(c, data))
        execute(
          `INSERT INTO ${tableForType(structureType)} (${cols.join(', ')}, created_at, updated_at)
           VALUES (${cols.map(() => '?').join(', ')}, datetime('now','localtime'), datetime('now','localtime'))`,
          values
        )
        imported++
      } catch {
        failed++
      }
    }
    if (imported === 0 && failed > 0) return { ok: false, error: `全部 ${failed} 行导入失败，请检查文件是否为本软件导出的持仓 CSV` }
    return { ok: true, imported, failed }
  })

  ipcMain.handle('positions:get-by-id', (_event, id: number, structureType?: string) => {
    // 两张表各自的 id 独立自增，同名 id 可能分属雪球/凤凰两条记录。
    // 必须带上 structureType 才能唯一确定要查的表，否则会误命中另一张表同号记录。
    if (structureType === 'phoenix') {
      return queryOne(
        `SELECT *, 'phoenix' as structure_type FROM phoenix_positions WHERE id = ?`,
        [id]
      )
    }
    if (structureType === 'snowball') {
      return queryOne(
        `SELECT *, 'snowball' as structure_type FROM snowball_positions WHERE id = ?`,
        [id]
      )
    }
    // 兜底：未提供类型时（如旧链接/手动刷新），先雪球后凤凰，保持历史行为。
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
    const eventType = structureType === 'phoenix' ? 'phoenix' : 'snowball'
    execute('DELETE FROM events WHERE position_id = ? AND structure_type = ?', [id, eventType])
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
