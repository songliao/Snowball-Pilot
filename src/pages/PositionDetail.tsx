import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  Card, Tag, Button, Space, message, Row, Col, Popconfirm, Modal, DatePicker, InputNumber
} from 'antd'
import {
  ArrowLeftOutlined, EditOutlined, SyncOutlined,
  WarningOutlined, DollarOutlined, ClockCircleOutlined, RollbackOutlined,
  PlusOutlined, GiftOutlined, BarChartOutlined, ProfileOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { computeKnockOutProfit } from '../utils/calc'
import { formatDate, STATUS_MAP } from '../utils/format'
import PositionForm from './PositionForm'
import PositionDiagram from '../components/PositionDiagram'

function parseJsonArray<T>(s: string | null | undefined): T[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default function PositionDetail() {
  const { id, type } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { current, fetchById, updateStatus, update } = usePositionStore()
  const { latestPrices, prices, fetchLatestPrice, fetchRemotePrice, fetchPriceHistory } = useMarketStore()
  const [kiModalOpen, setKiModalOpen] = useState(false)
  const [kiDate, setKiDate] = useState<dayjs.Dayjs | null>(dayjs())
  const [flipped, setFlipped] = useState(false)
  const [endModalOpen, setEndModalOpen] = useState(false)
  const [endAction, setEndAction] = useState<'knocked_out' | 'matured'>('knocked_out')
  const [endDate, setEndDate] = useState<dayjs.Dayjs | null>(dayjs())
  const [endPayoff, setEndPayoff] = useState<number | null>(null)
  const [couponModalOpen, setCouponModalOpen] = useState(false)
  const [couponDate, setCouponDate] = useState<dayjs.Dayjs | null>(dayjs())
  const [couponAmount, setCouponAmount] = useState<number | null>(null)

  useEffect(() => {
    if (id) fetchById(Number(id), type)
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
  // 今天及之后（含今天）最近的敲出观察日，及其对应障碍价与票息；过去的观察日不计入
  const today = dayjs().startOf('day')
  let nearestKoIdx = -1
  let nearestKoDiff = Infinity
  koDates.forEach((d, i) => {
    const date = dayjs(d).startOf('day')
    if (date.isBefore(today)) return
    const diff = date.diff(today, 'day')
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

  // 凤凰：最近派息观察日，及其对应障碍价与派息率
  const isPhoenix = pos.structure_type === 'phoenix'
  const couponDates = pos.coupon_dates ? (JSON.parse(pos.coupon_dates) as string[]) : []
  let nearestCpnIdx = -1
  let nearestCpnDiff = Infinity
  couponDates.forEach((d, i) => {
    const date = dayjs(d).startOf('day')
    if (date.isBefore(today)) return
    const diff = date.diff(today, 'day')
    if (diff < nearestCpnDiff) {
      nearestCpnDiff = diff
      nearestCpnIdx = i
    }
  })
  const nearestCpnDate = nearestCpnIdx >= 0 ? couponDates[nearestCpnIdx] : null
  const couponBarrierPrice =
    pos.coupon_barrier != null && pos.initial_price
      ? pos.initial_price * pos.coupon_barrier
      : null
  const cpnRemainingDays =
    nearestCpnDate != null
      ? Math.max(0, dayjs(nearestCpnDate).startOf('day').diff(dayjs().startOf('day'), 'day'))
      : null
  const cpnGapPct =
    couponBarrierPrice != null && currentPrice
      ? (couponBarrierPrice / currentPrice - 1) * 100
      : null
  const couponRatePct = pos.coupon_rate != null ? pos.coupon_rate * 100 : null
  const couponEstAmount =
    pos.notional != null && pos.coupon_rate != null ? pos.notional * pos.coupon_rate : null
  // 预计派息收益（仅下一期）：派息金额 - 当期交易费用
  // 派息金额 = 派息率 × 名义本金；当期交易费用 = 派息金额 × 收益分红
  const cpnGrossAmount = couponEstAmount
  const couponFee = couponEstAmount != null ? couponEstAmount * (pos.income_dividend_pct ?? 0) : null
  const couponNet = couponEstAmount != null ? couponEstAmount * (1 - (pos.income_dividend_pct ?? 0)) : null
  // 敲入预警：敲入障碍价格、观察方式、观察日、自然日天数、距离敲入距离
  const kiBarrierPct = pos.knock_in_barrier
  const kiBarrierPrice =
    kiBarrierPct != null && pos.initial_price
      ? pos.initial_price * kiBarrierPct
      : null
  const kiObserveMode = pos.knock_in_observation // 'daily' 每日 / 'maturity' 到期
  // 合约到期日 = 最后一个敲出观察日（无论敲入观察方式）
  const maturityDate = koDates.length ? koDates[koDates.length - 1] : null
  // 到期观察的敲入观察日 = 到期日；每日观察无固定观察日（不展示）
  const kiObserveDate = kiObserveMode === 'maturity' ? maturityDate : null
  // 剩余自然日：从今天到合约到期日的自然日天数（每日/到期观察都展示）
  const kiNatDays = maturityDate != null
    ? dayjs(maturityDate).startOf('day').diff(dayjs().startOf('day'), 'day')
    : null
  // 距离敲入距离 = 敲入障碍价格 / 现价 - 1（负=尚未敲入，正=已敲入）
  const kiGapPct =
    kiBarrierPrice != null && currentPrice
      ? (kiBarrierPrice / currentPrice - 1) * 100
      : null
  // 指标卡片列宽：按卡片数铺满整行（雪球 3 张 lg=8，凤凰 4 张 lg=6），两行均无空隙
  const metricColProps = isPhoenix
    ? { xs: 24, sm: 12, md: 8, lg: 6 }
    : { xs: 24, sm: 12, lg: 8 }
  // 图示卡片列宽：雪球(8列小卡)三张=24列满宽；凤凰(6列小卡)三张=18列
  const diagramColProps = isPhoenix
    ? { xs: 24, sm: 24, md: 18, lg: 18 }
    : { xs: 24, sm: 24, md: 24, lg: 24 }

  const handleStatusChange = async (status: string, kiDateStr?: string) => {
    await updateStatus(
      pos.id!,
      status,
      pos.structure_type,
      status === 'knocked_in' ? true : undefined,
      kiDateStr
    )
    message.success('状态已更新')
    fetchById(pos.id!, pos.structure_type)
  }

  const handleKiConfirm = async () => {
    setKiModalOpen(false)
    const dateStr = kiDate ? kiDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    await handleStatusChange('knocked_in', dateStr)
  }

  const handleRevokeKnockIn = async () => {
    await updateStatus(pos.id!, 'active', pos.structure_type, false)
    message.success('已撤回敲入状态')
    fetchById(pos.id!, pos.structure_type)
  }

  const handleRevokeEnd = async () => {
    // 撤销了结：恢复为敲入前（或存续）状态，保留敲入状态与敲入日期，仅清除了结日期/收益
    const prevStatus = pos.is_ki ? 'knocked_in' : 'active'
    await updateStatus(pos.id!, prevStatus, pos.structure_type, undefined, undefined, null, null)
    message.success('已撤销了结')
    fetchById(pos.id!, pos.structure_type)
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
    fetchById(pos.id!, pos.structure_type)
  }

  const handleCouponConfirm = async () => {
    if (!pos) return
    setCouponModalOpen(false)
    const dateStr = couponDate ? couponDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    const amount = Number(couponAmount ?? 0)
    const amountStr = amount.toFixed(2)
    // 派息支付日 与 已派息金额 按索引一一对应
    const pairs = parseJsonArray<string>(pos.coupon_payment_dates).map((d, i) => ({
      d,
      a: parseJsonArray<string>(pos.coupon_received)[i] ?? '0.00'
    }))
    const idx = pairs.findIndex((p) => p.d === dateStr)
    if (idx >= 0) pairs[idx].a = amountStr // 同日重记：更新对应金额
    else pairs.push({ d: dateStr, a: amountStr })
    pairs.sort((x, y) => x.d.localeCompare(y.d))
    await update(pos.id!, {
      structure_type: pos.structure_type,
      coupon_payment_dates: JSON.stringify(pairs.map((p) => p.d)),
      coupon_received: JSON.stringify(pairs.map((p) => p.a))
    })
    message.success('已记录派息')
    setCouponDate(dayjs())
    setCouponAmount(null)
    fetchById(pos.id!, pos.structure_type)
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
            onClick={() => navigate((location.state as { from?: string })?.from || '/positions')}
            style={{ width: 32, height: 32, padding: 0, borderRadius: 6 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{pos.product_name}</span>
            <Tag className={`status-tag status-tag--${pos.status}`}>{statusInfo.label}</Tag>
            <Tag className={`structure-tag structure-tag--${pos.structure_type || 'snowball'}`}>
              {pos.structure_type === 'phoenix' ? '凤凰' : '雪球'}
            </Tag>
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
          {pos.structure_type === 'phoenix' && (
            <Button
              className="action-btn action-btn--coupon"
              icon={<span className="nav-icon-circle nav-icon-circle--coupon"><GiftOutlined /></span>}
              onClick={() => { setCouponDate(dayjs()); setCouponAmount(null); setCouponModalOpen(true) }}
            >
              记录派息
            </Button>
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
          <Button
            className="action-btn"
            icon={<span className="nav-icon-circle nav-icon-circle--diagram">{flipped ? <ProfileOutlined /> : <BarChartOutlined />}</span>}
            onClick={() => setFlipped((v) => !v)}
          >
            {flipped ? '合约详情' : '点位图示'}
          </Button>
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
          <Button className="action-btn" icon={<span className="nav-icon-circle"><EditOutlined /></span>} onClick={() => navigate(`/positions/${pos.structure_type}/${pos.id}/edit`, { state: { from: `/positions/${pos.structure_type}/${pos.id}` } })}>
            编辑合约
          </Button>
        </Space>
      </div>

      {/* Metrics */}
      {(pos.status !== 'knocked_out' && pos.status !== 'matured') && (
      <>
      {/* 行情：单独一行，按钮样式 */}
      <Row style={{ marginBottom: 16, maxWidth: 1480, marginRight: 'auto' }}>
        <Col>
          <Card className="glass-card quote-pill" variant="borderless">
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '2px 6px' }}>
              <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{pos.underlying || pos.underlying_code}</span>
              {currentPrice != null ? (
                <>
                  <span style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
                    {currentPrice.toFixed(2)}
                  </span>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color,
                    background: up ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)',
                    padding: '1px 6px',
                    borderRadius: 4
                  }}>
                    {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>
                    期初 {pos.initial_price?.toFixed(2) ?? '—'}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, opacity: 0.35 }}>未录入</span>
              )}
              <Button size="small" type="text" icon={<SyncOutlined />} onClick={handleFetchPrice} style={{ fontSize: 12, opacity: 0.5, marginLeft: 'auto' }} />
            </div>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 24, maxWidth: 1480, marginRight: 'auto' }}>
        <Col {...metricColProps}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
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
        {isPhoenix ? (
        <>
        <Col {...metricColProps}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>最近派息观察</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 8px' }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>观察日期</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {nearestCpnDate ? formatDate(nearestCpnDate) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>剩余自然日</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {cpnRemainingDays != null ? `${cpnRemainingDays} 天` : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>观察点位</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {couponBarrierPrice != null ? couponBarrierPrice.toFixed(2) : '—'}
                  {pos.coupon_barrier != null && (
                    <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>{Math.round(pos.coupon_barrier * 100)}%</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>
                  {cpnGapPct == null ? '点位差距' : cpnGapPct < 0 ? '当前高于派息障碍价格' : '当前低于派息障碍价格'}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: cpnGapPct == null ? undefined : cpnGapPct < 0 ? '#22c55e' : '#ef4444',
                  }}
                >
                  {cpnGapPct != null ? `${Math.abs(cpnGapPct).toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col {...metricColProps}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>预计派息收益</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {couponNet != null
                ? `¥${couponNet.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                : '—'}
            </div>
            {(cpnGrossAmount != null || couponFee != null) && (
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 10, lineHeight: 1.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>派息金额</span>
                  <span>
                    ¥{(cpnGrossAmount ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>当期交易费用</span>
                  <span>
                    -¥{(couponFee ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                {couponRatePct != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>派息率</span>
                    <span>{couponRatePct.toFixed(4)}%</span>
                  </div>
                )}
              </div>
            )}
          </Card>
        </Col>
        </>
        ) : (
        <Col {...metricColProps}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
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
        )}
        {!pos.is_ki && (
        <Col {...metricColProps}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
            <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 10, fontWeight: 500 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, marginRight: 6, borderRadius: '50%', background: '#ef4444', color: '#fff', fontSize: 11 }}>
                <WarningOutlined />
              </span>
              敲入预警
              <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8, fontWeight: 400 }}>
                {kiObserveMode === 'daily' ? '每日观察' : kiObserveMode === 'maturity' ? '到期观察' : ''}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 8px' }}>
              {kiObserveMode !== 'daily' && (
                <div>
                  <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>敲入观察日</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {kiObserveDate ? formatDate(kiObserveDate) : '—'}
                  </div>
                </div>
              )}
              {kiNatDays != null && (
                <div style={{ gridColumn: kiObserveDate ? undefined : '1 / -1' }}>
                  <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>剩余自然日</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {kiNatDays != null ? `${kiNatDays} 天` : '—'}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>观察点位</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {kiBarrierPrice != null ? kiBarrierPrice.toFixed(2) : '—'}
                  {kiBarrierPct != null && (
                    <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>{(kiBarrierPct * 100).toFixed(2)}%</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>
                  {kiGapPct == null ? '距离敲入' : kiGapPct < 0 ? '当前高于敲入障碍价格' : '当前低于敲入障碍价格'}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: kiGapPct == null ? undefined : kiGapPct < 0 ? '#22c55e' : '#ef4444',
                  }}
                >
                  {kiGapPct != null ? `${Math.abs(kiGapPct).toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
          </Card>
        </Col>
        )}
      </Row>
      </>
      )}

      {(pos.status === 'knocked_out' || pos.status === 'matured') && (
        <Card className="stat-card glass-card" variant="borderless" style={{ marginBottom: 24 }}>
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
      <Row gutter={[16, 16]} style={{ maxWidth: 1480, marginRight: 'auto', marginBottom: 24 }}>
        <Col {...diagramColProps}>
          <div className={`flip-card${flipped ? ' flipped' : ''}`}>
            <div className="flip-card-inner">
              <div className="flip-front">
                <PositionForm readOnly bare />
              </div>
              <div className="flip-back">
                <PositionDiagram pos={pos} currentPrice={currentPrice} priceHistory={priceSeries} />
              </div>
            </div>
          </div>
        </Col>
      </Row>

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

      <Modal
        title="记录派息"
        open={couponModalOpen}
        onOk={handleCouponConfirm}
        onCancel={() => setCouponModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 8, opacity: 0.6 }}>派息支付日：</div>
        <DatePicker
          value={couponDate}
          onChange={(d) => setCouponDate(d)}
          style={{ width: '100%' }}
          allowClear={false}
        />
        <div style={{ marginBottom: 8, opacity: 0.6, marginTop: 16 }}>派息金额（元）：</div>
        <InputNumber
          value={couponAmount}
          onChange={(v) => setCouponAmount(v)}
          style={{ width: '100%' }}
          min={0}
          precision={2}
          step={100}
          formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          parser={(val) => (val ? Number(val.replace(/,/g, '')) : 0) as any}
          addonAfter="元"
          placeholder="实际派发金额"
        />
      </Modal>
  </div>
)
}
