import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Popconfirm, Space, Tag, message } from 'antd'
import type { TableProps } from 'antd'
import { EyeOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { formatMoney, formatPercent, formatDate, STATUS_MAP } from '../utils/format'
import type { PositionData } from '../utils/calc'

// 下一敲出观察日：今天及之后（含今天）最近的观察日；若都已过去则不显示，不取过去的日期
function getNextKo(p: PositionData): { date: string | null; barrierPrice: number | null } {
  const dates: string[] = p.knock_out_dates ? JSON.parse(p.knock_out_dates) : []
  const barriers: number[] = p.knock_out_barriers ? JSON.parse(p.knock_out_barriers) : []
  if (!dates.length) return { date: null, barrierPrice: null }
  const today = dayjs().startOf('day')
  const idx = dates.findIndex((d) => !dayjs(d).startOf('day').isBefore(today))
  if (idx < 0) return { date: null, barrierPrice: null }
  const barrierPct = barriers[idx]
  const barrierPrice =
    barrierPct != null && p.initial_price ? p.initial_price * (barrierPct / 100) : null
  return { date: dates[idx], barrierPrice }
}

export default function Positions() {
  const { positions, loading, fetchAll, remove } = usePositionStore()
  const { latestPrices, fetchLatestPrice } = useMarketStore()
  const navigate = useNavigate()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const codes = Array.from(
      new Set(positions.map((p) => p.underlying_code).filter((c): c is string => !!c))
    )
    codes.forEach((code) => {
      if (latestPrices[code] == null) fetchLatestPrice(code)
    })
  }, [positions, latestPrices, fetchLatestPrice])

  const handleDelete = async (id: number, structureType: string) => {
    setDeletingId(id)
    try {
      await remove(id, structureType)
      message.success('已删除持仓')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(
        msg.includes('No handler')
          ? '删除失败：主进程未生效，请完全退出并重启本应用后重试'
          : `删除失败：${msg}`
      )
    } finally {
      setDeletingId(null)
    }
  }

  // 下一派息观察日及其对应派息障碍价格（仅凤凰使用）
  function getNextCoupon(p: PositionData): { date: string | null; barrierPrice: number | null } {
    const dates: string[] = p.coupon_dates ? JSON.parse(p.coupon_dates) : []
    if (!dates.length) return { date: null, barrierPrice: null }
    const today = dayjs().startOf('day')
    // 仅取今天及之后（含今天）的观察日；若都已过去则不显示，不取过去的日期
    const idx = dates.findIndex((d) => !dayjs(d).startOf('day').isBefore(today))
    if (idx < 0) return { date: null, barrierPrice: null }
    // coupon_barrier 存为小数（如 0.8 表示 80%）
    const barrierPrice =
      p.initial_price != null && p.coupon_barrier != null
        ? p.initial_price * (p.coupon_barrier as number)
        : null
    return { date: dates[idx], barrierPrice }
  }

  const buildColumns = (isPhoenix: boolean): TableProps<PositionData>['columns'] => {
    // 百分比列宽：随页面宽度等比伸缩，各列相对均衡
    const W = isPhoenix
      ? { contract: '7%', date: '7.5%', underlying: '9.5%', price: '9%', couponDate: '10%', couponBarrier: '9%', koDate: '10%', koBarrier: '9%', notional: '9%', margin: '8%', status: '7%' }
      : { contract: '8%', date: '9%', underlying: '11%', price: '10%', koDate: '12%', koBarrier: '10%', notional: '13%', margin: '10%', status: '9%' }
    const cols: TableProps<PositionData>['columns'] = [
      {
        title: '合约编号',
        dataIndex: 'contract_no',
        key: 'contract_no',
        width: W.contract,
        ellipsis: true,
        className: `contract-no-col contract-no-col--${isPhoenix ? 'phoenix' : 'snow'}`,
        onHeaderCell: () => ({ className: `contract-no-col contract-no-col--${isPhoenix ? 'phoenix' : 'snow'}` }),
        render: (v: string) => (
          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {v || '—'}
          </span>
        )
      },
      {
        title: '起息日',
        key: 'trade_start_date',
        width: W.date,
        className: 'trade-date-col',
        onHeaderCell: () => ({ className: 'trade-date-col' }),
        sorter: (a, b) => (a.trade_start_date || '').localeCompare(b.trade_start_date || ''),
        render: (_, r) => (r.trade_start_date ? dayjs(r.trade_start_date).format('YY-MM-DD') : '—')
      },
      {
        title: '挂钩标的',
        key: 'underlying_code',
        width: W.underlying,
        ellipsis: true,
        render: (_, r) => r.underlying_code || r.underlying || '—'
      },
      {
      title: '标的现价',
      key: 'underlying_price',
      width: W.price,
      ellipsis: true,
        align: 'right',
        render: (_, r) => {
          const price = latestPrices[r.underlying_code]
          return price != null ? price.toFixed(2) : '—'
        }
      },
      {
        title: '敲出观察日',
        key: 'next_ko_date',
        width: W.koDate,
        sorter: (a, b) => (getNextKo(a).date || '').localeCompare(getNextKo(b).date || ''),
        render: (_, r) => {
          const { date } = getNextKo(r)
          return date ? dayjs(date).format('YY-MM-DD') : '—'
        }
      },
      {
        title: '敲出障碍',
        key: 'next_ko_barrier',
        width: W.koBarrier,
        ellipsis: true,
        align: 'right',
        sorter: (a, b) =>
          (getNextKo(a).barrierPrice ?? -Infinity) - (getNextKo(b).barrierPrice ?? -Infinity),
        render: (_, r) => {
          const { barrierPrice } = getNextKo(r)
          return barrierPrice != null ? barrierPrice.toFixed(2) : '—'
        }
      },
      {
        title: '名义本金',
        dataIndex: 'notional',
        key: 'notional',
        width: W.notional,
        align: 'right',
        render: (v: number) => (v != null ? formatMoney(v) : '—')
      },
      {
      title: '保证金',
      dataIndex: 'margin_ratio',
      key: 'margin_ratio',
      width: W.margin,
      ellipsis: true,
        align: 'right',
        render: (v: number) => (v != null ? formatPercent(v) : '—')
      },
      {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: W.status,
      render: (v: string) =>
        v ? (
          <Tag className={`status-tag status-tag--${v}`}>{STATUS_MAP[v]?.label || v}</Tag>
        ) : (
          '—'
        )
      },
      {
        title: '操作',
        key: 'action',
        width: 72,
        align: 'right',
        render: (_, r) => (
          <Space size={4}>
            <Button
              type="text"
              size="small"
              className="icon-btn"
              title="查看"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/positions/${r.structure_type}/${r.id}`, { state: { from: '/positions' } })
              }}
            >
              <span className="nav-icon-circle">
                <EyeOutlined />
              </span>
            </Button>
            <Popconfirm
              title="删除该持仓？"
              description={`将永久删除 ${r.contract_no || r.id} 的持仓记录`}
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={(e) => {
                e?.stopPropagation()
                handleDelete(r.id, r.structure_type)
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                type="text"
                size="small"
                className="icon-btn"
                danger
                title="删除"
                loading={deletingId === r.id}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="nav-icon-circle">
                  <DeleteOutlined />
                </span>
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    ]

    if (isPhoenix) {
      const insertAt = cols.findIndex((c) => c.key === 'next_ko_date')
      cols.splice(insertAt, 0, {
        title: '派息观察日',
        key: 'next_coupon_date',
        width: W.couponDate,
        sorter: (a, b) => (getNextCoupon(a).date || '').localeCompare(getNextCoupon(b).date || ''),
        render: (_, r: PositionData) => {
          const { date } = getNextCoupon(r)
          return date ? dayjs(date).format('YY-MM-DD') : '—'
        }
      })
      cols.splice(insertAt + 1, 0, {
        title: '派息障碍',
        key: 'next_coupon_barrier',
        width: W.couponBarrier,
        align: 'right',
        sorter: (a, b) =>
          (getNextCoupon(a).barrierPrice ?? -Infinity) - (getNextCoupon(b).barrierPrice ?? -Infinity),
        render: (_, r: PositionData) => {
          const { barrierPrice } = getNextCoupon(r)
          return barrierPrice != null ? barrierPrice.toFixed(2) : '—'
        }
      })
    }
    return cols
  }
  const snowballColumns = buildColumns(false)
  const phoenixColumns = buildColumns(true)

  const snowballList = positions.filter((p) => p.structure_type === 'snowball')
  const phoenixList = positions.filter((p) => p.structure_type === 'phoenix')

  const renderTable = (data: PositionData[], cols: TableProps<PositionData>['columns']) => (
    <Table<PositionData>
      rowKey="id"
      loading={loading}
      columns={cols}
      dataSource={data}
      pagination={{ pageSize: 12, hideOnSinglePage: true }}
      locale={{ emptyText: '暂无持仓' }}
      onRow={(record) => ({
        style: { cursor: 'pointer' },
        onClick: () => navigate(`/positions/${record.structure_type}/${record.id}`, { state: { from: '/positions' } })
      })}
    />
  )

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>持仓管理</h2>
      </div>

      <Card
        variant="borderless"
        className="content-card"
        style={{ marginBottom: 16 }}
        title="雪球"
      >
        {renderTable(snowballList, snowballColumns)}
      </Card>

      <Card
        variant="borderless"
        className="content-card"
        title="凤凰"
      >
        {renderTable(phoenixList, phoenixColumns)}
      </Card>
    </div>
  )
}
