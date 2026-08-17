// 合约文本导入解析器
// 将券商导出的雪球合约文本自动识别并映射为持仓表单字段（snake_case，与 PositionForm 一致）。
// 仅填充「新增持仓」表单中真实存在的字段；其余信息（希腊字母、报价参数等）表单无对应控件，忽略。

export interface ParsedContract {
  structureType: 'snowball' | 'phoenix' | 'airbag'
  product_name?: string
  contract_no?: string
  broker?: string
  underlying_code?: string
  notional?: number
  trade_start_date?: string // YYYY-MM-DD
  initial_price?: number
  knock_out_dates?: string // 多行/空格分隔的日期
  knock_out_barriers?: string // 多行/空格分隔的百分比
  knock_out_coupons?: string // 多行/空格分隔的百分比
  knock_out_enhance_participation?: number
  maturity_coupon?: number
  knock_in_barrier?: number
  knock_in_observation?: string
  knock_in_strike?: number
  knock_in_participation?: number
  is_ki?: boolean
  margin_ratio?: number
  max_loss_pct?: number
  rebate_annual_pct?: number
  rebate_absolute_back_pct?: number
  rebate_absolute_front_pct?: number
  accrual_basis?: string
  accrual_settle_tplus?: number
  abs_fee_pct?: number
  annual_fee_pct?: number
  income_dividend_pct?: number
  notes?: string
  warnings: string[] // 未识别或无法映射的字段，供 UI 提示
}

const INDEX_NAME_TO_CODE: Record<string, string> = {
  中证500: '000905.SH',
  沪深300: '000300.SH',
  中证1000: '000852.SH',
  上证50: '000016.SH'
}

// 简单的 key:value 行 -> 表单字段 + 取值转换器
type ValueHandler = (raw: string) => unknown

const SIMPLE_FIELDS: Record<string, { field: keyof ParsedContract; handle?: ValueHandler }> = {
  交易编号: { field: 'contract_no', handle: (v) => v.trim() },
  结构类型: { field: 'structureType', handle: (v) => deriveStructureType(v) },
  交易对手方: { field: 'broker', handle: (v) => v.trim() },
  名义本金: { field: 'notional', handle: (v) => toNumber(v) },
  交易日期: { field: 'trade_start_date', handle: (v) => toDateStr(v) },
  期初价格: { field: 'initial_price', handle: (v) => toNumber(v) },
  交易佣金: { field: 'abs_fee_pct', handle: (v) => toPercent(v) },
  敲出增强参与率: { field: 'knock_out_enhance_participation', handle: (v) => toPercent(v) },
  敲入障碍价格: { field: 'knock_in_barrier', handle: (v) => toPercent(v) },
  敲入观察方式: { field: 'knock_in_observation', handle: (v) => mapKnockInObservation(v) },
  敲入执行价格: { field: 'knock_in_strike', handle: (v) => toPercent(v) },
  敲入参与率: { field: 'knock_in_participation', handle: (v) => toPercent(v) },
  保证金比例: { field: 'margin_ratio', handle: (v) => toPercent(v) },
  最大亏损比例: { field: 'max_loss_pct', handle: (v) => toPercent(v) },
  年化后端返息: { field: 'rebate_annual_pct', handle: (v) => toPercent(v) },
  绝对后端返息: { field: 'rebate_absolute_back_pct', handle: (v) => toPercent(v) },
  绝对前端返息: { field: 'rebate_absolute_front_pct', handle: (v) => toPercent(v) },
  计息规则: { field: 'accrual_basis', handle: (v) => mapAccrualBasis(v) },
  '计息结算T+': { field: 'accrual_settle_tplus', handle: (v) => toNumber(v) },
  '计息结算T': { field: 'accrual_settle_tplus', handle: (v) => toNumber(v) },
  红利票息: { field: 'maturity_coupon', handle: (v) => toPercent(v) },
  票息障碍价格: { field: 'coupon_barrier', handle: (v) => toPercent(v) }, // 凤凰派息障碍价格
  派息率: { field: 'coupon_rate', handle: (v) => toPercent(v) }, // 凤凰派息率（单值）
  备注信息: { field: 'notes', handle: (v) => v.trim() },
  挂钩标的: { field: 'underlying_code', handle: (v) => mapUnderlying(v) }
}

// 多行列表区块的标题 -> 表单字段。键为「去掉括号/后缀」后的规范标题，
// 匹配时会对原标题做 stripListKey 归一化，兼容券商导出的「敲出障碍价格(%)」等变体。
const LIST_FIELDS: Record<string, keyof ParsedContract> = {
  敲出观察日: 'knock_out_dates',
  敲出障碍价格: 'knock_out_barriers',
  票息: 'knock_out_coupons', // 兼容「票息/派息率(%)」归一化后
  派息观察日: 'coupon_dates' // 凤凰派息观察日
}

// 列表标题归一化：去掉末尾括号（含其中内容）、以及「/派息率」等后缀
function stripListKey(key: string): string {
  return key
    .replace(/[（(].*?[)）]\s*$/g, '')
    .replace(/\/派息率$/g, '')
    .replace(/\s+$/g, '')
}

function toNumber(raw: string): number | undefined {
  const s = raw.replace(/,/g, '').replace(/%/g, '').trim()
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

// 百分比值（如 70.00% / 0.00%）-> 百分比数字（70 / 0），表单按百分比录入
function toPercent(raw: string): number | undefined {
  return toNumber(raw)
}

function toDateStr(raw: string): string | undefined {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return undefined
}

function deriveStructureType(raw: string): ParsedContract['structureType'] {
  const v = raw.trim()
  if (v.includes('凤凰') || v.includes('DCN') || v.includes('降敲')) return 'phoenix'
  if (v.includes('气囊')) return 'airbag'
  return 'snowball' // 雪球 / 早利雪球 / 平敲雪球 等
}

function mapKnockInObservation(raw: string): string {
  const v = raw.trim()
  if (v.includes('每日') || v.includes('每天')) return 'daily'
  if (v.includes('到期') || v.includes('期末') || v.includes('仅到期')) return 'maturity'
  return v // 兜底：保留原文，表单 select 可能无匹配项
}

function mapAccrualBasis(raw: string): string {
  const v = raw.trim()
  if (v.includes('双')) return 'both'
  if (v.includes('单')) return 'one'
  return v
}

function mapUnderlying(raw: string): string {
  const v = raw.trim()
  return INDEX_NAME_TO_CODE[v] ?? v
}

function normalizeKey(line: string): string {
  // 去掉冒号（中英文）与前后空格
  return line.replace(/[:：]\s*$/, '').trim()
}

export function parseContractText(text: string): ParsedContract {
  const result: ParsedContract = { structureType: 'snowball', warnings: [] }
  const lines = text.split(/\r?\n/)
  let currentListField: keyof ParsedContract | null = null
  const listBuffers: Partial<Record<keyof ParsedContract, string[]>> = {}

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // 区块分隔行：--- xxx ---，结束当前列表
    if (/^-{2,}\s*(.*?)\s*-{2,}$/.test(line)) {
      currentListField = null
      continue
    }
    if (line === '') continue

    // key: value 行
    const kvMatch = line.match(/^(.+?)[：:]\s*(.*)$/)
    if (kvMatch) {
      const key = normalizeKey(kvMatch[1])
      const value = kvMatch[2].trim()
      const mapped = SIMPLE_FIELDS[key]
      if (mapped) {
        const parsed = mapped.handle ? mapped.handle(value) : value
        if (parsed !== undefined) {
          ;(result as Record<string, unknown>)[mapped.field as string] = parsed
        }
        currentListField = null
        continue
      }
      // 列表标题（value 为空，且 key 命中列表区块）
      if (value === '' && LIST_FIELDS[stripListKey(key)]) {
        const f = LIST_FIELDS[stripListKey(key)]
        currentListField = f
        if (!listBuffers[f]) listBuffers[f] = []
        continue
      }
      // 已知但无表单字段的键（如 期限、希腊字母等）忽略
      continue
    }

    // 列表数据行（缩进的日期或数字）
    if (currentListField && line) {
      const buf = listBuffers[currentListField] ?? (listBuffers[currentListField] = [])
      buf.push(line)
      continue
    }
    // 其它无法识别的行忽略
  }

  // 回填列表字段（多行文本，与表单 parseDateList / parseNumberList 的分割规则一致）
  for (const f of Object.keys(listBuffers) as (keyof ParsedContract)[]) {
    const arr = (listBuffers[f] ?? []).map((s) => s.replace(/[%,]/g, '').trim()).filter(Boolean)
    if (arr.length) {
      ;(result as Record<string, unknown>)[f as string] = arr.join('\n')
    }
  }

  // 结构类型派生后回填产品名称（若文本未提供销售部门/产品名）
  if (!result.product_name) {
    // 用原始结构类型文本作为默认产品名，便于区分
    const m = text.match(/结构类型[：:]\s*(.+)/)
    if (m) result.product_name = m[1].trim()
  }

  return result
}
