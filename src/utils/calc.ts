import dayjs from 'dayjs'

export interface PositionData {
  id?: number
  product_name: string
  broker: string
  underlying: string
  underlying_code: string
  notional: number
  trade_date: string
  effective_date: string
  maturity_date: string
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
  const { notional, coupon_rate, effective_date, maturity_date, initial_price, status } = position

  if (status === 'knocked_out') {
    // 已敲出：获得票息收益
    const days = calcHoldingDays(effective_date)
    const pnl = notional * coupon_rate * (days / 365)
    return { pnl, pnlRate: (pnl / notional) * 100, type: '已敲出收益' }
  }

  if (status === 'knocked_in') {
    // 已敲入：可能亏损
    if (currentPrice && currentPrice > 0) {
      const pnl = notional * (currentPrice / initial_price - 1)
      return { pnl, pnlRate: (pnl / notional) * 100, type: '敲入浮亏' }
    }
    return { pnl: 0, pnlRate: 0, type: '敲入待估' }
  }

  if (status === 'matured') {
    // 已到期
    if (currentPrice && currentPrice > 0 && currentPrice < initial_price) {
      const pnl = notional * (currentPrice / initial_price - 1)
      return { pnl, pnlRate: (pnl / notional) * 100, type: '到期亏损' }
    }
    const days = calcHoldingDays(effective_date, maturity_date)
    const pnl = notional * coupon_rate * (days / 365)
    return { pnl, pnlRate: (pnl / notional) * 100, type: '到期收益' }
  }

  // active：浮动票息收益
  const days = calcHoldingDays(effective_date)
  const pnl = notional * coupon_rate * (days / 365)
  return { pnl, pnlRate: (pnl / notional) * 100, type: '浮动票息' }
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
