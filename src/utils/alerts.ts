import dayjs from 'dayjs'
import type { PositionData } from './calc'

export interface AlertReason {
  label: string
  tone: 'danger' | 'warn' | 'info'
  date?: string // 观察日期
  level?: number // 障碍点位
  gap?: number // 差距%：负=现价高于障碍，正=现价低于障碍
}

export interface AlertItem {
  id: number
  title: string
  code: string
  structureType: string
  cur: number
  reasons: AlertReason[]
}

// 预警判定参数（与 useAlertSettingsStore 保持一致）
export interface AlertConfig {
  knockOutLeadDays: number
  knockOutNearPct: number
  couponNearPct: number
  knockInNearPct: number
}

export function parseJsonArray<T>(s?: string): T[] {
  if (!s) return []
  try {
    const a = JSON.parse(s)
    return Array.isArray(a) ? (a as T[]) : []
  } catch {
    return []
  }
}

/**
 * 核心预警判定：基于合约障碍价与最新价的「距离百分比」(障碍价/现价 − 1) 来筛选。
 * - 敲出：gap = 敲出障碍价/现价 − 1，当 gap <= 敲出阈值 即预警（gap<0 表示已高于敲出线）
 * - 派息：gap = 派息障碍价/现价 − 1，当 gap <= 派息阈值 即预警
 * - 敲入：gap = 敲入障碍价/现价 − 1，当 gap >= −敲入阈值 即预警（gap>0 表示已跌破敲入线）
 * 该函数为纯函数，供总览页与设置页（实时预览）共用，保证口径一致。
 */
export function computeAlerts(
  positions: PositionData[],
  latestPrices: Record<string, number>,
  cfg: AlertConfig
): AlertItem[] {
  if (!positions.length || !Object.keys(latestPrices).length) return []
  const today = dayjs().startOf('day')
  const inN = today.add(cfg.knockOutLeadDays, 'day')
  const leadDays = cfg.knockOutLeadDays
  const result: AlertItem[] = []

  for (const p of positions) {
    if (p.status === 'knocked_out' || p.status === 'matured') continue
    const code = p.underlying_code
    if (!code) continue
    const cur = latestPrices[code]
    if (typeof cur !== 'number' || !cur) continue
    const initial = Number(p.initial_price) || 0
    if (!initial) continue
    const reasons: AlertItem['reasons'] = []

    // 1) N 天内有敲出观察，且现价距敲出障碍价的跌幅在阈值%以内（或已高于敲出线）
    const koDates = parseJsonArray<string>(p.knock_out_dates)
    const koBars = parseJsonArray<number>(p.knock_out_barriers)
    const koPairs = koDates
      .map((d, i) => ({ date: dayjs(d), bar: Number(koBars[i]) }))
      .filter((x) => x.date.isValid())
      .sort((a, b) => a.date.valueOf() - b.date.valueOf())
    const nextKo = koPairs.find((x) => !x.date.isBefore(today) && !x.date.isAfter(inN))
    if (nextKo) {
      const koPrice = (initial * nextKo.bar) / 100
      const koGap = (koPrice / cur - 1) * 100
      if (koGap <= cfg.knockOutNearPct) {
        reasons.push({
          label: koGap < 0 ? `${leadDays}日内敲出观察·已突破敲出线` : `${leadDays}日内敲出观察·临近敲出线`,
          tone: koGap < 0 ? 'danger' : 'warn',
          date: nextKo.date.format('YYYY-MM-DD'),
          level: koPrice,
          gap: koGap
        })
      }
    }

    // 2) N 天内有派息观察，且现价距派息障碍价的跌幅在阈值%以内（或已站上派息线）
    const cpDates = parseJsonArray<string>(p.coupon_dates)
    const cpNext = cpDates
      .map((d) => dayjs(d))
      .filter((d) => d.isValid() && !d.isBefore(today) && !d.isAfter(inN))[0]
    if (cpNext && typeof p.coupon_barrier === 'number' && p.coupon_barrier > 0) {
      const cpPrice = initial * p.coupon_barrier
      const cpGap = (cpPrice / cur - 1) * 100
      if (cpGap <= cfg.couponNearPct) {
        reasons.push({
          label: cpGap < 0 ? `${leadDays}日内派息观察·已站上派息线` : `${leadDays}日内派息观察·临近派息线`,
          tone: 'info',
          date: cpNext.format('YYYY-MM-DD'),
          level: cpPrice,
          gap: cpGap
        })
      }
    }

    // 3) 现价距敲入障碍价的涨幅在阈值%以内（含已跌破敲入线）
    if (typeof p.knock_in_barrier === 'number' && p.knock_in_barrier > 0) {
      const kiPrice = initial * p.knock_in_barrier
      const kiGap = (kiPrice / cur - 1) * 100
      if (kiGap >= -cfg.knockInNearPct) {
        let kiDate = ''
        if (p.knock_in_observation === 'daily') {
          kiDate = '每日观察'
        } else if (p.knock_in_observation === 'maturity') {
          const allKo = parseJsonArray<string>(p.knock_out_dates)
            .map((d) => dayjs(d))
            .filter((d) => d.isValid())
          if (allKo.length) {
            kiDate = allKo.sort((a, b) => a.valueOf() - b.valueOf())[allKo.length - 1].format('YYYY-MM-DD')
          }
        }
        reasons.push({
          label: kiGap > 0 ? '已跌破敲入线' : '逼近敲入线',
          tone: 'danger',
          date: kiDate,
          level: kiPrice,
          gap: kiGap
        })
      }
    }

    if (reasons.length) {
      result.push({
        id: p.id!,
        title: p.product_name || p.contract_no || '未命名合约',
        code: code || '',
        structureType: p.structure_type || 'snowball',
        cur,
        reasons
      })
    }
  }
  return result
}
