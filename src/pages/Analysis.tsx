import { useEffect } from 'react'
import { Card, Row, Col, Table, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { calcPnL, calcDaysToMaturity } from '../utils/calc'
import { formatMoney, formatPercent, STATUS_MAP } from '../utils/format'
import type { PositionData } from '../utils/calc'

export default function Analysis() {
  const { positions, fetchAll } = usePositionStore()
  const { latestPrices, fetchLatestPrice } = useMarketStore()

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    const codes = [...new Set(positions.map((p) => p.underlying_code).filter(Boolean))]
    codes.forEach((code) => fetchLatestPrice(code))
  }, [positions])

  // 按券商分布
  const brokerMap: Record<string, number> = {}
  positions.forEach((p) => {
    const key = p.broker || '未知'
    brokerMap[key] = (brokerMap[key] || 0) + p.notional
  })

  const brokerPieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    color: ['#5b6abf', '#7c8aff', '#36cfc9', '#52c41a', '#faad14', '#ff4d4f'],
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['50%', '55%'],
      data: Object.entries(brokerMap).map(([name, value]) => ({
        name,
        value: Math.round(value)
      })),
      label: { formatter: '{b}\n{d}%', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }
    }]
  }

  // 按标的分布
  const underlyingMap: Record<string, number> = {}
  positions.forEach((p) => {
    underlyingMap[p.underlying] = (underlyingMap[p.underlying] || 0) + p.notional
  })

  const underlyingPieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    color: ['#5b6abf', '#7c8aff', '#36cfc9', '#52c41a', '#faad14', '#ff4d4f'],
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['50%', '55%'],
      data: Object.entries(underlyingMap).map(([name, value]) => ({
        name,
        value: Math.round(value)
      })),
      label: { formatter: '{b}\n{d}%', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }
    }]
  }

  // 按状态分布
  const statusMap: Record<string, number> = {}
  positions.forEach((p) => {
    const label = STATUS_MAP[p.status]?.label || p.status
    statusMap[label] = (statusMap[label] || 0) + 1
  })

  const statusPieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 笔 ({d}%)' },
    color: ['#5b6abf', '#faad14', '#52c41a', '#bfbfbf'],
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['50%', '55%'],
      data: Object.entries(statusMap).map(([name, value]) => ({ name, value })),
      label: { formatter: '{b}\n{c}笔', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }
    }]
  }

  // 到期时间分布
  const maturityBuckets: Record<string, number> = {
    '1个月内': 0,
    '1-3个月': 0,
    '3-6个月': 0,
    '6-12个月': 0,
    '12个月以上': 0,
    '已到期': 0
  }
  positions.forEach((p) => {
    const days = calcDaysToMaturity(p.maturity_date)
    if (days < 0) maturityBuckets['已到期']++
    else if (days <= 30) maturityBuckets['1个月内']++
    else if (days <= 90) maturityBuckets['1-3个月']++
    else if (days <= 180) maturityBuckets['3-6个月']++
    else if (days <= 365) maturityBuckets['6-12个月']++
    else maturityBuckets['12个月以上']++
  })

  const maturityBarOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: Object.keys(maturityBuckets),
      axisLabel: { fontSize: 12 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e8e8e8' } }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 12 },
      splitLine: { lineStyle: { color: '#f0f0f0' } }
    },
    series: [{
      type: 'bar',
      data: Object.values(maturityBuckets),
      barWidth: 32,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: (params: { dataIndex: number }) => {
          const colors = ['#ff4d4f', '#faad14', '#5b6abf', '#5b6abf', '#52c41a', '#bfbfbf']
          return colors[params.dataIndex] || '#5b6abf'
        }
      },
      label: { show: true, position: 'top', fontSize: 12 }
    }],
    grid: { left: 40, right: 20, bottom: 32, top: 32 }
  }

  // 收益汇总表
  const summaryData = positions.map((p) => {
    const price = latestPrices[p.underlying_code]
    const { pnl, pnlRate, type } = calcPnL(p, price)
    return { ...p, pnl, pnlRate, pnlType: type }
  })

  const summaryColumns = [
    { title: '产品名称', dataIndex: 'product_name', key: 'product_name' },
    { title: '标的', dataIndex: 'underlying', key: 'underlying' },
    { title: '券商', dataIndex: 'broker', key: 'broker' },
    {
      title: '名义本金', dataIndex: 'notional', key: 'notional',
      render: (v: number) => formatMoney(v),
      sorter: (a: PositionData, b: PositionData) => a.notional - b.notional
    },
    {
      title: '票息率', dataIndex: 'coupon_rate', key: 'coupon_rate',
      render: (v: number) => formatPercent(v)
    },
    {
      title: '盈亏', key: 'pnl',
      render: (_: unknown, r: typeof summaryData[0]) => {
        const color = r.pnl > 0 ? '#52c41a' : r.pnl < 0 ? '#ff4d4f' : undefined
        return <span style={{ color, fontWeight: 500 }}>{r.pnl > 0 ? '+' : ''}{formatMoney(r.pnl)}</span>
      },
      sorter: (a: typeof summaryData[0], b: typeof summaryData[0]) => a.pnl - b.pnl
    },
    {
      title: '收益率', key: 'pnlRate',
      render: (_: unknown, r: typeof summaryData[0]) => {
        const color = r.pnlRate > 0 ? '#52c41a' : r.pnlRate < 0 ? '#ff4d4f' : undefined
        return <span style={{ color, fontWeight: 500 }}>{r.pnlRate > 0 ? '+' : ''}{r.pnlRate.toFixed(2)}%</span>
      }
    },
    {
      title: '类型', key: 'pnlType', dataIndex: 'pnlType',
      render: (v: string) => <Tag>{v}</Tag>
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const info = STATUS_MAP[s] || { label: s, color: 'default' }
        return <Tag color={info.color}>{info.label}</Tag>
      }
    }
  ]

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card title="按券商分布" bordered={false} className="content-card" styles={{ body: { padding: '12px 16px' } }}>
            <ReactECharts option={brokerPieOption} style={{ height: 240 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="按标的分布" bordered={false} className="content-card" styles={{ body: { padding: '12px 16px' } }}>
            <ReactECharts option={underlyingPieOption} style={{ height: 240 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="按状态分布" bordered={false} className="content-card" styles={{ body: { padding: '12px 16px' } }}>
            <ReactECharts option={statusPieOption} style={{ height: 240 }} />
          </Card>
        </Col>
      </Row>

      <Card title="到期时间分布" bordered={false} className="content-card" style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 24px' } }}>
        <ReactECharts option={maturityBarOption} style={{ height: 220 }} />
      </Card>

      <Card
        title="收益汇总"
        bordered={false}
        className="content-card"
        styles={{ body: { padding: '0 0 8px' } }}
      >
        <Table
          columns={summaryColumns}
          dataSource={summaryData}
          rowKey="id"
          pagination={false}
          size="middle"
          scroll={{ x: 1000 }}
          summary={(data) => {
            const totalNotional = data.reduce((s, r) => s + r.notional, 0)
            const totalPnl = data.reduce((s, r) => s + r.pnl, 0)
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}><strong>合计</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={3}><strong>{formatMoney(totalNotional)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4} />
                <Table.Summary.Cell index={5}>
                  <strong style={{ color: totalPnl >= 0 ? '#52c41a' : '#ff4d4f' }}>
                    {totalPnl > 0 ? '+' : ''}{formatMoney(totalPnl)}
                  </strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} colSpan={3} />
              </Table.Summary.Row>
            )
          }}
        />
      </Card>
    </div>
  )
}
