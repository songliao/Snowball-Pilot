/**
 * 持仓合约核心类型定义（渲染进程 / 主进程 IPC 共用）
 *
 * 注意：knock_in_barrier / max_loss_pct / coupon_barrier 等百分比/比例字段，
 * 在 DB 中存为小数（0.75=75%），表单中显示为百分比（75），提交时 ÷100 转换。
 * 详见 electron/database/schema.ts 的 colValue 映射。
 */

export interface PositionData {
  id?: number
  structure_type?: string // 'snowball' 雪球 | 'phoenix' 凤凰
  // 通用簿记
  contract_no?: string // 合约编号
  // 起息日（雪球/凤凰共用）
  trade_start_date?: string
  // 敲出参数（序列以 JSON 字符串存储）
  knock_out_dates?: string // 敲出观察日（日期序列）
  knock_out_barriers?: string // 敲出障碍价格（百分比序列）
  knock_out_coupons?: string // 雪球：敲出票息（百分比序列）
  knock_out_enhance_participation?: number // 雪球：敲出增强参与率
  maturity_coupon?: number // 雪球：到期票息
  // 敲入参数
  knock_in_observation?: string // 敲入观察方式（daily 每日 / maturity 到期）
  knock_in_barrier?: number // 敲入障碍比例（小数，0.75=75%）
  knock_in_strike?: number // 敲入执行价比例
  knock_in_participation?: number // 敲入参与率
  // 保证金与最大亏损
  margin_ratio?: number // 保证金比例（小数，0.2=20%）
  margin_rate?: number // 保证金比例（旧字段名，兼容历史数据）
  max_loss_pct?: number // 最大亏损（小数，0.25=25%）
  // 终止条款
  termination_date?: string // 了结（终止）日期
  termination_payoff?: number // 了结收益（绝对金额）
  // 返息信息
  rebate_annual_pct?: number // 年化后端返息（小数）
  rebate_absolute_back_pct?: number // 绝对后端返息（小数）
  rebate_absolute_front_pct?: number // 绝对前端返息（小数）
  // 计息规则
  accrual_basis?: string // 计息规则（both 双含 / one 单含）
  accrual_settle_tplus?: number // 计息结算T+
  // 费用
  abs_fee_pct?: number // 绝对费用（小数）
  annual_fee_pct?: number // 年化费用（小数）
  income_dividend_pct?: number // 收益分红（小数）
  // 凤凰派息
  coupon_barrier?: number // 派息障碍比例（小数，0.8=80%）
  coupon_dates?: string // 派息观察日（日期序列）
  coupon_rate?: number // 派息率（小数）
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
  is_ki?: boolean // 敲入状态（false=未敲入 true=已敲入）
  knock_in_date?: string // 敲入日期
  knock_in_pct?: number // 敲入比例（旧字段名，兼容历史数据）
  knock_in_strike_pct?: number // 敲入执行价比例（旧字段名）
  dividend_coupon?: number // 红利票息（旧字段名，兼容历史数据）
  interest_start_date?: string // 起息日（旧字段名，兼容历史数据）
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
  open?: number | null
  high?: number | null
  low?: number | null
  volume?: number | null
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
