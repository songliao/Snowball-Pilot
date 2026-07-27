import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Tag, Button, Space, message, Row, Col, Popconfirm, Modal, DatePicker, InputNumber
} from 'antd'
import {
  ArrowLeftOutlined, EditOutlined, SyncOutlined,
  WarningOutlined, DollarOutlined, ClockCircleOutlined, RollbackOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { computeKnockOutProfit } from '../utils/calc'
import { formatDate, STATUS_MAP } from '../utils/format'
import PositionForm from './PositionForm'

export default function PositionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { current, fetchById, updateStatus } = usePositionStore()
  const { latestPrices, prices, fetchLatestPrice, fetchRemotePrice, fetchPriceHistory } = useMarketStore()
  const [kiModalOpen, setKiModalOpen] = useState(false)
  const [kiDate, setKiDate] = useState<dayjs.Dayjs | null>(dayjs())
  const [endModalOpen, setEndModalOpen] = useState(false)
  const [endAction, setEndAction] = useState<'knocked_out' | 'matured'>('knocked_out')
  const [endDate, setEndDate] = useState<dayjs.Dayjs | null>(dayjs())
  const [endPayoff, setEndPayoff] = useState<number | null>(null)

  useEffect(() => {
    if (id) fetchById(Number(id))
  }, [id])

  useEffect(() => {
    if (current?.underlying_code) {
      fetchLatestPrice(current.underlying_code)
      fetchPriceHistory(current.underlying_code)
    }
  }, [current])

  if (!current) return null

  const pos = current
  const currentPrice = latestPrices[pos.underlying_code]
  const priceSeries = prices[pos.underlying_code] || []
  const changePct = (() => {
    if (priceSeries.length >= 2) {
      const last = priceSeries[priceSeries.length - 1]
      const prev = priceSeries[priceSeries.length - 2]
      if (prev.price) return ((last.price - prev.price) / prev.price) * 100
    }
    return null
  })()
  const up = changePct != null ? changePct >= 0 : true
  const color = up ? '#ef4444' : '#22c55e'
  const koDates = pos.knock_out_dates ? (JSON.parse(pos.knock_out_dates) as string[]) : []
  const koBarriers = pos.knock_out_barriers ? (JSON.parse(pos.knock_out_barriers) as number[]) : []
  const koCoupons = pos.knock_out_coupons ? (JSON.parse(pos.knock_out_coupons) as number[]) : []
  // 最近（离今天最近）敲出观察日，及其对应障碍价与票息
  const today = dayjs()
  let nearestKoIdx = -1
  let nearestKoDiff = Infinity
  koDates.forEach((d, i) => {
    const diff = Math.abs(dayjs(d).diff(today, 'day'))
    if (diff < nearestKoDiff) {
      nearestKoDiff = diff
      nearestKoIdx = i
    }
  })
  const nearestKoDate = nearestKoIdx >= 0 ? koDates[nearestKoIdx] : null
  const nearestKoBarrier = nearestKoIdx >= 0 ? koBarriers[nearestKoIdx] : null
  const nearestKoCoupon = nearestKoIdx >= 0 ? koCoupons[nearestKoIdx] : null
  const nearestKoBarrierPrice =
    nearestKoBarrier != null && pos.initial_price
      ? pos.initial_price * (nearestKoBarrier / 100)
      : null
  // 剩余自然日（不含当天）：从明天起到最近敲出观察日的天数
  const koRemainingDays =
    nearestKoDate != null
      ? Math.max(0, dayjs(nearestKoDate).startOf('day').diff(dayjs().startOf('day'), 'day'))
      : null
  // 点位差距：敲出观察点位 / 现价 - 1；负=已在敲出线上，正=还需的涨幅
  const koGapPct =
    nearestKoBarrierPrice != null && currentPrice
      ? (nearestKoBarrierPrice / currentPrice - 1) * 100
      : null
  // 敲出收益 = 票息 + 返息 - 交易费用
  const koProfit =
    pos.notional != null && nearestKoDate
      ? computeKnockOutProfit({
          notional: pos.notional,
          couponPct: nearestKoCoupon ?? 0,
          tradeStartDate: pos.trade_start_date,
          koObservationDate: dayjs(nearestKoDate).format('YYYY-MM-DD'),
          accrualBasis: pos.accrual_basis,
          accrualSettleTplus: pos.accrual_settle_tplus,
          rebateAnnualPct: pos.rebate_annual_pct,
          rebateAbsFrontPct: pos.rebate_absolute_front_pct,
          rebateAbsBackPct: pos.rebate_absolute_back_pct,
          absFeePct: pos.abs_fee_pct,
          annualFeePct: pos.annual_fee_pct,
          incomeDividendPct: pos.income_dividend_pct
        })
      : null
  const statusInfo = STATUS_MAP[pos.status] || { label: pos.status, color: 'default' }

  const handleStatusChange = async (status: string, kiDateStr?: string) => {
    await updateStatus(
      pos.id!,
      status,
      pos.structure_type,
      status === 'knocked_in' ? true : undefined,
      kiDateStr
    )
    message.success('状态已更新')
    fetchById(pos.id!)
  }

  const handleKiConfirm = async () => {
    setKiModalOpen(false)
    const dateStr = kiDate ? kiDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    await handleStatusChange('knocked_in', dateStr)
  }

  const handleRevokeKnockIn = async () => {
    await updateStatus(pos.id!, 'active', pos.structure_type, false)
    message.success('已撤回敲入状态')
    fetchById(pos.id!)
  }

  const handleRevokeEnd = async () => {
    // 撤销了结：恢复为敲入前（或存续）状态，保留敲入状态与敲入日期，仅清除了结日期/收益
    const prevStatus = pos.is_ki ? 'knocked_in' : 'active'
    await updateStatus(pos.id!, prevStatus, pos.structure_type, undefined, undefined, null, null)
    message.success('已撤销了结')
    fetchById(pos.id!)
  }

  const handleEndConfirm = async () => {
    setEndModalOpen(false)
    const dateStr = endDate ? endDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    await updateStatus(
      pos.id!,
      endAction,
      pos.structure_type,
      undefined,
      undefined,
      dateStr,
      endPayoff ?? 0
    )
    message.success('状态已更新')
    fetchById(pos.id!)
  }

  const handleFetchPrice = async () => {
    const price = await fetchRemotePrice(pos.underlying_code)
    if (price) {
      message.success(`已获取最新价格：${price.toFixed(2)}`)
    } else {
      message.error('获取行情失败，请手动录入')
    }
  }

  return (
    <div style={{ marginTop: -16 }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <Space align="center" size={12}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/positions')}
            style={{ width: 32, height: 32, padding: 0, borderRadius: 6 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{pos.product_name}</span>
            <Tag className={`status-tag status-tag--${pos.status}`}>{statusInfo.label}</Tag>
            {!!pos.is_ki && pos.status !== 'knocked_in' && (
              <Tag className="status-tag status-tag--knocked_in">
                敲入于{pos.knock_in_date ? formatDate(pos.knock_in_date) : ''}
              </Tag>
            )}
          </div>
        </Space>
        <Space>
          {/* 敲入 / 已敲入：互斥，共用第一个位置槽，保证后续按钮位置固定 */}
          {(pos.status === 'active' || pos.status === 'knocked_out' || pos.status === 'matured') && !pos.is_ki && (
            <Button
              className="action-btn action-btn--ki"
              icon={<span className="nav-icon-circle nav-icon-circle--ki"><WarningOutlined /></span>}
              onClick={() => {
                setKiDate(dayjs())
                setKiModalOpen(true)
              }}
            >
              标记敲入
            </Button>
          )}
          {pos.status === 'knocked_in' && (
            <Popconfirm
              title="确认撤销敲入？"
              description="将清空敲入状态与敲入日期"
              onConfirm={handleRevokeKnockIn}
            >
              <Button className="action-btn action-btn--kied" icon={<span className="nav-icon-circle nav-icon-circle--kied"><RollbackOutlined /></span>}>
                敲入于{pos.knock_in_date ? formatDate(pos.knock_in_date) : ''}
              </Button>
            </Popconfirm>
          )}
          {(pos.status === 'active' || pos.status === 'knocked_in') && (
            <Button
              className="action-btn action-btn--ko"
              icon={<span className="nav-icon-circle nav-icon-circle--ko"><DollarOutlined /></span>}
              onClick={() => {
                setEndAction('knocked_out')
                setEndDate(dayjs())
                setEndPayoff(null)
                setEndModalOpen(true)
              }}
            >
              标记敲出
            </Button>
          )}
          {(pos.status === 'active' || pos.status === 'knocked_in') && (
            <Button
              className="action-btn"
              icon={<span className="nav-icon-circle"><ClockCircleOutlined /></span>}
              onClick={() => {
                setEndAction('matured')
                setEndDate(dayjs())
                setEndPayoff(null)
                setEndModalOpen(true)
              }}
            >
              标记到期
            </Button>
          )}
          {(pos.status === 'knocked_out' || pos.status === 'matured') && (
            <Popconfirm
              title="确认撤销了结？"
              description="将恢复至敲入/存续状态，并清除了结日期与收益"
              onConfirm={handleRevokeEnd}
            >
              <Button
                className="action-btn"
                icon={<span className="nav-icon-circle"><RollbackOutlined /></span>}
              >
                撤销{pos.status === 'knocked_out' ? '敲出' : '到期'}
              </Button>
            </Popconfirm>
          )}
          <Button className="action-btn" icon={<span className="nav-icon-circle"><EditOutlined /></span>} onClick={() => navigate(`/positions/${pos.id}/edit`)}>
            编辑合约
          </Button>
        </Space>
      </div>

      {/* Metrics */}
      {(pos.status !== 'knocked_out' && pos.status !== 'matured') && (
      <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card className="glass-card index-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{pos.underlying || pos.underlying_code}</span>
              <Button size="small" type="text" icon={<SyncOutlined />} onClick={handleFetchPrice} style={{ fontSize: 12, opacity: 0.5 }} />
            </div>
            {currentPrice != null ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
                    {currentPrice.toFixed(2)}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>期初</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {pos.initial_price?.toFixed(2) ?? '—'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 11, opacity: 0.5 }}>最新涨跌幅</span>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color,
                    background: up ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)',
                    padding: '1px 5px',
                    borderRadius: 3
                  }}>
                    {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.35, padding: '8px 0' }}>未录入</div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card className="stat-card content-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>最近敲出观察</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 8px' }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>观察日期</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {nearestKoDate ? formatDate(nearestKoDate) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>剩余自然日</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {koRemainingDays != null ? `${koRemainingDays} 天` : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>观察点位</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {nearestKoBarrierPrice != null ? nearestKoBarrierPrice.toFixed(2) : '—'}
                  {nearestKoBarrier != null && (
                    <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>{nearestKoBarrier}%</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>
                  {koGapPct == null ? '点位差距' : koGapPct < 0 ? '当前超出敲出障碍价格' : '当前低于敲出障碍价格'}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: koGapPct == null ? undefined : koGapPct < 0 ? '#22c55e' : '#ef4444',
                  }}
                >
                  {koGapPct != null ? `${Math.abs(koGapPct).toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="stat-card content-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>敲出收益估算</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {koProfit != null
                ? `¥${koProfit.net.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                : '—'}
            </div>
            {koProfit != null && (
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 10, lineHeight: 1.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>敲出票息</span>
                  <span>+¥{koProfit.coupon.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>返息</span>
                  <span>
                    +¥{koProfit.rebate.total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>交易费用</span>
                  <span>
                    -¥{koProfit.fees.total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div style={{ marginTop: 4, opacity: 0.7 }}>
                  存续 {koProfit.holdingDays} 天 · 本金
                  ¥{(pos.notional ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </div>
              </div>
            )}
          </Card>
        </Col>
      </Row>
      )}

      {(pos.status === 'knocked_out' || pos.status === 'matured') && (
        <Card className="stat-card content-card" variant="borderless" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>
            {pos.status === 'knocked_out' ? '敲出了结' : '到期了结'}
          </div>
          <Row gutter={32}>
            <Col>
              <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>了结日期</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {pos.termination_date ? formatDate(pos.termination_date) : '—'}
              </div>
            </Col>
            <Col>
              <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>了结收益</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {pos.termination_payoff != null
                  ? `¥${Number(pos.termination_payoff).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                  : '—'}
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* 结构信息（与录入版式一致，只读） */}
      <PositionForm readOnly bare />

      <Modal
        title="标记为已敲入"
        open={kiModalOpen}
        onOk={handleKiConfirm}
        onCancel={() => setKiModalOpen(false)}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 8, opacity: 0.6 }}>请选择敲入日期：</div>
        <DatePicker
          value={kiDate}
          onChange={(d) => setKiDate(d)}
          style={{ width: '100%' }}
          allowClear={false}
        />
      </Modal>

      <Modal
        title={endAction === 'knocked_out' ? '标记为已敲出' : '标记为已到期'}
        open={endModalOpen}
        onOk={handleEndConfirm}
        onCancel={() => setEndModalOpen(false)}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 8, opacity: 0.6 }}>请选择了结日期：</div>
        <DatePicker
          value={endDate}
          onChange={(d) => setEndDate(d)}
          style={{ width: '100%', marginBottom: 16 }}
          allowClear={false}
        />
        <div style={{ marginBottom: 8, opacity: 0.6 }}>收益结算（绝对金额）：</div>
        <InputNumber
          value={endPayoff}
          onChange={(v) => setEndPayoff(v)}
          style={{ width: '100%' }}
          min={0}
          precision={2}
          step={1000}
          formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          parser={(val) => (val ? Number(val.replace(/,/g, '')) : 0) as any}
          addonAfter="元"
        />
      </Modal>
    </div>
  )
}
