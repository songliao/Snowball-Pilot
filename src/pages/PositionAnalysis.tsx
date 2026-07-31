import { useMemo, Component, useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Select, Segmented, Button, Popover, Switch } from 'antd'
import { ClockCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import { useThemeStore } from '../stores/themeStore'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { type PositionData, estimateExpectedProfit, computeKnockOutProfit } from '../utils/calc'
import { formatMoney } from '../utils/format'

const STRUCTURES: Record<string, string> = {
  snowball: '雪球',
  phoenix: '凤凰'
}
function structureLabel(t?: string): string {
  return (t && STRUCTURES[t]) || t || '未知结构'
}

/** 存续合约 */
function isActive(p: PositionData): boolean {
  return p.status === 'active'
}

/** 将对象按 key 聚合名义本金 */
function aggregateBy(
  positions: PositionData[],
  keyFn: (p: PositionData) => string
): { name: string; value: number }[] {
  const map = new Map<string, number>()
  for (const p of positions) {
    const name = keyFn(p)
    map.set(name, (map.get(name) || 0) + (p.notional || 0))
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

const PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#4e79a7'
]

// 结构类型卡片专用调色板：暖紫系，刻意区别于标的卡片的多彩蓝绿调
const STRUCTURE_PALETTE = [
  '#b07cff', '#ff8f3c', '#ff5d8f', '#c08457', '#a855f7',
  '#e8732b', '#d946a6', '#8b5cf6', '#f472b6', '#7c3aed'
]

// 结构散点配色：与“按结构类型名义本金”环形图（STRUCTURE_PALETTE 前两项）保持一致
const STRUCTURE_COLOR: Record<string, string> = {
  snowball: '#b07cff',
  phoenix: '#ff8f3c'
}

/** 解析 JSON 数组字段（兼容字符串或已解析数组），返回数值数组 */
function parseArr(raw?: string | number[]): number[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(arr)) return arr.map(Number).filter((n) => !Number.isNaN(n))
  } catch {
    // 解析失败时返回空
  }
  return []
}

/** 解析“敲出障碍序列”（JSON 百分比数组），返回首个（最近观察日）障碍百分比 */
function firstBarrierPct(p: PositionData): number | null {
  const arr = parseArr(p.knock_out_barriers)
  return arr.length > 0 ? arr[0] : null
}

/**
 * 散点/三角形的预期收益估算：
 * - 敲出预期收益（圆形，雪球与凤凰）：与持仓详情页 koProfit 完全一致，
 *   取“今天及之后最近的敲出观察日”的票息率，经完整计息/返息/费用计算。
 * - 派息预期收益（三角形，凤凰）：名义本金 × 派息率 ×（1 - 收益分红）。
 */
function knockOutProfitOf(p: PositionData): number {
  try {
    const koDates = p.knock_out_dates ? (JSON.parse(p.knock_out_dates) as string[]) : []
    const koCoupons = p.knock_out_coupons ? (JSON.parse(p.knock_out_coupons) as number[]) : []
    const today = dayjs().startOf('day')
    let idx = -1
    let diff = Infinity
    koDates.forEach((d, i) => {
      const date = dayjs(d).startOf('day')
      if (date.isBefore(today)) return
      const dd = date.diff(today, 'day')
      if (dd < diff) {
        diff = dd
        idx = i
      }
    })
    if (idx < 0 || !p.notional) return 0
    const r = computeKnockOutProfit({
      notional: p.notional,
      couponPct: koCoupons[idx] ?? 0,
      tradeStartDate: p.trade_start_date,
      koObservationDate: dayjs(koDates[idx]).format('YYYY-MM-DD'),
      accrualBasis: p.accrual_basis,
      accrualSettleTplus: p.accrual_settle_tplus,
      rebateAnnualPct: p.rebate_annual_pct,
      rebateAbsFrontPct: p.rebate_absolute_front_pct,
      rebateAbsBackPct: p.rebate_absolute_back_pct,
      absFeePct: p.abs_fee_pct,
      annualFeePct: p.annual_fee_pct,
      incomeDividendPct: p.income_dividend_pct
    })
    return r ? Math.max(0, r.net) : 0
  } catch {
    return 0
  }
}

function estProfit(p: PositionData): number {
  return estimateExpectedProfit(p) ?? 0
}

/**
 * 散点图示卡片：
 * - 横轴：标的点位（可切换为相对最新价的百分比）
 * - 纵轴：名义本金 / 预期收益
 * - 红色垂直虚线：当前最新价点位
 * - 散点：各存续合约的“最近敲出障碍价格”与名义本金/预期收益，按结构类型着色
 */
function ScatterCard({
  positions,
  latestPrices,
  isDark,
  navigate
}: {
  positions: PositionData[]
  latestPrices: Record<string, number>
  isDark: boolean
  navigate: (path: string) => void
}) {
  const [code, setCode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('positionAnalysis.code')
      if (saved) return saved
    } catch {
      /* ignore */
    }
    const set = new Set<string>()
    positions.forEach((p) => p.underlying_code && set.add(p.underlying_code))
    return Array.from(set).sort()[0] ?? '__all__'
  })
  const [xMode, setXMode] = useState<'point' | 'pct'>(() => {
    try {
      const saved = localStorage.getItem('positionAnalysis.xMode')
      if (saved === 'point' || saved === 'pct') return saved
    } catch {
      /* ignore */
    }
    return 'point'
  })
  // 悬停某图形时，按持仓 id 关联高亮（同合约的散点/柱状图/三角形），其余淡化
  const [hoverId, setHoverId] = useState<number | string | null>(null)

  // 实时行情刷新：手动刷新 + 自动刷新（倒计时）
  const { fetchBatchLatest } = useMarketStore()
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [intervalSec, setIntervalSec] = useState(30)
  const [remaining, setRemaining] = useState(30)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const autoSettingsKey = 'positionAnalysis.autoRefresh'

  // 持久化横轴模式与选中标的，返回时恢复页面状态
  useEffect(() => {
    try {
      localStorage.setItem('positionAnalysis.xMode', xMode)
    } catch {
      /* ignore */
    }
  }, [xMode])
  useEffect(() => {
    try {
      localStorage.setItem('positionAnalysis.code', code)
    } catch {
      /* ignore */
    }
  }, [code])
  // 持仓加载完成后，若已保存的标的已不存在则回退到第一个
  useEffect(() => {
    const set = new Set<string>()
    positions.forEach((p) => p.underlying_code && set.add(p.underlying_code))
    const first = Array.from(set).sort()[0] ?? '__all__'
    if (code !== '__all__' && !set.has(code) && set.size > 0) {
      setCode(first)
    }
  }, [positions])

  const refreshQuotes = useCallback(async () => {
    if (!code || code === '__all__') return
    setQuoteLoading(true)
    try {
      await fetchBatchLatest([code])
    } finally {
      setQuoteLoading(false)
    }
  }, [code, fetchBatchLatest])

  // 读取持久化的自动刷新设置
  useEffect(() => {
    try {
      const saved = localStorage.getItem(autoSettingsKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.autoRefresh === 'boolean') setAutoRefresh(parsed.autoRefresh)
        if (typeof parsed.intervalSec === 'number' && parsed.intervalSec >= 10) {
          setIntervalSec(parsed.intervalSec)
        }
      }
    } catch {
      /* ignore */
    }
  }, [autoSettingsKey])
  useEffect(() => {
    try {
      localStorage.setItem(autoSettingsKey, JSON.stringify({ autoRefresh, intervalSec }))
    } catch {
      /* ignore */
    }
  }, [autoRefresh, intervalSec, autoSettingsKey])

  // 用 ref 持有最新回调与间隔，避免倒计时定时器频繁重建
  const refreshRef = useRef(refreshQuotes)
  useEffect(() => {
    refreshRef.current = refreshQuotes
  }, [refreshQuotes])
  const intervalRef = useRef(intervalSec)
  useEffect(() => {
    intervalRef.current = intervalSec
  }, [intervalSec])

  // 倒计时与自动刷新：每秒递减，归零时触发刷新并重新计时
  useEffect(() => {
    if (!autoRefresh) {
      setRemaining(intervalSec)
      return
    }
    setRemaining(intervalSec)
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          refreshRef.current()
          return intervalRef.current
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, intervalSec])

  // 可筛选的标的（存续合约标的去重）
  const codeOptions = useMemo(() => {
    const set = new Set<string>()
    positions.forEach((p) => p.underlying_code && set.add(p.underlying_code))
    return Array.from(set).sort()
  }, [positions])

  // 选中标的对应的最新价
  const selectedLatest = code === '__all__' ? null : latestPrices[code]

  // 构建散点数据：每个存续合约一个点
  const seriesData = useMemo(() => {
    const list = positions.filter((p) => (code === '__all__' ? true : p.underlying_code === code))
    const byStruct: Record<string, { name: string; value: [number, number, number, number] }[]> = {
      snowball: [],
      phoenix: []
    }
    for (const p of list) {
      // 散点（圆形）统一表示“敲出”：雪球与凤凰均取最近敲出障碍比例（百分比数值，如100.5）
      const pct = firstBarrierPct(p)
      if (pct == null || Number.isNaN(pct)) continue
      const koPrice = (p.initial_price || 0) * (pct / 100)
      const latest = latestPrices[p.underlying_code ?? ''] ?? (p.initial_price || 0)
      const x = xMode === 'point' ? koPrice : (latest ? (koPrice / latest) * 100 : koPrice)
      const y = p.notional || 0
      const struct = p.structure_type === 'phoenix' ? 'phoenix' : 'snowball'
      // 雪球散点圆：敲出净收益（与详情页一致）；凤凰散点圆：派息口径
      const profit = struct === 'snowball' ? knockOutProfitOf(p) : estProfit(p)
      const isActive = hoverId != null && String(hoverId) === String(p.id)
      const dim = hoverId != null && !isActive
      byStruct[struct].push({
        name: `${p.underlying_code} · ${structureLabel(p.structure_type)}`,
        value: [Number(x.toFixed(2)), Number(y.toFixed(2)), profit, Number((p.notional || 0).toFixed(2))],
        id: p.id,
        structure_type: p.structure_type,
        itemStyle: dim
          ? { opacity: 0.12 }
          : isActive
            ? { opacity: 0.95, shadowBlur: 16, shadowColor: STRUCTURE_COLOR[struct] }
            : { opacity: 0.85 }
      })
    }
    return byStruct
  }, [positions, code, xMode, latestPrices, hoverId, isDark])

  // 凤凰敲出位置（三角形）：横轴=敲出障碍位置，高度=名义本金，大小=派息的预期收益金额
  const phoenixKoData = useMemo(() => {
    const list = positions.filter(
      (p) => (code === '__all__' ? true : p.underlying_code === code) && p.structure_type === 'phoenix'
    )
    const arr: { name: string; value: [number, number, number, number] }[] = []
    for (const p of list) {
      // 三角形（凤凰派息）：横轴 = 派息障碍（小数比例，如 0.75，直接乘）
      const pct = p.coupon_barrier != null ? Number(p.coupon_barrier) : null
      if (pct == null || Number.isNaN(pct)) continue
      const koPrice = (p.initial_price || 0) * pct
      const latest = latestPrices[p.underlying_code ?? ''] ?? (p.initial_price || 0)
      const x = xMode === 'point' ? koPrice : (latest ? (koPrice / latest) * 100 : koPrice)
      const y = p.notional || 0
      const couponProfit = Math.max(0, estProfit(p)) // 派息预期收益金额
      const isActive = hoverId != null && String(hoverId) === String(p.id)
      const dim = hoverId != null && !isActive
      arr.push({
        name: `${p.underlying_code} · 凤凰`,
        value: [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(couponProfit.toFixed(2)), Number(y.toFixed(2))],
        id: p.id,
        structure_type: p.structure_type,
        itemStyle: dim
          ? { opacity: 0.12 }
          : isActive
            ? { opacity: 0.95, shadowBlur: 16, shadowColor: STRUCTURE_COLOR.phoenix }
            : { opacity: 0.9 }
      })
    }
    return arr
  }, [positions, code, xMode, latestPrices, hoverId, isDark])

  // 圆/三角形面积 = 预期收益（面积 ∝ 值，故半径 ∝ √值），圆与三角共享同一最大值尺度
  const maxSize = useMemo(() => {
    const vals = [
      ...seriesData.snowball.map((d) => d.value[2]),
      ...seriesData.phoenix.map((d) => d.value[2]),
      ...phoenixKoData.map((d) => d.value[2])
    ]
    return Math.max(1, ...vals)
  }, [seriesData, phoenixKoData])

  // 敲入障碍价格柱状图：横轴=敲入障碍价（小数比例直接乘），柱高=名义本金×最大亏损，按结构着色
  const barData = useMemo(() => {
    const list = positions.filter((p) => (code === '__all__' ? true : p.underlying_code === code))
    const byStruct: Record<string, { name: string; value: [number, number] }[]> = {
      snowball: [],
      phoenix: []
    }
    for (const p of list) {
      const ki = Number(p.knock_in_barrier)
      if (!ki || Number.isNaN(ki)) continue
      const kiPrice = (p.initial_price || 0) * ki // 小数比例（如 0.75）直接乘
      const latest = latestPrices[p.underlying_code ?? ''] ?? (p.initial_price || 0)
      const x = xMode === 'point' ? kiPrice : (latest ? (kiPrice / latest) * 100 : kiPrice)
      // 柱高 = 名义本金 × 最大亏损（max_loss_pct 为小数比例，如 0.25，直接乘）
      const maxLoss = (p.notional || 0) * (Number(p.max_loss_pct) || 0)
      const struct = p.structure_type === 'phoenix' ? 'phoenix' : 'snowball'
      const isActive = hoverId != null && String(hoverId) === String(p.id)
      const dim = hoverId != null && !isActive
      byStruct[struct].push({
        name: `${p.underlying_code} · ${structureLabel(p.structure_type)}`,
        value: [Number(x.toFixed(2)), Number(maxLoss.toFixed(2))],
        id: p.id,
        structure_type: p.structure_type,
        itemStyle: dim
          ? { opacity: 0.12 }
          : isActive
            ? { opacity: 1, borderColor: STRUCTURE_COLOR[struct], borderWidth: 2, shadowBlur: 14, shadowColor: STRUCTURE_COLOR[struct] }
            : { opacity: 1, borderWidth: 0 }
      })
    }
    return byStruct
  }, [positions, code, xMode, latestPrices, hoverId, isDark])

  // 红色垂直虚线位置（当前点位）
  const markX = useMemo(() => {
    if (code !== '__all__') {
      const latest = latestPrices[code]
      if (typeof latest === 'number') return xMode === 'point' ? latest : 100
    }
    // 全部标的时：若有统一基准价则画，否则不画
    return null
  }, [code, xMode, latestPrices])

  const axisColor = isDark ? '#e6edf3' : '#1e1e22'
  const subColor = isDark ? 'rgba(230,237,243,0.55)' : 'rgba(30,30,34,0.5)'
  const splitColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  const option = useMemo(() => {
    // 逐点的 itemStyle / symbolSize 已在 seriesData / phoenixKoData / barData 中按 hoverId 计算，
    // 此处系列级仅提供颜色，具体淡化/高亮/放大/发光由数据点自身控制。
    // 散点/三角形大小：基础随预期收益缩放；悬停同合约时再放大 1.25
    const sizeOf = (val: any, params: any) => {
      const v = Math.max(0, (val && val[2]) || 0)
      const base = 8 + 34 * Math.sqrt(v / maxSize)
      const isActive = hoverId != null && params?.data && String(hoverId) === String(params.data.id)
      return isActive ? base * 1.25 : base
    }
    const makeSeries = (struct: 'snowball' | 'phoenix') => ({
      name: structureLabel(struct),
      type: 'scatter' as const,
      z: 2,
      symbolSize: (val: any, params: any) => sizeOf(val, params),
      itemStyle: { color: STRUCTURE_COLOR[struct] },
      data: seriesData[struct],
      markLine:
        markX != null && struct === 'snowball'
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#ee6666', type: 'dashed' as const, width: 1.5 },
              label: { show: false },
              data: [{ xAxis: markX }]
            }
          : undefined
    })
    const makeBar = (struct: 'snowball' | 'phoenix') => ({
      name: structureLabel(struct),
      type: 'bar' as const,
      z: 1,
      barWidth: 8,
      itemStyle: { color: STRUCTURE_COLOR[struct] },
      data: barData[struct]
    })
    const makeTriangle = () => ({
      name: '凤凰派息',
      type: 'scatter' as const,
      z: 2,
      symbol: 'path://M58.5 14.5 L85.5 41.5 Q94 50 85.5 58.5 L58.5 85.5 Q50 94 41.5 85.5 L14.5 58.5 Q6 50 14.5 41.5 L41.5 14.5 Q50 6 58.5 14.5 Z',
      symbolSize: (val: any, params: any) => sizeOf(val, params),
      itemStyle: { color: STRUCTURE_COLOR.phoenix },
      data: phoenixKoData
    })
    return {
      backgroundColor: 'transparent',
      grid: { left: 16, right: 16, top: 36, bottom: 30, containLabel: true },
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#23232a' : '#fff',
        borderColor: splitColor,
        textStyle: { color: axisColor, fontSize: 12 },
        formatter: (params: any) => {
          if (params.seriesType === 'bar') {
            const v = params.value as [number, number]
            const xTxt = xMode === 'point' ? `${v[0]} 点` : `${v[0]}%`
            return `${params.seriesName} · 敲入<br/>${params.data.name}<br/>敲入障碍价：${xTxt}<br/>名义本金×最大亏损：${formatMoney(v[1])}<br/><span style="opacity:0.6">双击查看持仓详情</span>`
          }
          const v = params.value as [number, number, number, number]
          const xTxt = xMode === 'point' ? `${v[0]} 点` : `${v[0]}%`
          const yTxt = formatMoney(v[1])
          if (params.seriesName === '凤凰派息') {
            const cTxt = v[2] != null ? formatMoney(v[2]) : '—'
            return `${params.seriesName}（三角形）<br/>${params.data.name}<br/>派息障碍价：${xTxt}<br/>名义本金：${yTxt}<br/>派息预期收益：${cTxt}<br/><span style="opacity:0.6">双击查看持仓详情</span>`
          }
          const pTxt = formatMoney(v[2])
          const priceLabel = '敲出障碍价'
          const profitLabel = params.seriesName === '凤凰' ? '派息预期收益' : '预期收益'
          return `${params.seriesName}<br/>${params.data.name}<br/>${priceLabel}：${xTxt}<br/>名义本金：${yTxt}<br/>${profitLabel}：${pTxt}<br/><span style="opacity:0.6">双击查看持仓详情</span>`
        }
      },
      xAxis: {
        type: 'value',
        name: xMode === 'point' ? '障碍价格（点）' : '相对最新价（%）',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: subColor, fontSize: 11 },
        axisLine: { lineStyle: { color: splitColor } },
        axisLabel: { color: subColor, fontSize: 11 },
        splitLine: { lineStyle: { color: splitColor } },
        scale: true
      },
      yAxis: {
        type: 'value',
        name: '金额（元）',
        nameLocation: 'end',
        nameGap: 8,
        nameTextStyle: { color: subColor },
        axisLine: { lineStyle: { color: splitColor } },
        axisLabel: { color: subColor, fontSize: 11, margin: 10, formatter: (v: number) => formatMoney(v) },
        splitLine: { lineStyle: { color: splitColor } }
      },
      series: [makeBar('snowball'), makeBar('phoenix'), makeSeries('snowball'), makeSeries('phoenix'), makeTriangle()]
    }
  }, [seriesData, barData, phoenixKoData, markX, isDark, xMode, maxSize, hoverId, subColor, axisColor])

  return (
    <Card className="glass-card" variant="borderless" style={{ height: '100%' }}>
      <div className="scatter-controls">
        <Select
          size="small"
          value={code}
          onChange={setCode}
          style={{ width: 150 }}
          options={codeOptions.map((c) => ({ value: c, label: c }))}
        />
        <Segmented
          size="small"
          value={xMode}
          onChange={(v) => setXMode(v as 'point' | 'pct')}
          options={[
            { label: '横轴：点位', value: 'point' },
            { label: '横轴：百分比', value: 'pct' }
          ]}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.75 }}>
          最新价：{selectedLatest != null ? selectedLatest.toFixed(2) : '—'}
        </span>
        <Popover
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          trigger="click"
          placement="bottomRight"
          content={
            <div style={{ width: 220 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600 }}>自动刷新</span>
                <Switch checked={autoRefresh} onChange={(v) => setAutoRefresh(v)} />
              </div>
              <Segmented
                block
                size="small"
                value={intervalSec}
                onChange={(v) => setIntervalSec(v as number)}
                options={[
                  { label: '10秒', value: 10 },
                  { label: '30秒', value: 30 },
                  { label: '1分', value: 60 },
                  { label: '5分', value: 300 }
                ]}
              />
            </div>
          }
        >
          <Button
            type="text"
            size="small"
            icon={<ClockCircleOutlined style={{ color: autoRefresh ? '#38bdf8' : undefined }} />}
            style={{ opacity: autoRefresh ? 1 : 0.5 }}
          />
        </Popover>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={quoteLoading} />}
          onClick={() => refreshQuotes()}
          style={{ opacity: 0.5 }}
        />
        {autoRefresh && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 80,
                height: 6,
                borderRadius: 3,
                background: 'rgba(127,127,140,0.2)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(remaining / intervalSec) * 100}%`,
                  background: '#38bdf8',
                  transition: 'width 1s linear'
                }}
              />
            </div>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{remaining}s</span>
          </div>
        )}
      </div>
      {Object.keys(seriesData.snowball).length + Object.keys(seriesData.phoenix).length > 0 ? (
        <ReactECharts
          option={option}
          style={{ height: 300, width: '100%' }}
          notMerge
          onEvents={{
            mouseover: (params: { data?: { id?: number | string } }) => {
              const id = params?.data?.id
              if (id == null) return
              setHoverId(id)
            },
            globalout: () => setHoverId(null),
            dblclick: (params: { data?: { id?: number | string; structure_type?: string } }) => {
              const id = params?.data?.id
              if (id == null) return
              navigate(`/positions/${params.data.structure_type || 'snowball'}/${id}`, {
                state: { from: '/positions/analysis' }
              })
            }
          }}
        />
      ) : (
        <div className="analysis-card__empty">当前没有存续合约数据</div>
      )}
      <div className="scatter-legend" style={{ marginTop: 8 }}>
        <div className="scatter-legend__title">图例说明</div>
        <ul className="scatter-legend__list">
          <li><span className="dot dot--snowball" /> 雪球：高度 = 名义本金，面积大小 = 预期收益；横轴位置 = 敲出障碍点位</li>
          <li><span className="dot dot--phoenix" /> 凤凰：高度 = 名义本金，面积大小 = 预期收益；横轴位置 = 敲出障碍点位</li>
          <li><span className="tri-icon" /> 凤凰：高度 = 名义本金，大小 = 派息预期收益金额；横轴位置 = 派息障碍点位</li>

          <li><span className="bar-icon bar-icon--snowball" /><span className="bar-icon bar-icon--phoenix" /> 高度 = 最大亏损金额，横轴位置 = 敲入点位</li>
          <li><span className="dash-line" /> 标的最新价</li>
        </ul>
      </div>
    </Card>
  )
}

function DonutCard({
  title,
  data,
  isDark,
  palette = PALETTE
}: {
  title: string
  data: { name: string; value: number }[]
  isDark: boolean
  palette?: string[]
}) {
  const total = data.reduce((s, d) => s + d.value, 0)

  const option = useMemo(() => {
    const axisColor = isDark ? '#e6edf3' : '#1e1e22'
    const subColor = isDark ? 'rgba(230,237,243,0.55)' : 'rgba(30,30,34,0.5)'
    const cardBg = isDark ? '#18181b' : '#ffffff'
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: cardBg,
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
        textStyle: { color: axisColor },
        formatter: (p: any) => {
          const pct = total > 0 ? ((p.value / total) * 100).toFixed(2) : '0.00'
          return `${p.marker}${p.name}<br/>名义本金：${formatMoney(p.value)}（${pct}%）`
        }
      },
      legend: {
        type: 'scroll',
        orient: 'horizontal',
        bottom: 0,
        left: 'center',
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        icon: 'circle',
        textStyle: { color: subColor, fontSize: 12 },
        formatter: (name: string) => {
          const item = data.find((d) => d.name === name)
          const pct = item && total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0'
          return `${name}  ${pct}%`
        }
      },
      series: [
        {
          name: title,
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: cardBg,
            borderWidth: 2,
            borderRadius: 6
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' }
          },
          data: data.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: palette[i % palette.length] }
          }))
        }
      ]
    }
  }, [data, title, isDark])

  const centerColor = isDark ? 'rgba(230,237,243,0.55)' : 'rgba(30,30,34,0.5)'
  const centerValueColor = isDark ? '#e6edf3' : '#1e1e22'

  return (
    <Card className="glass-card" variant="borderless" style={{ height: '100%' }}>
      <div className="donut-title">{title}</div>
      {data.length > 0 ? (
        <div className="donut-wrap">
          <ReactECharts
            option={option}
            style={{ height: 260, width: '100%' }}
            notMerge
          />
          <div className="donut-center" style={{ pointerEvents: 'none' }}>
            <div className="donut-center__label" style={{ color: centerColor }}>总名义本金</div>
            <div className="donut-center__value" style={{ color: centerValueColor }}>{formatMoney(total)}</div>
          </div>
        </div>
      ) : (
        <div className="analysis-card__empty">当前没有存续合约数据</div>
      )}
    </Card>
  )
}

function PositionAnalysis() {
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const { positions, loading } = usePositionStore()
  const { latestPrices, hydrateSnapshot, fetchBatchLatest } = useMarketStore()
  const navigate = useNavigate()

  // 初始化：先用本地快照兜底，再拉实时行情覆盖（保证图示"当前点位"为最新价）
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const codes = await window.api.prices.getCodes()
        if (!mounted) return
        const items = codes
          .filter((c) => typeof c.latestPrice === 'number')
          .map((c) => ({ code: c.code, price: c.latestPrice as number }))
        hydrateSnapshot(items)
        const list = items.map((i) => i.code)
        await fetchBatchLatest(list)
      } catch {
        // 无存储数据时保持为空
      }
    })()
    return () => {
      mounted = false
    }
  }, [hydrateSnapshot, fetchBatchLatest])

  const active = useMemo(() => positions.filter(isActive), [positions])

  const byUnderlying = useMemo(
    () => aggregateBy(active, (p) => p.underlying_code || '未知标的'),
    [active]
  )
  const byStructure = useMemo(
    () => aggregateBy(active, (p) => structureLabel(p.structure_type)),
    [active]
  )

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8, marginTop: 3 }}>
        <h2 style={{ margin: 0 }}>持仓分析</h2>
      </div>

      {loading ? (
        <div className="analysis-loading">加载中…</div>
      ) : (
        <>
          <div className="analysis-grid">
            <DonutCard
              title="按标的名义本金"
              data={byUnderlying}
              isDark={isDark}
            />
            <DonutCard
              title="按结构类型名义本金"
              data={byStructure}
              isDark={isDark}
              palette={STRUCTURE_PALETTE}
            />
          </div>
          <div className="analysis-grid analysis-grid--full">
            <ScatterCard positions={active} latestPrices={latestPrices} isDark={isDark} navigate={navigate} />
          </div>
        </>
      )}
    </div>
  )
}

class ErrorBoundary extends Component {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ee6666', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h3>持仓分析页面渲染出错：</h3>
          <div>{this.state.error.message}</div>
          <div>{this.state.error.stack}</div>
        </div>
      )
    }
    return (this.props as any).children
  }
}

export default function PositionAnalysisWithBoundary() {
  return (
    <ErrorBoundary>
      <PositionAnalysis />
    </ErrorBoundary>
  )
}
