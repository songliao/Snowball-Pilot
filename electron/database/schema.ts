// 雪球 / 凤凰 分表的结构定义与取值映射
// 公共列（两张表都包含，界面通用字段）
export const COMMON_COLS = [
  'product_name',
  'broker',
  'contract_no',
  'trade_start_date', // 起息日（雪球/凤凰共用）
  'underlying_code',
  'notional',
  'initial_price',
  'knock_in_barrier', // 敲入障碍比例
  'knock_in_strike',  // 敲入执行价比例
  'margin_ratio',     // 保证金比例
  'knock_out_dates',
  'knock_out_barriers',
  'knock_in_observation',
  'knock_in_participation',
  'max_loss_pct',
  'rebate_annual_pct',
  'rebate_absolute_back_pct',
  'rebate_absolute_front_pct',
  'accrual_basis',
  'accrual_settle_tplus',
  'abs_fee_pct',
  'annual_fee_pct',
  'income_dividend_pct',
  'notes',
  'status',
  'is_ki',                  // 敲入状态（0=未敲入 1=已敲入）
  'knock_in_date',          // 敲入日期（标记敲入时记录，撤销时清空）
  'termination_date',       // 了结（终止）日期（敲出/到期时记录，雪球/凤凰共用）
  'termination_payoff'      // 了结收益（绝对金额，敲出/到期时记录，雪球/凤凰共用）
]

// 雪球专属列
export const SNOWBALL_EXTRA = [
  'knock_out_coupons',
  'knock_out_enhance_participation',
  'maturity_coupon'
]
// 凤凰专属列
export const PHOENIX_EXTRA = [
  'coupon_barrier',
  'coupon_dates',
  'coupon_rate',
  'coupon_received',        // 已派息记录（数组，JSON 文本）
  'coupon_payment_dates'    // 派息支付日（日期数组，JSON 文本）
]

export const SNOWBALL_TABLE = 'snowball_positions'
export const PHOENIX_TABLE = 'phoenix_positions'

export const SNOWBALL_COLS = [...COMMON_COLS, ...SNOWBALL_EXTRA]
export const PHOENIX_COLS = [...COMMON_COLS, ...PHOENIX_EXTRA]

export function colsForType(structureType?: string): string[] {
  return structureType === 'phoenix' ? PHOENIX_COLS : SNOWBALL_COLS
}

export function tableForType(structureType?: string): string {
  return structureType === 'phoenix' ? PHOENIX_TABLE : SNOWBALL_TABLE
}

// 将一行数据按列名映射到可安全写入 SQLite 的值（杜绝 undefined）
export function colValue(col: string, d: Record<string, unknown>): unknown {
  switch (col) {
    case 'product_name':
      return (d.product_name as string) ?? ''
    case 'broker':
      return (d.broker as string) || ''
    case 'contract_no':
      return (d.contract_no as string) || ''
    case 'underlying_code':
      return (d.underlying_code as string) || ''
    case 'notional':
      return Number(d.notional) || 0
    case 'initial_price':
      return Number(d.initial_price) || 0
    case 'knock_out_dates':
      return (d.knock_out_dates as string) || ''
    case 'knock_out_barriers':
      return (d.knock_out_barriers as string) || ''
    // 雪球新命名
    case 'trade_start_date':
      return (d.trade_start_date as string) || ''
    case 'knock_in_barrier':
      return Number(d.knock_in_barrier) || 0
    case 'knock_in_strike':
      return Number(d.knock_in_strike) || 100
    case 'margin_ratio':
      return Number(d.margin_ratio) || 0
    case 'maturity_coupon':
      return Number(d.maturity_coupon) || 0
    case 'termination_date':
      return (d.termination_date as string) || ''
    case 'termination_payoff':
      return Number(d.termination_payoff) || 0
    // 通用
    case 'knock_in_observation':
      return (d.knock_in_observation as string) || 'daily'
    case 'knock_in_participation':
      return Number(d.knock_in_participation) || 100
    case 'max_loss_pct':
      return Number(d.max_loss_pct) || 0
    case 'rebate_annual_pct':
      return Number(d.rebate_annual_pct) || 0
    case 'rebate_absolute_back_pct':
      return Number(d.rebate_absolute_back_pct) || 0
    case 'rebate_absolute_front_pct':
      return Number(d.rebate_absolute_front_pct) || 0
    case 'accrual_basis':
      return (d.accrual_basis as string) || 'both'
    case 'accrual_settle_tplus':
      return Number(d.accrual_settle_tplus) || 0
    case 'abs_fee_pct':
      return Number(d.abs_fee_pct) || 0
    case 'annual_fee_pct':
      return Number(d.annual_fee_pct) || 0
    case 'income_dividend_pct':
      return Number(d.income_dividend_pct) || 0
    case 'notes':
      return (d.notes as string) || ''
    case 'status':
      return (d.status as string) || 'active'
    case 'is_ki':
      return d.is_ki ? 1 : 0
    case 'knock_in_date':
      return (d.knock_in_date as string) || ''
    case 'knock_out_coupons':
      return (d.knock_out_coupons as string) || ''
    case 'knock_out_enhance_participation':
      return Number(d.knock_out_enhance_participation) || 0
    // 凤凰派息相关
    case 'coupon_barrier':
      return Number(d.coupon_barrier) || 0
    case 'coupon_dates':
      return (d.coupon_dates as string) || ''
    case 'coupon_rate':
      return Number(d.coupon_rate) || 0
    case 'coupon_received':
      return (d.coupon_received as string) || '[]'
    case 'coupon_payment_dates':
      return (d.coupon_payment_dates as string) || '[]'
    default:
      return ''
  }
}
