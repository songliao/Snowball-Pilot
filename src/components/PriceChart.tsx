import { useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import { Empty } from 'antd'
import { useMarketStore } from '../stores/marketStore'

interface PriceChartProps {
  code: string
  knockInPrice: number
  knockOutPrice: number
  initialPrice: number
}

export default function PriceChart({ code, knockInPrice, knockOutPrice, initialPrice }: PriceChartProps) {
  const { prices, fetchPriceHistory } = useMarketStore()

  useEffect(() => {
    if (code) {
      fetchPriceHistory(code)
    }
  }, [code])

  const data = prices[code] || []

  if (data.length === 0) {
    return <Empty description="暂无价格数据，请先录入或拉取行情" style={{ padding: 40 }} />
  }

  const dates = data.map((d) => d.date)
  const priceValues = data.map((d) => d.price)

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; value: number }>) => {
        const p = params[0]
        return `${p.axisValue}<br/>价格: ${p.value.toFixed(2)}`
      }
    },
    grid: {
      left: 60,
      right: 20,
      top: 30,
      bottom: 30
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        name: '价格',
        type: 'line',
        data: priceValues,
        smooth: true,
        lineStyle: { width: 2, color: '#1677ff' },
        itemStyle: { color: '#1677ff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(22,119,255,0.15)' },
              { offset: 1, color: 'rgba(22,119,255,0.01)' }
            ]
          }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed' },
          data: [
            {
              yAxis: knockInPrice,
              label: { formatter: `敲入 ${knockInPrice.toFixed(2)}`, position: 'insideEndTop', fontSize: 11 },
              lineStyle: { color: '#ff4d4f' }
            },
            {
              yAxis: knockOutPrice,
              label: { formatter: `敲出 ${knockOutPrice.toFixed(2)}`, position: 'insideEndTop', fontSize: 11 },
              lineStyle: { color: '#52c41a' }
            },
            {
              yAxis: initialPrice,
              label: { formatter: `期初 ${initialPrice.toFixed(2)}`, position: 'insideEndTop', fontSize: 11 },
              lineStyle: { color: '#999' }
            }
          ]
        }
      }
    ]
  }

  return <ReactECharts option={option} style={{ height: 300 }} />
}
