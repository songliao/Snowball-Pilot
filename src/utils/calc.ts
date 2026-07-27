import dayjs from 'dayjs'

export interface PositionData {
  id?: number
  structure_type?: string // 'snowball' 雪球 | 'phoenix' 凤凰
  // 通用簿记
  contract_no?: string // 合约编号
  // 起息日（雪球/凤凰共用）
  trade_start_date?: string
  // 敲出参数（序列以 JSON 字符串存储）
  knock_out_dates?: string // 敲出观察日（日期序列）
  knock_out_barriers?: string // 敲出障碍价格（百分比序列，原始百分比数值）
  knock_out_coupons?: string // 雪球：敲出票息（百分比序列）
  knock_out_enhance_participation?: number // 雪球：敲出增强参与率（百分比）
  maturity_coupon?: number // 雪球：到期票息（百分比）
  // 敲入参数
  knock_in_observation?: string // 敲入观察方式（daily 每日 / maturity 到期）
  knock_in_barrier?: number // 敲入障碍比例（百分比）
  knock_in_strike?: number // 敲入执行价比例（百分比）
  knock_in_participation?: number // 敲入参与率（百分比）
  // 保证金与最大亏损
  margin_ratio?: number // 保证金比例（百分比）
  max_loss_pct?: number // 最大亏损（百分比）
  // 雪球：终止条款
  termination_date?: string // 了结（终止）日期
  termination_payoff?: number // 了结收益（绝对金额）
  // 返息信息
  rebate_annual_pct?: number // 年化后端返息（百分比）
  rebate_absolute_back_pct?: number // 绝对后端返息（百分比）
  rebate_absolute_front_pct?: number // 绝对前端返息（百分比）
  // 计息规则
  accrual_basis?: string // 计息规则（both 双含 / one 单含）
  accrual_settle_tplus?: number // 计息结算T+（整数）
  // 费用
  abs_fee_pct?: number // 绝对费用（百分比）
  annual_fee_pct?: number // 年化费用（百分比）
  income_dividend_pct?: number // 收益分红（百分比）
  // 凤凰派息
  coupon_barrier?: number // 派息障碍比例（百分比）
  coupon_dates?: string // 派息观察日（日期序列）
  coupon_rate?: number // 派息率（百分比，按名义本金绝对百分比）
  coupon_received?: string // 已派息记录（JSON 数组）
  coupon_payment_dates?: string // 派息支付日（JSON 日期数组）
  // 通用
  product_name?: string
  broker?: string
  underlying?: string // 标的名称（兼容旧数据）
  underlying_code?: string
  notional?: number
  initial_price?: number
  status?: string
  is_ki?: boolean // 敲入状态（0=未敲入 1=已敲入）
  knock_in_date?: string // 敲入日期（标记敲入时记录，撤销时清空）
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface PriceData {
  id?: number
  underlying_code: string
  price: number
  date: string
  source: string
}

export interface EventData {
  id?: number
  position_id: number
  event_type: string
  event_date: string
  description: string
  structure_type?: string
  created_at?: string
}

/**
 * 计算持有天数
 */
export function calcHoldingDays(effectiveDate: string, endDate?: string): number {
  const start = dayjs(effectiveDate)
  const end = endDate ? dayjs(endDate) : dayjs()
  return Math.max(0, end.diff(start, 'day'))
}

/**
 * 计算敲入价格
 */
export function calcKnockInPrice(initialPrice: number, knockInPct: number): number {
  return initialPrice * knockInPct
}

/**
 * 计算敲出价格
 */
export function calcKnockOutPrice(initialPrice: number, knockOutPct: number): number {
  return initialPrice * knockOutPct
}

/**
 * 计算安全垫 = (当前价 - 敲入价) / 当前价
 */
export function calcSafetyMargin(currentPrice: number, knockInPrice: number): number {
  if (currentPrice <= 0) return 0
  return (currentPrice - knockInPrice) / currentPrice
}

/**
 * 计算浮动盈亏
 * - active（未敲入未敲出）：名义本金 × 票息率 × 持有天数/365
 * - knocked_out：名义本金 × 票息率 × 持有天数/365（已实现）
 * - knocked_in（持有到期）：名义本金 × (期末价/期初价 - 1)
 */
export function calcPnL(
  position: PositionData,
  currentPrice?: number
): { pnl: number; pnlRate: number; type: string } {
  const { notional, coupon_rate, initial_price, status } = position

  // 注：原按「生效/到期日」计提持有期票息；已按需求移除日期字段。
  // 敲出/存续/到期的票息计提规则待用户补充后实现，目前时间相关收益计为 0。
  if (status === 'knocked_out') {
    return { pnl: 0, pnlRate: 0, type: '已敲出' }
  }

  if (status === 'knocked_in') {
    if (currentPrice && currentPrice > 0) {
      const pnl = notional * (currentPrice / initial_price - 1)
      return { pnl, pnlRate: (pnl / notional) * 100, type: '敲入浮亏' }
    }
    return { pnl: 0, pnlRate: 0, type: '敲入待估' }
  }

  if (status === 'matured') {
    if (currentPrice && currentPrice > 0 && currentPrice < initial_price) {
      const pnl = notional * (currentPrice / initial_price - 1)
      return { pnl, pnlRate: (pnl / notional) * 100, type: '到期亏损' }
    }
    return { pnl: 0, pnlRate: 0, type: '到期收益' }
  }

  // active：未敲入未敲出，按市值暂不计浮动盈亏
  return { pnl: 0, pnlRate: 0, type: '浮动票息' }
}

/**
 * 计算距到期天数
 */
export function calcDaysToMaturity(maturityDate: string): number {
  return dayjs(maturityDate).diff(dayjs(), 'day')
}

/**
 * 计算年化收益率
 */
export function calcAnnualizedReturn(pnlRate: number, holdingDays: number): number {
  if (holdingDays <= 0) return 0
  return (pnlRate / 100) * (365 / holdingDays) * 100
}

/**
 * 从某个日期起往后数 n 个交易日（近似：跳过周末，不含起始日当天）
 */
export function addTradingDays(start: dayjs.Dayjs, n: number): dayjs.Dayjs {
  let d = start
  let count = 0
  while (count < n) {
    d = d.add(1, 'day')
    const dow = d.day() // 0=周日 6=周六
    if (dow !== 0 && dow !== 6) count++
  }
  return d
}

export interface KnockOutProfitInput {
  notional: number // 名义本金
  couponPct: number // 敲出票息率（百分比，如 15 表示 15%）
  tradeStartDate: string // 起息日 YYYY-MM-DD
  koObservationDate: string // 敲出观察日 YYYY-MM-DD
  accrualBasis: 'both' | 'one' // 计息规则：双含 / 单含
  accrualSettleTplus: number // 计息结算 T+
  rebateAnnualPct: number // 年化后端返息（小数）
  rebateAbsFrontPct: number // 绝对前端返息（小数）
  rebateAbsBackPct: number // 绝对后端返息（小数）
  absFeePct: number // 绝对费用（小数）
  annualFeePct: number // 年化费用（小数）
  incomeDividendPct: number // 收益分红（小数）
}

export interface KnockOutProfitResult {
  settleDate: string // 计息结日
  holdingDays: number // 自然日天数（含/不含按计息规则）
  holdingYears: number // 存续时间（年）
  coupon: number // 票息
  rebate: { annual: number; absFront: number; absBack: number; total: number }
  fees: { absFee: number; annualFee: number; dividend: number; total: number }
  net: number // 敲出收益
}

/**
 * 敲出收益 = 票息 + 返息 - 交易费用
 * 票息     = 敲出票息率 × 存续时间 × 名义本金
 * 返息     = 年化后端返息 + 绝对前端返息 + 绝对后端返息
 * 交易费用 = 绝对费用×名义本金 + 年化费用×存续时间×名义本金 + 收益分红（票息×收益分红）
 * 存续时间 = 从起息日（含）到「敲出观察日 + T+ N 交易日」的自然日天数 / 365
 */
export function computeKnockOutProfit(input: KnockOutProfitInput): KnockOutProfitResult | null {
  const {
    notional, couponPct, tradeStartDate, koObservationDate,
    accrualBasis, accrualSettleTplus,
    rebateAnnualPct, rebateAbsFrontPct, rebateAbsBackPct,
    absFeePct, annualFeePct, incomeDividendPct
  } = input

  if (!tradeStartDate || !koObservationDate || notional == null) return null

  const start = dayjs(tradeStartDate)
  const koObs = dayjs(koObservationDate)
  if (!start.isValid() || !koObs.isValid()) return null

  const settle = addTradingDays(koObs, accrualSettleTplus || 0)
  const rawDays = settle.diff(start, 'day')
  // 双含：两端都计入 → +1；单含：计入一端 → 不补
  const holdingDays = Math.max(0, accrualBasis === 'both' ? rawDays + 1 : rawDays)
  const holdingYears = holdingDays / 365

  const couponRate = (couponPct || 0) / 100
  const coupon = notional * couponRate * holdingYears

  const rebateAnnual = notional * (rebateAnnualPct || 0) * holdingYears
  const rebateAbsFront = notional * (rebateAbsFrontPct || 0)
  const rebateAbsBack = notional * (rebateAbsBackPct || 0)
  const rebateTotal = rebateAnnual + rebateAbsFront + rebateAbsBack

  const feeAbs = notional * (absFeePct || 0)
  const feeAnnual = notional * (annualFeePct || 0) * holdingYears
  const feeDividend = coupon * (incomeDividendPct || 0) // 收益分红 = 敲出票息金额 × 收益分红
  const feeTotal = feeAbs + feeAnnual + feeDividend

  const net = coupon + rebateTotal - feeTotal

  return {
    settleDate: settle.format('YYYY-MM-DD'),
    holdingDays,
    holdingYears,
    coupon,
    rebate: { annual: rebateAnnual, absFront: rebateAbsFront, absBack: rebateAbsBack, total: rebateTotal },
    fees: { absFee: feeAbs, annualFee: feeAnnual, dividend: feeDividend, total: feeTotal },
    net
  }
}
