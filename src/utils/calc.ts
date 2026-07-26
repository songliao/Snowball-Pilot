import dayjs from 'dayjs'

export interface PositionData {
  id?: number
  structure_type?: string // 'snowball' 雪球 | 'phoenix' 凤凰
  coupon_barrier_pct?: number // 凤凰：派息障碍比例
  coupon_freq?: string // 凤凰：派息观察频率
  // 通用簿记
  contract_no?: string // 合约编号
  interest_start_date?: string // 起息日
  // 雪球：敲出参数（序列以 JSON 字符串存储）
  knock_out_dates?: string // 敲出观察日（日期序列）
  knock_out_barriers?: string // 敲出障碍价格（百分比序列，原始百分比数值）
  knock_out_coupons?: string // 敲出票息（百分比序列，原始百分比数值）
  knock_out_enhance_participation?: number // 敲出增强参与率（百分比，默认0）
  dividend_coupon?: number // 红利票息（百分比，默认0）
  // 雪球：敲入参数
  knock_in_observation?: string // 敲入观察方式（daily 每日 / maturity 到期）
  knock_in_strike_pct?: number // 敲入执行价格（百分比，默认100）
  knock_in_participation?: number // 敲入参与率（百分比，默认100）
  // 雪球：保证金与最大亏损
  max_loss_pct?: number // 最大亏损（百分比，默认与保证金比例一致）
  // 雪球：返息信息
  rebate_annual_pct?: number // 年化后端返息（百分比，默认0）
  rebate_absolute_back_pct?: number // 绝对后端返息（百分比，默认0）
  rebate_absolute_front_pct?: number // 绝对前端返息（百分比，默认0）
  // 雪球：计息规则
  accrual_basis?: string // 计息规则（both 双含 / one 单含，默认双含）
  accrual_settle_tplus?: number // 计息结算T+（整数，默认0）
  product_name: string
  broker: string
  underlying?: string // 标的名称（兼容旧数据，新增仅录入标的代码）
  underlying_code: string
  notional: number
  initial_price: number
  knock_in_pct: number
  knock_out_pct: number
  coupon_rate: number
  margin_rate: number
  observation_freq: string
  knock_in_observed: number
  knock_out_observed: number
  status: string
  notes: string
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
