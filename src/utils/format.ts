import dayjs from 'dayjs'

/**
 * 格式化金额（万元）
 */
export function formatMoney(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)} 万`
  }
  return value.toFixed(2)
}

/**
 * 格式化金额（完整显示）
 */
export function formatMoneyFull(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`
}

/**
 * 格式化日期
 */
export function formatDate(date: string, format = 'YYYY-MM-DD'): string {
  return dayjs(date).format(format)
}

/**
 * 格式化盈亏（带正负号和颜色标识）
 */
export function formatPnL(value: number): { text: string; color: string } {
  const sign = value > 0 ? '+' : ''
  const text = `${sign}${formatMoneyFull(value)}`
  const color = value > 0 ? '#52c41a' : value < 0 ? '#ff4d4f' : '#666'
  return { text, color }
}

/**
 * 状态标签映射
 */
export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '存续中', color: 'blue' },
  knocked_in: { label: '已敲入', color: 'orange' },
  knocked_out: { label: '已敲出', color: 'green' },
  matured: { label: '已到期', color: 'default' }
}

/**
 * 事件类型映射
 */
export const EVENT_TYPE_MAP: Record<string, { label: string; color: string }> = {
  knock_in: { label: '敲入', color: 'orange' },
  knock_out: { label: '敲出', color: 'green' },
  maturity: { label: '到期', color: 'blue' },
  dividend: { label: '分红', color: 'gold' },
  note: { label: '备注', color: 'default' }
}

/**
 * 观察频率映射
 */
export const FREQ_MAP: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季度'
}
