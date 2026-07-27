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

// 下一敲出观察日（今天之后的首个观察日，若都已过去则取最近一个）及其对应敲出障碍价格
function getNextKo(p: PositionData): { date: string | null; barrierPrice: number | null } {
  const dates: string[] = p.knock_out_dates ? JSON.parse(p.knock_out_dates) : []
  const barriers: number[] = p.knock_out_barriers ? JSON.parse(p.knock_out_barriers) : []
  if (!dates.length) return { date: null, barrierPrice: null }
  const today = dayjs().startOf('day')
  let idx = dates.findIndex((d) => dayjs(d).startOf('day').isAfter(today))
  if (idx < 0) idx = dates.length - 1
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
    let idx = dates.findIndex((d) => dayjs(d).startOf('day').isAfter(today))
    if (idx < 0) idx = dates.length - 1
    // coupon_barrier 存为小数（如 0.8 表示 80%）
    const barrierPrice =
      p.initial_price != null && p.coupon_barrier != null
        ? p.initial_price * (p.coupon_barrier as number)
        : null
    return { date: dates[idx], barrierPrice }
  }

  const buildColumns = (koBarrierWidth: number, isPhoenix: boolean): TableProps<PositionData>['columns'] => {
    const cols: TableProps<PositionData>['columns'] = [
      {
        title: '合约编号',
        dataIndex: 'contract_no',
        key: 'contract_no',
        width: 75,
        ellipsis: true,
        render: (v: string) => v || '—'
      },
      {
        title: '挂钩标的',
        key: 'underlying_code',
        width: 90,
        ellipsis: true,
        render: (_, r) => r.underlying_code || r.underlying || '—'
      },
      {
      title: '标的现价',
      key: 'underlying_price',
      width: 80,
        align: 'right',
        render: (_, r) => {
          const price = latestPrices[r.underlying_code]
          return price != null ? price.toFixed(2) : '—'
        }
      },
      {
        title: '敲出观察日',
        key: 'next_ko_date',
        width: 98,
        render: (_, r) => {
          const { date } = getNextKo(r)
          return date ? dayjs(date).format('YY-MM-DD') : '—'
        }
      },
      {
        title: '敲出障碍',
        key: 'next_ko_barrier',
        width: koBarrierWidth,
        align: 'right',
        render: (_, r) => {
          const { barrierPrice } = getNextKo(r)
          return barrierPrice != null ? barrierPrice.toFixed(2) : '—'
        }
      },
      {
        title: '名义本金',
        dataIndex: 'notional',
        key: 'notional',
        width: 105,
        align: 'right',
        render: (v: number) => (v != null ? formatMoney(v) : '—')
      },
      {
      title: '保证金',
      dataIndex: 'margin_ratio',
      key: 'margin_ratio',
      width: 80,
        align: 'right',
        render: (v: number) => (v != null ? formatPercent(v) : '—')
      },
      {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 75,
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
                navigate(`/positions/${r.id}`)
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
        width: 98,
        render: (_, r: PositionData) => {
          const { date } = getNextCoupon(r)
          return date ? dayjs(date).format('YY-MM-DD') : '—'
        }
      })
      cols.splice(insertAt + 1, 0, {
        title: '派息障碍',
        key: 'next_coupon_barrier',
        width: 88,
        align: 'right',
        render: (_, r: PositionData) => {
          const { barrierPrice } = getNextCoupon(r)
          return barrierPrice != null ? barrierPrice.toFixed(2) : '—'
        }
      })
    }
    return cols
  }
  const snowballColumns = buildColumns(75, false)
  const phoenixColumns = buildColumns(100, true)

  const snowballList = positions.filter((p) => p.structure_type === 'snowball')
  const phoenixList = positions.filter((p) => p.structure_type === 'phoenix')

  const renderTable = (data: PositionData[], cols: TableProps<PositionData>['columns']) => (
    <Table<PositionData>
      rowKey="id"
      loading={loading}
      columns={cols}
      dataSource={data}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 12, hideOnSinglePage: true }}
      locale={{ emptyText: '暂无持仓' }}
      onRow={(record) => ({
        style: { cursor: 'pointer' },
        onClick: () => navigate(`/positions/${record.id}`)
      })}
    />
  )

  return (
    <div style={{ marginTop: -1 }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
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
