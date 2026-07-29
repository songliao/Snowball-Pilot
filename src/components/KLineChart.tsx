import { useEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Segmented, Spin, Empty, InputNumber, Button, Space, Tag } from 'antd'
import { useThemeStore } from '../stores/themeStore'

interface KLinePoint {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  ma5?: number | null
  ma10?: number | null
  ma20?: number | null
}

const RANGES = [
  { label: '1月', days: 30 },
  { label: '3月', days: 90 },
  { label: '6月', days: 180 },
  { label: '1年', days: 365 },
  { label: '2年', days: 730 },
  { label: '全部', days: 3650 }
]

// 客户端兜底计算均线（库内无存储时用于实时拉取的数据）
function computeMA(closes: number[], period: number): (number | null)[] {
  const res: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    res.push(i >= period - 1 ? Number((sum / period).toFixed(3)) : null)
  }
  return res
}

export default function KLineChart({ code }: { code: string }) {
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const [days, setDays] = useState(365)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<KLinePoint[]>([])
  const [inputVal, setInputVal] = useState<number | null>(null)
  const [compareLines, setCompareLines] = useState<number[]>([])

  const addCompareLine = () => {
    if (inputVal != null && !Number.isNaN(inputVal)) {
      setCompareLines((prev) => [...prev, inputVal])
      setInputVal(null)
    }
  }
  const removeCompareLine = (idx: number) =>
    setCompareLines((prev) => prev.filter((_, i) => i !== idx))

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setLoading(true)

    // 库内数据：直接采用数据库已算好的 MA（基于全量历史，窗口起点也准确）
    const applyDb = (rows: KLinePoint[]) => {
      if (cancelled) return
      setData(rows)
      setLoading(false)
    }

    // 实时拉取兜底（库内无该标的）：前端补算 MA，保证图表可用
    const applyLive = (rows: KLinePoint[]) => {
      if (cancelled) return
      const closes = rows.map((r) => r.close)
      const m5 = computeMA(closes, 5)
      const m10 = computeMA(closes, 10)
      const m20 = computeMA(closes, 20)
      setData(
        rows.map((r, i) => ({
          ...r,
          ma5: m5[i],
          ma10: m10[i],
          ma20: m20[i]
        }))
      )
      setLoading(false)
    }

    // 优先读取已落库的 OHLC+MA（离线可用）；库内无有效数据再实时拉取
    window.api.prices
      .getOhlc(code)
      .then((dbRows) => {
        const valid = (dbRows || []).filter(
          (r) => r.open != null && r.high != null && r.low != null
        )
        if (valid.length > 0) {
          applyDb(valid.slice(-days))
          return
        }
        return window.api.market
          .fetchKline(code, days)
          .then(applyLive)
          .catch(() => applyDb([]))
      })
      .catch(() => {
        window.api.market
          .fetchKline(code, days)
          .then(applyLive)
          .catch(() => applyDb([]))
      })

    return () => {
      cancelled = true
    }
  }, [code, days])

  if (loading) {
    return <Spin style={{ display: 'block', margin: '60px auto' }} />
  }
  if (data.length === 0) {
    return <Empty description="暂无行情数据，请稍后重试" style={{ padding: 40 }} />
  }

  const dates = data.map((d) => d.date)
  // 蜡烛图数据顺序：[开盘, 收盘, 最低, 最高]
  const candle = data.map((d) => [d.open, d.close, d.low, d.high])
  const ma5Data = data.map((d) => d.ma5 ?? null)
  const ma10Data = data.map((d) => d.ma10 ?? null)
  const ma20Data = data.map((d) => d.ma20 ?? null)
  const latestClose = data.length ? data[data.length - 1].close : null

  // 横虚线：最新收盘价（灰）+ 用户添加的对比线（橙）
  const markLineData: any[] = []
  if (latestClose != null) {
    markLineData.push({
      yAxis: latestClose,
      lineStyle: { type: 'dashed', color: '#94a3b8', width: 1 },
      label: {
        formatter: (p: { value: number }) => `最新 ${p.value.toFixed(2)}`,
        position: 'insideEndTop',
        color: '#94a3b8',
        fontSize: 11
      }
    })
  }
  compareLines.forEach((v) => {
    markLineData.push({
      yAxis: v,
      lineStyle: { type: 'dashed', color: '#f97316', width: 1 },
      label: {
        formatter: (p: { value: number }) => p.value.toFixed(2),
        position: 'end',
        color: '#f97316',
        fontSize: 11
      }
    })
  })
  const markLine = markLineData.length
    ? { silent: true, symbol: 'none', data: markLineData }
    : undefined

  const maLine = (name: string, dataArr: (number | null)[], color: string) => ({
    name,
    type: 'line',
    data: dataArr,
    smooth: true,
    showSymbol: false,
    lineStyle: { width: 1.2 },
    itemStyle: { color },
    z: 2
  })

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' }
    },
    legend: {
      data: ['K线', 'MA5', 'MA10', 'MA20'],
      top: 0
    },
    grid: { left: 60, right: 20, top: 36, bottom: 70 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLabel: { fontSize: 11 }
    },
    yAxis: {
      scale: true,
      axisLabel: { fontSize: 11 },
      splitLine: { show: false }
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 18, bottom: 10 }
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: candle,
        itemStyle: {
          color: '#ef4444', // 涨（收盘>开盘）红
          color0: '#22c55e', // 跌 绿
          borderColor: '#ef4444',
          borderColor0: '#22c55e'
        },
        // 最新收盘价 + 用户对比线 横虚线
        markLine,
        z: 1
      },
      maLine('MA5', ma5Data, '#f59e0b'),
      maLine('MA10', ma10Data, '#3b82f6'),
      maLine('MA20', ma20Data, '#a855f7')
    ]
  }

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <InputNumber
          placeholder="输入对比价格"
          value={inputVal}
          onChange={(v) => setInputVal(v)}
          onPressEnter={addCompareLine}
          style={{ width: 160 }}
        />
        <Button type="primary" size="small" onClick={addCompareLine}>
          添加对比线
        </Button>
        {compareLines.length > 0 && (
          <Button size="small" onClick={() => setCompareLines([])}>清空</Button>
        )}
      </Space>
      {compareLines.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {compareLines.map((v, i) => (
            <Tag key={i} closable color="orange" onClose={() => removeCompareLine(i)}>
              {v.toFixed(2)}
            </Tag>
          ))}
        </div>
      )}
      <Segmented
        block
        value={RANGES.find((r) => r.days === days)?.label}
        options={RANGES.map((r) => r.label)}
        onChange={(label) => {
          const found = RANGES.find((r) => r.label === label)
          if (found) setDays(found.days)
        }}
        style={{ marginBottom: 12 }}
      />
      <ReactECharts
        option={option}
        style={{ height: 420, background: isDark ? '#18181b' : '#ffffff' }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
    </div>
  )
}
