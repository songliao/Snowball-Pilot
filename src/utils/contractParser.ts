// 合约文本导入解析器
// 将券商导出的雪球/凤凰合约文本（标准要素格式）自动识别并映射为持仓表单字段（snake_case，与 PositionForm 一致）。
// 表单/数据库暂无对应控件的字段（交易类型、报价参数、希腊字母等）会收集进 warnings，由 UI 提示「已忽略」。
// makeContractText 与 iOS 端 ContractParser.makeText 逐行同构：一端「复制合约」的文本，
// 粘贴到另一端「导入交易」可完整回填（键名/顺序/数值格式保持一致）。

import type { PositionData } from './calc'

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
  coupon_barrier?: number // 凤凰派息障碍价格
  coupon_rate?: number // 凤凰派息率（单值）
  coupon_dates?: string // 凤凰派息观察日（多行/空格分隔的日期）
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
  产品名称: { field: 'product_name', handle: (v) => v.trim() }, // 与 iOS 端「复制合约」互通：空值也识别，显式置空产品名
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
  年化费用: { field: 'annual_fee_pct', handle: (v) => toPercent(v) }, // 与 iOS 端互通
  收益分红: { field: 'income_dividend_pct', handle: (v) => toPercent(v) }, // 与 iOS 端互通
  红利票息: { field: 'maturity_coupon', handle: (v) => toPercent(v) },
  票息障碍价格: { field: 'coupon_barrier', handle: (v) => toPercent(v) }, // 凤凰派息障碍价格
  派息障碍价格: { field: 'coupon_barrier', handle: (v) => toPercent(v) }, // 凤凰派息障碍价格（标准要素用名）
  派息率: { field: 'coupon_rate', handle: (v) => toPercent(v) }, // 凤凰派息率（单值）
  备注信息: { field: 'notes', handle: (v) => (v.trim() === '-' ? '' : v.trim()) },
  挂钩标的: { field: 'underlying_code', handle: (v) => mapUnderlying(v) }
}

// 多行列表区块的标题 -> 表单字段。键为「去掉括号/后缀」后的规范标题，
// 匹配时会对原标题做 stripListKey 归一化，兼容券商导出的「敲出障碍价格(%)」等变体。
const LIST_FIELDS: Record<string, keyof ParsedContract> = {
  敲出观察日: 'knock_out_dates',
  敲出障碍价格: 'knock_out_barriers',
  敲出票息: 'knock_out_coupons', // 标准要素格式的雪球敲出票息
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
  // 判定依据是产品家族而不是「降敲」等收益特征：降敲早利雪球、降敲雪球都是雪球，
  // 只有凤凰/DCN 才进凤凰表（历史上曾把「降敲」误判为凤凰，导致交易存错表）
  if (v.includes('凤凰') || v.includes('DCN')) return 'phoenix'
  if (v.includes('气囊')) return 'airbag'
  return 'snowball' // 雪球 / 早利雪球 / 降敲早利雪球 / 平敲雪球 等
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
  const unmapped = new Set<string>()

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
      // 标准要素会给数值字段带「(%)」后缀（如「交易佣金(%)」），先精确匹配再按去括号归一化匹配
      const mapped = SIMPLE_FIELDS[key] ?? SIMPLE_FIELDS[stripListKey(key)]
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
      // 未映射的键（交易类型、报价参数、希腊字母等）记录下来供 UI 提示
      unmapped.add(stripListKey(key))
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

  // 回填列表字段（多行文本，与表单 parseDateList / parseNumberList 的分割规则一致）；
  // 纯数字 token 规范化为去尾零的数值文本（100.0000 → 100），日期保持原样
  for (const f of Object.keys(listBuffers) as (keyof ParsedContract)[]) {
    const arr = (listBuffers[f] ?? [])
      .map((s) => s.replace(/[%,]/g, '').trim())
      .filter(Boolean)
      .map((s) => (/^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s))
    if (arr.length) {
      ;(result as Record<string, unknown>)[f as string] = arr.join('\n')
    }
  }

  // 结构类型派生后回填产品名称（仅当文本未提供产品名称键时；
  // 用 === undefined 判断，「产品名称：」显式空值（iOS 复制合约的置空写法）不会被兜底覆盖）
  if (result.product_name === undefined) {
    // 用原始结构类型文本作为默认产品名，便于区分
    const m = text.match(/结构类型[：:]\s*(.+)/)
    if (m) result.product_name = m[1].trim()
  }

  result.warnings = Array.from(unmapped)
  return result
}

// ——— 复制合约：持仓 → 要素文本（与 iOS ContractParser.makeText 逐行同构） ———

// 兼容「字符串里嵌 JSON」的双重编码形态（与 calc.ts parseJsonField 一致）
function parseJsonField(raw?: string): unknown {
  let v: unknown = raw
  for (let i = 0; i < 3; i++) {
    if (typeof v === 'string') {
      try { v = JSON.parse(v) } catch { break }
    } else break
  }
  return v
}

function jsonStringArray(raw?: string): string[] {
  const arr = parseJsonField(raw)
  return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : String(x))) : []
}

function jsonNumberArray(raw?: string): number[] {
  const arr = parseJsonField(raw)
  if (!Array.isArray(arr)) return []
  return arr
    .map((x) => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN))
    .filter((n) => Number.isFinite(n))
}

// 小数比例 → 百分数文本（0.156 → "15.6%"），4 位小数去尾零；parse 侧去 % 后 ÷100 还原
function percentText(ratio: number | undefined): string {
  let text = ((ratio ?? 0) * 100).toFixed(4)
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '')
  }
  return text + '%'
}

// JS String(Number)：整数去小数点（100 → "100"），与 iOS 端 jsNumberString 一致
function jsNum(n: number | undefined): string {
  const value = n ?? 0
  return Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(value)
}

/**
 * 持仓 → 要素文本，与 parseContractText 互逆（iOS 端粘贴导入可直接识别）：
 * 键名取自 SIMPLE_FIELDS/LIST_FIELDS 映射表；比例字段导出为百分数文本（parse 侧去 % 后 ÷100 还原）；
 * 序列字段导出为「键名：空值 + 逐行数据」；生命周期字段（敲入/了结状态、日期、收益、已收派息）不导出。
 */
export function makeContractText(pos: PositionData): string {
  const lines: string[] = []
  const structureLabel = pos.structure_type === 'phoenix' ? '凤凰' : '雪球'
  // 产品名称始终导出（空值也带键名）：显式置空可避免 parse 侧「结构类型值兜底」错填产品名
  lines.push(`产品名称：${pos.product_name || ''}`)
  if (pos.contract_no) lines.push(`交易编号：${pos.contract_no}`)
  lines.push(`结构类型：${structureLabel}`)
  if (pos.broker) lines.push(`交易对手方：${pos.broker}`)
  if (pos.underlying_code) lines.push(`挂钩标的：${pos.underlying_code}`)
  if ((pos.notional ?? 0) > 0) lines.push(`名义本金：${jsNum(pos.notional)}`)
  if (pos.trade_start_date) lines.push(`交易日期：${pos.trade_start_date}`)
  if ((pos.initial_price ?? 0) > 0) lines.push(`期初价格：${jsNum(pos.initial_price)}`)
  if ((pos.margin_ratio ?? 0) > 0) lines.push(`保证金比例：${percentText(pos.margin_ratio)}`)
  if ((pos.max_loss_pct ?? 0) > 0) lines.push(`最大亏损比例：${percentText(pos.max_loss_pct)}`)

  const koDates = jsonStringArray(pos.knock_out_dates)
  if (koDates.length) {
    lines.push('敲出观察日：')
    lines.push(...koDates)
  }
  const koBarriers = jsonNumberArray(pos.knock_out_barriers)
  if (koBarriers.length) {
    lines.push('敲出障碍价格：')
    lines.push(...koBarriers.map(jsNum))
  }

  // 敲入组为两结构共有字段，必须在结构分支之外导出（否则凤凰复制丢敲入参数，与 iOS 端同）
  if ((pos.knock_in_barrier ?? 0) > 0) lines.push(`敲入障碍价格：${percentText(pos.knock_in_barrier)}`)
  if (pos.knock_in_observation) lines.push(`敲入观察方式：${pos.knock_in_observation}`)
  if ((pos.knock_in_strike ?? 0) > 0) lines.push(`敲入执行价格：${percentText(pos.knock_in_strike)}`)
  if ((pos.knock_in_participation ?? 0) > 0) lines.push(`敲入参与率：${percentText(pos.knock_in_participation)}`)

  if (pos.structure_type === 'phoenix') {
    if ((pos.coupon_barrier ?? 0) > 0) lines.push(`派息障碍价格：${percentText(pos.coupon_barrier)}`)
    if ((pos.coupon_rate ?? 0) > 0) lines.push(`派息率：${percentText(pos.coupon_rate)}`)
    const cpDates = jsonStringArray(pos.coupon_dates)
    if (cpDates.length) {
      lines.push('派息观察日：')
      lines.push(...cpDates)
    }
  } else {
    const coupons = jsonNumberArray(pos.knock_out_coupons)
    if (coupons.length) {
      lines.push('敲出票息：')
      lines.push(...coupons.map(jsNum))
    }
    if ((pos.maturity_coupon ?? 0) > 0) lines.push(`红利票息：${percentText(pos.maturity_coupon)}`)
    if ((pos.knock_out_enhance_participation ?? 0) > 0) {
      lines.push(`敲出增强参与率：${percentText(pos.knock_out_enhance_participation)}`)
    }
  }

  if ((pos.rebate_annual_pct ?? 0) > 0) lines.push(`年化后端返息：${percentText(pos.rebate_annual_pct)}`)
  if ((pos.rebate_absolute_back_pct ?? 0) > 0) lines.push(`绝对后端返息：${percentText(pos.rebate_absolute_back_pct)}`)
  if ((pos.rebate_absolute_front_pct ?? 0) > 0) lines.push(`绝对前端返息：${percentText(pos.rebate_absolute_front_pct)}`)
  if (pos.accrual_basis) lines.push(`计息规则：${pos.accrual_basis}`)
  if ((pos.accrual_settle_tplus ?? 0) > 0) lines.push(`计息结算T+：${pos.accrual_settle_tplus}`)
  if ((pos.abs_fee_pct ?? 0) > 0) lines.push(`交易佣金：${percentText(pos.abs_fee_pct)}`)
  if ((pos.annual_fee_pct ?? 0) > 0) lines.push(`年化费用：${percentText(pos.annual_fee_pct)}`)
  if ((pos.income_dividend_pct ?? 0) > 0) lines.push(`收益分红：${percentText(pos.income_dividend_pct)}`)
  if (pos.notes) {
    // 备注是单行键值对，多行备注折成一行（解析器按行取值）
    lines.push(`备注信息：${pos.notes.replace(/\r?\n/g, ' ')}`)
  }
  return lines.join('\n')
}
