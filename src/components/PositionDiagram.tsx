import { useMemo, useRef, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import { useThemeStore } from '../stores/themeStore'
import type { PositionData, PriceData } from '../utils/calc'

function parseNumArray(s?: string): number[] {
  if (!s) return []
  try {
    const a = JSON.parse(s)
    return Array.isArray(a) ? (a as number[]).filter((n) => typeof n === 'number') : []
  } catch {
    return []
  }
}
function parseDateArray(s?: string): string[] {
  if (!s) return []
  try {
    const a = JSON.parse(s)
    return Array.isArray(a) ? (a as string[]) : []
  } catch {
    return []
  }
}

interface Props {
  pos: PositionData
  currentPrice?: number
  priceHistory?: PriceData[]
}

/**
 * 合约实时点位图示：横轴覆盖全部结构观察日（起息日 → 最后一个敲出/派息观察日，含当前日期），
 * 结构示意图（敲出/派息观察点、参考线、日期辅助线）始终完整展示。
 * 已敲出/到期了结的合约，仅「行情历史曲线」绘制到「了结日」为止（不再延伸到当前、不标注当前点位），
 * 其余结构示意图不受影响。
 * 纵轴为价格点位，标注期初价、敲入/敲出/派息障碍价，并用一个点表示当前日期与现价。
 */
export default function PositionDiagram({ pos, currentPrice, priceHistory }: Props) {
  const chartRef = useRef<any>(null)
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const isDark = useThemeStore((s) => s.mode === 'dark')

  const option = useMemo(() => {
    const initialPrice = pos.initial_price
    const kiPct = pos.knock_in_barrier
    const kiPrice = initialPrice != null && kiPct != null ? initialPrice * kiPct : null
    const kiObserveMode = pos.knock_in_observation // 'daily' 每日 / 'maturity' 仅到期观察
    const koBarriers = parseNumArray(pos.knock_out_barriers)
    const koDates = parseDateArray(pos.knock_out_dates)
      .map((d) => dayjs(d))
      .filter((d) => d.isValid())
      .sort((a, b) => a.valueOf() - b.valueOf())
    const cpDates = parseDateArray(pos.coupon_dates)
      .map((d) => dayjs(d))
      .filter((d) => d.isValid())
      .sort((a, b) => a.valueOf() - b.valueOf())
    const lastKoBarrier = koBarriers.length ? koBarriers[koBarriers.length - 1] : null
    const koPrice = initialPrice != null && lastKoBarrier != null ? initialPrice * (lastKoBarrier / 100) : null
    const koColor = '#22c55e'
    const KO_PALETTE = ['#14532d', '#84cc16', '#15803d', '#a3e635', '#0d9488', '#bef264', '#166534']
    // 敲出观察散点：每个观察日对应一个敲出障碍价，并按对应票息着色
    const koCoupons = parseNumArray(pos.knock_out_coupons)
    const koRaw: { date: number; price: number; coupon?: number }[] = []
    if (initialPrice != null && koDates.length > 0 && koBarriers.length > 0) {
      koDates.forEach((d, i) => {
        const b = koBarriers[i] ?? lastKoBarrier
        if (typeof b === 'number') {
          koRaw.push({ date: d.valueOf(), price: initialPrice * (b / 100), coupon: koCoupons[i] })
        }
      })
    }
    const distinctCoupons = Array.from(new Set(koRaw.map((p) => p.coupon).filter((v) => typeof v === 'number')))
    const allSameCoupon = distinctCoupons.length <= 1
    const couponColor = new Map<number, string>()
    distinctCoupons.forEach((c, idx) => couponColor.set(c, KO_PALETTE[idx % KO_PALETTE.length]))
    const koPoints = koRaw.map((p) => ({
      value: [p.date, p.price] as [number, number],
      coupon: p.coupon,
      itemStyle: {
        color: allSameCoupon ? koColor : p.coupon != null ? couponColor.get(p.coupon)! : koColor,
        borderColor: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)',
        borderWidth: 1.5
      }
    }))
    const cpPct = pos.coupon_barrier
    const cpPrice =
      pos.structure_type === 'phoenix' && initialPrice != null && cpPct != null
        ? initialPrice * cpPct
        : null
    // 派息观察点：每个派息观察日对应一个派息障碍价
    const cpPoints =
      cpPrice != null && cpDates.length > 0
        ? cpDates.map((d) => ({ value: [d.valueOf(), cpPrice] as [number, number] }))
        : []

    const start =
      pos.trade_start_date && dayjs(pos.trade_start_date).isValid()
        ? dayjs(pos.trade_start_date)
        : koDates.length
        ? koDates[0]
        : cpDates.length
        ? cpDates[0]
        : dayjs()
    const koLastDate = koDates.length ? koDates[koDates.length - 1] : dayjs()
    const cpLastDate = cpDates.length ? cpDates[cpDates.length - 1] : dayjs()
    const today = dayjs()
    // 已敲出/到期了结的合约：行情历史曲线仅绘制到「敲出/了结日」为止；
    // 但结构示意图（观察点/参考线）仍完整展示，故横轴不截断
    const settled = pos.status === 'knocked_out' || pos.status === 'matured'
    const terminationDate = pos.termination_date ? dayjs(pos.termination_date) : null
    const settledEnd = settled && terminationDate && terminationDate.isValid() ? terminationDate : null
    // 横轴严格覆盖合约全周期：期初（起息日）→ 期末（最后一个敲出/派息观察日）；
    // 不延伸到「今天」之后，确保结构示意图从期初到期末完整展示
    const axisEndCandidates: dayjs.Dayjs[] = []
    if (koDates.length) axisEndCandidates.push(koLastDate)
    if (cpDates.length) axisEndCandidates.push(cpLastDate)
    const axisEnd = axisEndCandidates.length
      ? axisEndCandidates.reduce((m, d) => (d.isAfter(m) ? d : m), axisEndCandidates[0])
      : today

    // 历史价格路径：起息日 → 今天（已了结则终止于了结日）
    const historyPoints: [number, number][] = []
    if (priceHistory && priceHistory.length > 0) {
      const startTs = start.valueOf()
      const endTs = (settledEnd ?? today).valueOf()
      priceHistory
        .filter((p) => {
          if (p.price == null) return false
          const ts = dayjs(p.date)
          return ts.isValid() && ts.valueOf() >= startTs && ts.valueOf() <= endTs
        })
        .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf())
        .forEach((p) => {
          historyPoints.push([dayjs(p.date).valueOf(), p.price])
        })
    }

    const refPoints = [initialPrice, kiPrice, cpPrice, currentPrice].filter(
      (v): v is number => typeof v === 'number'
    )
    const allY = [...refPoints, ...koPoints.map((p) => (p.value[1] as number)), ...cpPoints.map((p) => (p.value[1] as number)), ...historyPoints.map((p) => p[1])]
    const yMinRaw = allY.length ? Math.min(...allY) : 0
    const yMaxRaw = allY.length ? Math.max(...allY) : 1
    // 按数据跨度动态留白，至少各留 2%，避免贴边
    const pad = Math.max((yMaxRaw - yMinRaw) * 0.08, yMaxRaw * 0.02, 1)
    // 端点取整，避免纵轴首尾出现非整数刻度
    const yMin = Math.floor(yMinRaw - pad)
    const yMax = Math.ceil(yMaxRaw + pad)

    const lines: { name: string; value: number; color: string; type?: 'solid' | 'dashed' }[] = []
    if (initialPrice != null) lines.push({ name: '期初价格', value: initialPrice, color: '#38bdf8' })
    // 敲入障碍：每日观察→实线；仅到期观察→虚线（并在到期日用红圈标记）
    if (kiPrice != null) {
      const kiLineType = kiObserveMode === 'maturity' ? 'dashed' : 'solid'
      lines.push({ name: '敲入障碍', value: kiPrice, color: '#ef4444', type: kiLineType })
    }
    // 派息障碍：有派息观察日时用散点+橙虚线表示；无观察日时退回水平虚线
    if (cpPrice != null && cpDates.length === 0) {
      lines.push({ name: '派息障碍', value: cpPrice, color: '#f97316' })
    }
    // 敲出障碍：有观察日时用散点+绿虚线表示；无观察日时退回水平虚线
    if (koPrice != null && koPoints.length === 0) {
      lines.push({ name: '敲出障碍', value: koPrice, color: koColor })
    }

    const axisColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
    const splitColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
    const textColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'

    // 已了结合约不再标注「当前」点位（图已终止于了结日）
    const currentPoint = !settledEnd && currentPrice != null ? [{ value: [today.valueOf(), currentPrice] }] : []
    // 已了结合约：在行情曲线终点（了结日）放置一个带图例的标记点
    const settledEndPoint =
      settledEnd && historyPoints.length > 0
        ? [{ value: [settledEnd.valueOf(), historyPoints[historyPoints.length - 1][1]] }]
        : []

    // 各参考线改为独立 series：图上不显示文字，统一由 legend 标识
    const refSeries = lines.map((l) => ({
      name: l.name,
      type: 'line' as const,
      data: [] as any[],
      showSymbol: false,
      lineStyle: { opacity: 0 },
      itemStyle: { color: l.color },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        data: [
          {
            yAxis: l.value,
            lineStyle: { color: l.color, type: (l.type ?? 'dashed') as 'solid' | 'dashed', width: 1.5 }
          }
        ]
      },
      tooltip: { show: false },
      z: 1
    }))

    // 竖直日期辅助线（起息 / 到期观察），不进入 legend
    const guideSeries = {
      type: 'line' as const,
      data: [] as any[],
      showSymbol: false,
      lineStyle: { opacity: 0 },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          {
            xAxis: start.valueOf(),
            lineStyle: { color: axisColor, type: 'dotted' as const, width: 1 },
            label: { show: false }
          },
          {
            xAxis: koLastDate.valueOf(),
            lineStyle: { color: axisColor, type: 'dotted' as const, width: 1 },
            label: { show: false }
          }
        ]
      },
      tooltip: { show: false },
      z: 1
    }

    // 仅到期观察的敲入：在到期观察日用红色圆圈标记
    const kiScatter =
      kiPrice != null && kiObserveMode === 'maturity'
        ? {
            name: '敲入障碍',
            type: 'scatter' as const,
            data: [{ value: [koLastDate.valueOf(), kiPrice] }],
            symbolSize: 14,
            itemStyle: {
              color: '#ef4444',
              borderColor: isDark ? '#fecaca' : '#991b1b',
              borderWidth: 1.5
            },
            label: { show: false },
            tooltip: {
              show: true,
              formatter: () =>
                `敲入观察（到期）<br/>${koLastDate.format('YYYY-MM-DD')}<br/>障碍价 ${Number(kiPrice).toFixed(2)}`
            },
            z: 7
          }
        : null

    // 敲出观察：票息一致→单一系列；不一致→连接线 + 每个票息一组（图例按票息区分）
    const koTooltip = (p: any) => {
      const c = p.data?.coupon
      const couponStr = typeof c === 'number' ? `<br/>票息 ${Number(c).toFixed(2)}%` : ''
      return `敲出观察<br/>${dayjs(p.value[0]).format('YYYY-MM-DD')}<br/>障碍价 ${Number(p.value[1]).toFixed(2)}${couponStr}`
    }
    const koSeries: any[] = []
    if (koPoints.length > 0) {
      if (allSameCoupon) {
        koSeries.push({
          name: '敲出观察',
          type: 'line',
          data: koPoints,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 11,
          lineStyle: { color: koColor, type: 'dashed', width: 2 },
          itemStyle: { borderWidth: 1.5 },
          label: { show: false },
          tooltip: { show: true, formatter: koTooltip },
          z: 4
        })
      } else {
        // 连接线（不进图例，置于圆圈之下）
        koSeries.push({
          name: '敲出连线',
          type: 'line',
          data: koPoints.map((p) => p.value),
          showSymbol: false,
          lineStyle: { color: koColor, type: 'dashed', width: 2 },
          tooltip: { show: false },
          z: 1
        })
        // 每个票息一组散点，各自入图例
        distinctCoupons.forEach((c) => {
          const color = couponColor.get(c)!
          const pts = koRaw
            .filter((p) => p.coupon === c)
            .map((p) => ({ value: [p.date, p.price], coupon: c }))
          koSeries.push({
            name: `票息 ${Number(c).toFixed(2)}%`,
            type: 'scatter',
            data: pts,
            symbolSize: 11,
            itemStyle: {
              color,
              borderColor: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)',
              borderWidth: 1.5
            },
            label: { show: false },
            tooltip: { show: true, formatter: koTooltip },
            z: 5
          })
        })
      }
    }

    // 派息观察：橙色散点 + 橙色虚线连接（类似敲出观察）
    const cpColor = '#f97316'
    const cpSeries: any[] = []
    if (cpPoints.length > 0) {
      cpSeries.push({
        name: '派息观察',
        type: 'line',
        data: cpPoints,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 10,
        lineStyle: { color: cpColor, type: 'dashed', width: 2 },
        itemStyle: {
          color: cpColor,
          borderColor: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)',
          borderWidth: 1.5
        },
        label: { show: false },
        tooltip: {
          show: true,
          formatter: (p: any) =>
            `派息观察<br/>${dayjs(p.value[0]).format('YYYY-MM-DD')}<br/>障碍价 ${Number(p.value[1]).toFixed(2)}`
        },
        z: 4
      })
    }

    const legendNames: string[] = [...lines.map((l) => l.name)]
    if (historyPoints.length > 0) legendNames.push('历史价格')
    if (koPoints.length > 0) {
      if (allSameCoupon) legendNames.push('敲出观察')
      else distinctCoupons.forEach((c) => legendNames.push(`票息 ${Number(c).toFixed(2)}%`))
    }
    if (cpPoints.length > 0) legendNames.push('派息观察')
    if (currentPoint.length > 0) legendNames.push('当前')
    if (settledEndPoint.length > 0) legendNames.push('了结日')

    return {
      backgroundColor: 'transparent',
      grid: { left: 64, right: 24, top: 44, bottom: 36 },
      legend: {
        data: legendNames,
        top: 4,
        left: 0,
        itemWidth: 16,
        itemHeight: 8,
        itemGap: 18,
        icon: 'roundRect',
        textStyle: { color: textColor, fontSize: 11 }
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? 'rgba(20,20,28,0.92)' : 'rgba(255,255,255,0.96)',
        borderColor: splitColor,
        textStyle: { color: textColor }
      },
      xAxis: {
        type: 'time',
        min: start.valueOf(),
        max: axisEnd.valueOf(),
        axisLine: { lineStyle: { color: axisColor } },
        axisLabel: { color: textColor, fontSize: 11 },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: yMin,
        max: yMax,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: textColor,
          fontSize: 11,
          formatter: (v: number) =>
            Number.isInteger(v) ? v.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : ''
        },
        splitLine: { lineStyle: { color: splitColor } }
      },
      series: [
        ...refSeries,
        ...(kiScatter ? [kiScatter] : []),
        guideSeries,
        ...koSeries,
        ...cpSeries,
        ...(historyPoints.length > 0
          ? [
              {
                name: '历史价格',
                type: 'line' as const,
                data: historyPoints,
                showSymbol: false,
                smooth: false,
                lineStyle: { color: '#818cf8', width: 2 },
                itemStyle: { color: '#818cf8' },
                tooltip: {
                  show: true,
                  formatter: (p: any) =>
                    `历史价格<br/>${dayjs(p.value[0]).format('YYYY-MM-DD')}<br/>点位 ${Number(p.value[1]).toFixed(2)}`
                },
                z: 2
              }
            ]
          : []),
        {
          name: '了结日',
          type: 'scatter',
          data: settledEndPoint,
          symbol: 'circle',
          symbolSize: 13,
          itemStyle: {
            color: '#f97316',
            borderColor: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.25)',
            borderWidth: 1
          },
          markLine: settledEndPoint.length
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#f97316', type: 'dashed', width: 1, opacity: 0.85 },
                label: { show: false },
                data: [
                  { xAxis: settledEnd!.valueOf() },
                  { yAxis: (settledEndPoint[0].value as number[])[1] }
                ]
              }
            : undefined,
          tooltip: {
            show: true,
            formatter: () =>
              `了结日<br/>${settledEnd!.format('YYYY-MM-DD')}<br/>点位 ${Number(settledEndPoint[0].value[1]).toFixed(2)}`
          },
          label: { show: false },
          z: 8
        },
        {
          name: '当前',
          type: 'scatter',
          data: currentPoint,
          symbolSize: 9,
          itemStyle: {
            color: '#facc15',
            borderColor: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.25)',
            borderWidth: 1
          },
          markLine: currentPoint.length
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.85 },
                label: { show: false },
                data: [{ xAxis: today.valueOf() }, { yAxis: currentPrice }]
              }
            : undefined,
          tooltip: {
            show: true,
            formatter: () =>
              `当前<br/>${dayjs(today.valueOf()).format('YYYY-MM-DD')}<br/>点位 ${Number(currentPrice).toFixed(2)}`
          },
          label: { show: false },
          z: 6
        }
      ]
    }
  }, [pos, currentPrice, isDark, priceHistory])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>
        {pos.product_name || pos.contract_no || '合约'} · 实时点位图示
      </span>
      <div className="glass-card" ref={chartWrapRef} style={{ padding: 12 }}>
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: 480, width: '100%' }}
          notMerge
          onChartReady={(inst: any) => {
            const wrap = chartWrapRef.current
            if (wrap && typeof ResizeObserver !== 'undefined') {
              const ro = new ResizeObserver(() => inst.resize())
              ro.observe(wrap)
            }
            // 兜底：首次布局/翻转可能尚未稳定，延迟重测确保尺寸正确
            requestAnimationFrame(() => inst.resize())
            setTimeout(() => inst.resize(), 120)
            // 覆盖翻转过渡结束（0.55s）后的最终尺寸
            setTimeout(() => inst.resize(), 650)
          }}
        />
      </div>
      {currentPrice == null && (
        <div style={{ fontSize: 12, opacity: 0.5 }}>当前无实时价格，未标注当前点位。</div>
      )}
    </div>
  )
}
