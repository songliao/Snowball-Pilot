import { useEffect, useState } from 'react'
import { Card, Table, Tag, Button, Space, Input, Select, Popconfirm, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { calcPnL, calcKnockInPrice, calcSafetyMargin } from '../utils/calc'
import { formatMoney, formatPercent, formatDate, STATUS_MAP } from '../utils/format'
import type { PositionData } from '../utils/calc'

export default function Positions() {
  const navigate = useNavigate()
  const { positions, fetchAll, remove, loading } = usePositionStore()
  const { latestPrices, fetchLatestPrice } = useMarketStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [brokerFilter, setBrokerFilter] = useState<string>('all')

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    const codes = [...new Set(positions.map((p) => p.underlying_code).filter(Boolean))]
    codes.forEach((code) => fetchLatestPrice(code))
  }, [positions])

  const brokers = [...new Set(positions.map((p) => p.broker).filter(Boolean))]

  const filtered = positions.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (brokerFilter !== 'all' && p.broker !== brokerFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        p.product_name.toLowerCase().includes(s) ||
        p.underlying.toLowerCase().includes(s) ||
        p.broker.toLowerCase().includes(s)
      )
    }
    return true
  })

  const handleDelete = async (id: number) => {
    await remove(id)
    message.success('已删除')
  }

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'product_name',
      key: 'product_name',
      render: (text: string, record: PositionData) => (
        <a onClick={() => navigate(`/positions/${record.id}`)} style={{ fontWeight: 500 }}>
          {text}
        </a>
      )
    },
    {
      title: '券商',
      dataIndex: 'broker',
      key: 'broker',
      render: (v: string) => v || <span style={{ opacity: 0.35 }}>—</span>
    },
    { title: '标的', dataIndex: 'underlying', key: 'underlying' },
    {
      title: '名义本金',
      dataIndex: 'notional',
      key: 'notional',
      sorter: (a: PositionData, b: PositionData) => a.notional - b.notional,
      render: (v: number) => <span style={{ fontWeight: 500 }}>{formatMoney(v)}</span>
    },
    {
      title: '票息率',
      dataIndex: 'coupon_rate',
      key: 'coupon_rate',
      render: (v: number) => <span style={{ fontWeight: 500 }}>{formatPercent(v)}</span>
    },
    {
      title: '敲入价',
      key: 'knock_in_price',
      render: (_: unknown, record: PositionData) => (
        <span style={{ color: '#ff4d4f' }}>
          {calcKnockInPrice(record.initial_price, record.knock_in_pct).toFixed(2)}
        </span>
      )
    },
    {
      title: '安全垫',
      key: 'safety',
      render: (_: unknown, record: PositionData) => {
        if (record.status !== 'active') return <span style={{ opacity: 0.35 }}>—</span>
        const price = latestPrices[record.underlying_code]
        if (!price) return <span style={{ opacity: 0.35 }}>—</span>
        const kiPrice = calcKnockInPrice(record.initial_price, record.knock_in_pct)
        const margin = calcSafetyMargin(price, kiPrice)
        const color = margin < 0.05 ? '#ff4d4f' : margin < 0.1 ? '#faad14' : '#52c41a'
        return <span style={{ color, fontWeight: 500 }}>{formatPercent(margin, 1)}</span>
      }
    },
    {
      title: '浮动盈亏',
      key: 'pnl',
      sorter: (a: PositionData, b: PositionData) => {
        const pa = calcPnL(a, latestPrices[a.underlying_code]).pnl
        const pb = calcPnL(b, latestPrices[b.underlying_code]).pnl
        return pa - pb
      },
      render: (_: unknown, record: PositionData) => {
        const price = latestPrices[record.underlying_code]
        const { pnl } = calcPnL(record, price)
        const color = pnl > 0 ? '#52c41a' : pnl < 0 ? '#ff4d4f' : undefined
        return (
          <span style={{ color, fontWeight: 500 }}>
            {pnl > 0 ? '+' : ''}{formatMoney(pnl)}
          </span>
        )
      }
    },
    {
      title: '到期日',
      dataIndex: 'maturity_date',
      key: 'maturity_date',
      sorter: (a: PositionData, b: PositionData) =>
        new Date(a.maturity_date).getTime() - new Date(b.maturity_date).getTime(),
      render: (v: string) => formatDate(v)
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const s = STATUS_MAP[status] || { label: status, color: 'default' }
        return <Tag color={s.color}>{s.label}</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      render: (_: unknown, record: PositionData) => (
        <Space size={2}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/positions/${record.id}/edit`)}
          />
          <Popconfirm
            title="确定删除该持仓？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(record.id!)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      {/* Filter + Table in one card */}
      <Card bordered={false} className="content-card" styles={{ body: { padding: '16px 24px 8px' } }}>
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索产品名称 / 标的 / 券商"
            prefix={<SearchOutlined style={{ opacity: 0.35 }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '存续中' },
              { value: 'knocked_in', label: '已敲入' },
              { value: 'knocked_out', label: '已敲出' },
              { value: 'matured', label: '已到期' }
            ]}
          />
          <Select
            value={brokerFilter}
            onChange={setBrokerFilter}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部券商' },
              ...brokers.map((b) => ({ value: b, label: b }))
            ]}
          />
          <span style={{ fontSize: 13, opacity: 0.45, marginLeft: 'auto' }}>
            共 {filtered.length} 条
          </span>
          <Button icon={<PlusOutlined />} onClick={() => navigate('/positions/new')} style={{ marginLeft: 12 }}>
            新增持仓
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 条`, showSizeChanger: false }}
          size="middle"
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  )
}
