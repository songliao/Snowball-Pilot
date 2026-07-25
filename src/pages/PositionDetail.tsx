import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Descriptions, Tag, Button, Space, Timeline, Modal, InputNumber,
  DatePicker, message, Statistic, Row, Col, Popconfirm
} from 'antd'
import {
  ArrowLeftOutlined, EditOutlined, SyncOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import {
  calcPnL, calcHoldingDays, calcDaysToMaturity,
  calcKnockInPrice, calcKnockOutPrice, calcSafetyMargin
} from '../utils/calc'
import { formatMoney, formatPercent, formatDate, STATUS_MAP, EVENT_TYPE_MAP, FREQ_MAP } from '../utils/format'
import PriceChart from '../components/PriceChart'

export default function PositionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { current, fetchById, events, fetchEvents, updateStatus, addEvent } = usePositionStore()
  const { latestPrices, fetchLatestPrice, fetchRemotePrice, fetchPriceHistory, upsertPrice } = useMarketStore()
  const [priceModalOpen, setPriceModalOpen] = useState(false)
  const [manualPrice, setManualPrice] = useState<number>(0)
  const [manualDate, setManualDate] = useState(dayjs())

  useEffect(() => {
    if (id) {
      fetchById(Number(id))
      fetchEvents(Number(id))
    }
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
  const knockInPrice = calcKnockInPrice(pos.initial_price, pos.knock_in_pct)
  const knockOutPrice = calcKnockOutPrice(pos.initial_price, pos.knock_out_pct)
  const safetyMargin = currentPrice ? calcSafetyMargin(currentPrice, knockInPrice) : null
  const { pnl, pnlRate, type } = calcPnL(pos, currentPrice)
  const holdingDays = calcHoldingDays(pos.effective_date)
  const daysToMaturity = calcDaysToMaturity(pos.maturity_date)
  const statusInfo = STATUS_MAP[pos.status] || { label: pos.status, color: 'default' }

  const handleStatusChange = async (status: string) => {
    await updateStatus(pos.id!, status)
    const eventType = status === 'knocked_in' ? 'knock_in' : status === 'knocked_out' ? 'knock_out' : 'maturity'
    await addEvent({
      position_id: pos.id!,
      event_type: eventType,
      event_date: dayjs().format('YYYY-MM-DD'),
      description: `状态变更为：${STATUS_MAP[status]?.label || status}`
    })
    message.success('状态已更新')
    fetchById(pos.id!)
  }

  const handleManualPrice = async () => {
    if (!manualPrice || manualPrice <= 0) {
      message.warning('请输入有效价格')
      return
    }
    await upsertPrice(pos.underlying_code, manualPrice, manualDate.format('YYYY-MM-DD'))
    setPriceModalOpen(false)
    message.success('价格已更新')
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
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space align="center" size={12}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/positions')}
            style={{ width: 32, height: 32, padding: 0, borderRadius: 6 }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{pos.product_name}</span>
              <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
            </div>
            <div style={{ fontSize: 13, opacity: 0.45, marginTop: 2 }}>
              {pos.underlying} · {pos.broker || '未知券商'}
            </div>
          </div>
        </Space>
        <Space>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/positions/${pos.id}/edit`)}>
            编辑
          </Button>
          {pos.status === 'active' && (
            <>
              <Popconfirm title="确认标记为已敲入？" onConfirm={() => handleStatusChange('knocked_in')}>
                <Button danger icon={<WarningOutlined />}>敲入</Button>
              </Popconfirm>
              <Popconfirm title="确认标记为已敲出？" onConfirm={() => handleStatusChange('knocked_out')}>
                <Button icon={<CheckCircleOutlined />} style={{ color: '#52c41a', borderColor: '#52c41a' }}>
                  敲出
                </Button>
              </Popconfirm>
            </>
          )}
          {(pos.status === 'active' || pos.status === 'knocked_in') && (
            <Popconfirm title="确认标记为已到期？" onConfirm={() => handleStatusChange('matured')}>
              <Button icon={<ClockCircleOutlined />}>到期</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      {/* Metrics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card className="stat-card content-card" bordered={false}>
            <Statistic
              title={`浮动盈亏（${type}）`}
              value={pnl}
              precision={2}
              valueStyle={{ color: pnl >= 0 ? '#52c41a' : '#ff4d4f' }}
              prefix={pnl >= 0 ? '+' : ''}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card content-card" bordered={false}>
            <Statistic
              title="收益率"
              value={pnlRate}
              precision={2}
              suffix="%"
              valueStyle={{ color: pnlRate >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card content-card" bordered={false}>
            <Statistic title="持有天数" value={holdingDays} suffix="天" />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card content-card" bordered={false}>
            <Statistic
              title="剩余天数"
              value={Math.max(0, daysToMaturity)}
              suffix="天"
              valueStyle={{ color: daysToMaturity <= 7 ? '#ff4d4f' : daysToMaturity <= 30 ? '#faad14' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      {/* Contract Details */}
      <Card
        title="合约要素"
        bordered={false}
        className="content-card"
        style={{ marginBottom: 24 }}
      >
        <Descriptions bordered column={3} size="small">
          <Descriptions.Item label="券商">{pos.broker || '—'}</Descriptions.Item>
          <Descriptions.Item label="标的资产">{pos.underlying}</Descriptions.Item>
          <Descriptions.Item label="标的代码">{pos.underlying_code || '—'}</Descriptions.Item>
          <Descriptions.Item label="名义本金">
            <span style={{ fontWeight: 500 }}>{formatMoney(pos.notional)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="年化票息率">
            <span style={{ fontWeight: 500 }}>{formatPercent(pos.coupon_rate)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="观察频率">{FREQ_MAP[pos.observation_freq] || pos.observation_freq}</Descriptions.Item>
          <Descriptions.Item label="交易日期">{formatDate(pos.trade_date)}</Descriptions.Item>
          <Descriptions.Item label="生效日期">{formatDate(pos.effective_date)}</Descriptions.Item>
          <Descriptions.Item label="到期日">{formatDate(pos.maturity_date)}</Descriptions.Item>
          <Descriptions.Item label="期初价格">
            <span style={{ fontWeight: 500 }}>{pos.initial_price.toFixed(2)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="敲入价格">
            <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{knockInPrice.toFixed(2)}</span>
            <span style={{ opacity: 0.45, marginLeft: 4, fontSize: 12 }}>({formatPercent(pos.knock_in_pct, 0)})</span>
          </Descriptions.Item>
          <Descriptions.Item label="敲出价格">
            <span style={{ color: '#52c41a', fontWeight: 500 }}>{knockOutPrice.toFixed(2)}</span>
            <span style={{ opacity: 0.45, marginLeft: 4, fontSize: 12 }}>({formatPercent(pos.knock_out_pct, 0)})</span>
          </Descriptions.Item>
          <Descriptions.Item label="当前价格">
            <Space>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {currentPrice ? currentPrice.toFixed(2) : '未录入'}
              </span>
              <Button size="small" icon={<SyncOutlined />} onClick={handleFetchPrice}>拉取</Button>
              <Button size="small" onClick={() => setPriceModalOpen(true)}>手动</Button>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="安全垫">
            {safetyMargin !== null ? (
              <span style={{
                color: safetyMargin < 0.05 ? '#ff4d4f' : safetyMargin < 0.1 ? '#faad14' : '#52c41a',
                fontWeight: 600
              }}>
                {formatPercent(safetyMargin, 1)}
              </span>
            ) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="备注">{pos.notes || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Chart + Events */}
      <Row gutter={[16, 16]}>
        <Col span={16}>
          <Card title="价格走势" bordered={false} className="content-card">
            <PriceChart
              code={pos.underlying_code}
              knockInPrice={knockInPrice}
              knockOutPrice={knockOutPrice}
              initialPrice={pos.initial_price}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="事件记录" bordered={false} className="content-card">
            {events.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', opacity: 0.35 }}>
                暂无事件记录
              </div>
            ) : (
              <Timeline
                items={events.map((e) => {
                  const info = EVENT_TYPE_MAP[e.event_type] || { label: e.event_type, color: 'blue' }
                  return {
                    color: info.color === 'orange' ? 'orange' : info.color === 'green' ? 'green' : 'blue',
                    children: (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={info.color}>{info.label}</Tag>
                          <span style={{ opacity: 0.45, fontSize: 12 }}>{formatDate(e.event_date)}</span>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13, opacity: 0.65 }}>{e.description}</div>
                      </div>
                    )
                  }
                })}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Price Modal */}
      <Modal
        title="手动录入价格"
        open={priceModalOpen}
        onOk={handleManualPrice}
        onCancel={() => setPriceModalOpen(false)}
        okText="确认"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>日期</div>
            <DatePicker value={manualDate} onChange={(v) => v && setManualDate(v)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>价格</div>
            <InputNumber
              value={manualPrice}
              onChange={(v) => setManualPrice(v || 0)}
              min={0}
              step={0.01}
              precision={2}
              style={{ width: '100%' }}
              placeholder={`敲入价: ${knockInPrice.toFixed(2)} / 敲出价: ${knockOutPrice.toFixed(2)}`}
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
