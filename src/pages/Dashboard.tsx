import { useEffect, useState, useCallback } from 'react'
import { Card, Row, Col, Button, Space, message, Popover, InputNumber, Select, List, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  DollarOutlined,
  SafetyCertificateOutlined,
  SnippetsOutlined,
  ReloadOutlined,
  PlusOutlined,
  BellOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { useAlertStore } from '../stores/alertStore'
import { formatMoney } from '../utils/format'

interface IndexQuoteData {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  amount: number
  updateTime: string
}

const INDEX_LIST = [
  { code: '000852.SH', label: '中证1000' },
  { code: '000905.SH', label: '中证500' },
  { code: '000300.SH', label: '沪深300' },
  { code: '000016.SH', label: '上证50' }
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { positions, fetchAll } = usePositionStore()
  const { fetchRemotePrice } = useMarketStore()
  const { alerts, addAlert, removeAlert, checkAlerts } = useAlertStore()
  const [refreshing, setRefreshing] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, IndexQuoteData>>({})
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [alertPrice, setAlertPrice] = useState<number | null>(null)
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above')
  const [popoverCode, setPopoverCode] = useState<string | null>(null)

  useEffect(() => {
    fetchAll()
  }, [])

  const activePositions = positions.filter((p) => p.status === 'active')
  const activeNotional = activePositions.reduce((sum, p) => sum + p.notional, 0)
  const totalNotional = positions.reduce((sum, p) => sum + p.notional, 0)
  const activeMargin = activePositions.reduce((sum, p) => sum + p.notional * (p.margin_rate || 0), 0)
  const totalMargin = positions.reduce((sum, p) => sum + p.notional * (p.margin_rate || 0), 0)
  const activeContracts = activePositions.length
  const totalContracts = positions.length

  // 获取所有指数行情
  const fetchQuotes = useCallback(async () => {
    setQuoteLoading(true)
    try {
      const results: Record<string, IndexQuoteData> = {}
      for (const idx of INDEX_LIST) {
        const data = await window.api.market.fetchIndexQuote(idx.code)
        if (data) results[idx.code] = data
      }
      setQuotes(results)

      // 检查到价提醒
      const prices: Record<string, number> = {}
      for (const [code, q] of Object.entries(results)) {
        prices[code] = q.price
      }
      const triggered = checkAlerts(prices)
      if (triggered.length > 0) {
        for (const a of triggered) {
          const dir = a.direction === 'above' ? '已达到' : '已跌破'
          message.warning(`【到价提醒】${a.label} ${dir} ${a.targetPrice}，当前 ${prices[a.code]?.toFixed(2)}`)
        }
        // 系统通知
        window.api.notification.check()
      }
    } finally {
      setQuoteLoading(false)
    }
  }, [checkAlerts])

  // 判断是否在A股交易时段（周一至周五 9:30-11:30, 13:00-15:00）
  const isTradingTime = useCallback(() => {
    const now = new Date()
    const day = now.getDay()
    if (day === 0 || day === 6) return false
    const h = now.getHours()
    const m = now.getMinutes()
    const t = h * 60 + m
    return (t >= 570 && t <= 690) || (t >= 780 && t <= 900)
  }, [])

  useEffect(() => {
    fetchQuotes()
    if (isTradingTime()) {
      const timer = setInterval(fetchQuotes, 30000)
      return () => clearInterval(timer)
    }
  }, [fetchQuotes, isTradingTime])

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    try {
      const codes = [...new Set(positions.map((p) => p.underlying_code).filter(Boolean))]
      for (const code of codes) {
        await fetchRemotePrice(code)
      }
      await fetchQuotes()
      message.success('行情已更新')
    } catch {
      message.error('行情更新失败')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      {/* 投资一览 */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>投资一览</span>
      </div>
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }} align="middle">
        <Col span={6}>
          <Card className="stat-card glass-card" bordered={false}>
            <div className="stat-card-inner">
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>名义本金</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {formatMoney(activeNotional)}
                  <span style={{ fontSize: 13, opacity: 0.45, fontWeight: 400 }}> / {formatMoney(totalNotional)}</span>
                </div>
              </div>
              <div className="stat-icon"><DollarOutlined /></div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card glass-card" bordered={false}>
            <div className="stat-card-inner">
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>保证金</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {formatMoney(activeMargin)}
                  <span style={{ fontSize: 13, opacity: 0.45, fontWeight: 400 }}> / {formatMoney(totalMargin)}</span>
                </div>
              </div>
              <div className="stat-icon"><SafetyCertificateOutlined /></div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card glass-card" bordered={false}>
            <div className="stat-card-inner">
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>合约数</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {activeContracts}
                  <span style={{ fontSize: 13, opacity: 0.45, fontWeight: 400 }}> / {totalContracts}</span>
                </div>
              </div>
              <div className="stat-icon"><SnippetsOutlined /></div>
            </div>
          </Card>
        </Col>
        <Col span={6} style={{ textAlign: 'right' }}>
          <Space direction="vertical" size={8}>
            <Button className="glass-btn" icon={<ReloadOutlined spin={refreshing} />} onClick={handleRefreshPrices} block>
              刷新行情
            </Button>
            <Button className="glass-btn" icon={<PlusOutlined />} onClick={() => navigate('/positions/new')} block>
              新增持仓
            </Button>
          </Space>
        </Col>
      </Row>

      {/* 宽基指数行情 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>市场行情</span>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={quoteLoading} />}
          onClick={fetchQuotes}
          style={{ opacity: 0.5 }}
        />
      </div>
      <Row gutter={[12, 12]}>
        {INDEX_LIST.map((idx) => {
          const q = quotes[idx.code]
          const up = q ? q.change >= 0 : true
          const color = q ? (up ? '#ef4444' : '#22c55e') : undefined
          const codeAlerts = alerts.filter((a) => a.code === idx.code && a.enabled && !a.triggered)

          const alertContent = (
            <div style={{ width: 220 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Select
                  size="small"
                  value={alertDirection}
                  onChange={setAlertDirection}
                  style={{ width: 90 }}
                  options={[
                    { value: 'above', label: '涨到' },
                    { value: 'below', label: '跌到' }
                  ]}
                />
                <InputNumber
                  size="small"
                  value={alertPrice}
                  onChange={(v) => setAlertPrice(v)}
                  placeholder="目标价"
                  style={{ flex: 1 }}
                  step={10}
                />
              </div>
              <Button
                size="small"
                type="primary"
                block
                disabled={!alertPrice}
                onClick={() => {
                  if (!alertPrice) return
                  addAlert({ code: idx.code, label: idx.label, targetPrice: alertPrice, direction: alertDirection, enabled: true })
                  setAlertPrice(null)
                  setPopoverCode(null)
                  message.success(`已设置${idx.label}到价提醒`)
                }}
              >
                添加提醒
              </Button>
              {codeAlerts.length > 0 && (
                <List
                  size="small"
                  dataSource={codeAlerts}
                  style={{ marginTop: 8 }}
                  renderItem={(a) => (
                    <List.Item
                      style={{ padding: '4px 0', border: 'none' }}
                      actions={[
                        <Button key="del" type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeAlert(a.id)} />
                      ]}
                    >
                      <span style={{ fontSize: 12 }}>
                        {a.direction === 'above' ? '涨到' : '跌到'} {a.targetPrice}
                      </span>
                    </List.Item>
                  )}
                />
              )}
            </div>
          )

          return (
            <Col span={6} key={idx.code}>
              <Card className="glass-card index-card" bordered={false}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{idx.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {codeAlerts.length > 0 && (
                      <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                        {codeAlerts[0].direction === 'above' ? '↑' : '↓'}{codeAlerts[0].targetPrice}
                      </Tag>
                    )}
                    <Popover
                      content={alertContent}
                      title="到价提醒"
                      trigger="click"
                      open={popoverCode === idx.code}
                      onOpenChange={(open) => { setPopoverCode(open ? idx.code : null); if (!open) setAlertPrice(null) }}
                    >
                      <BellOutlined style={{ fontSize: 12, opacity: codeAlerts.length > 0 ? 0.8 : 0.35, cursor: 'pointer' }} />
                    </Popover>
                  </div>
                </div>
                {q ? (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.02em', marginBottom: 4 }}>
                      {q.price.toFixed(2)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color }}>
                        {up ? '+' : ''}{q.change.toFixed(2)}
                      </span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color,
                        background: up ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)',
                        padding: '1px 5px',
                        borderRadius: 3
                      }}>
                        {up ? '+' : ''}{q.changePct.toFixed(2)}%
                      </span>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, opacity: 0.5 }}>
                      <span>高 {q.high.toFixed(2)}</span>
                      <span>低 {q.low.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.35, padding: '8px 0' }}>
                    {quoteLoading ? '加载中...' : '--'}
                  </div>
                )}
              </Card>
            </Col>
          )
        })}
      </Row>
    </div>
  )
}
