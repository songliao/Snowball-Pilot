import { useEffect, useState, useCallback } from 'react'
import { Card, Row, Col, Button } from 'antd'
import {
  DollarOutlined,
  SafetyCertificateOutlined,
  SnippetsOutlined,
  ReloadOutlined,
  TrophyOutlined
} from '@ant-design/icons'
import { usePositionStore } from '../stores/positionStore'
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

export default function Dashboard() {
  const { positions, fetchAll } = usePositionStore()
  const [quotes, setQuotes] = useState<Record<string, IndexQuoteData>>({})
  const [quoteLoading, setQuoteLoading] = useState(false)
  // 总览卡片显示的标的（来自标的管理页的置顶选择）
  const [watchCodes, setWatchCodes] = useState<string[]>([])

  useEffect(() => {
    fetchAll()
    loadWatchlist()
  }, [])

  const loadWatchlist = useCallback(async () => {
    try {
      const codes = await window.api.prices.getWatchlist()
      setWatchCodes(codes)
    } catch {
      setWatchCodes([])
    }
  }, [])

  const activePositions = positions.filter((p) => p.status === 'active')
  const activeNotional = activePositions.reduce((sum, p) => sum + p.notional, 0)
  const totalNotional = positions.reduce((sum, p) => sum + p.notional, 0)
  const activeMargin = activePositions.reduce((sum, p) => sum + p.notional * ((p.margin_ratio ?? p.margin_rate) || 0), 0)
  const totalMargin = positions.reduce((sum, p) => sum + p.notional * ((p.margin_ratio ?? p.margin_rate) || 0), 0)
  const activeContracts = activePositions.length
  const totalContracts = positions.length

  // 已了结收益 = 雪球了结收益 + 凤凰派息收益 + 凤凰了结收益
  const isSettled = (p: PositionData) => p.status === 'knocked_out' || p.status === 'matured'
  const parseCouponReceived = (raw?: string): number[] => {
    if (!raw) return []
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.map((x) => Number(x) || 0)
    } catch { /* ignore */ }
    return []
  }
  const snowballSettledGain = positions
    .filter((p) => p.structure_type === 'snowball' && isSettled(p))
    .reduce((s, p) => s + (p.termination_payoff || 0), 0)
  const phoenixSettledGain = positions
    .filter((p) => p.structure_type === 'phoenix' && isSettled(p))
    .reduce((s, p) => s + (p.termination_payoff || 0), 0)
  const phoenixCouponGain = positions
    .filter((p) => p.structure_type === 'phoenix')
    .reduce((s, p) => s + parseCouponReceived(p.coupon_received).reduce((a, x) => a + x, 0), 0)
  const totalSettledGain = snowballSettledGain + phoenixSettledGain + phoenixCouponGain

  // 手动获取所有指数行情（点击刷新按钮才会调用实时行情接口）
  const fetchQuotes = useCallback(async () => {
    if (watchCodes.length === 0) {
      setQuotes({})
      return
    }
    setQuoteLoading(true)
    try {
      const results: Record<string, IndexQuoteData> = {}
      for (const code of watchCodes) {
        const data = await window.api.market.fetchIndexQuote(code)
        if (data) results[code] = data
      }
      setQuotes(results)
    } finally {
      setQuoteLoading(false)
    }
  }, [watchCodes])

  // 打开页面时仅读取系统已存储的行情快照，不调用实时行情接口
  const loadStoredQuotes = useCallback(async () => {
    if (watchCodes.length === 0) {
      setQuotes({})
      return
    }
    setQuoteLoading(true)
    try {
      const codesInfo = await window.api.prices.getCodes()
      const prevMap: Record<string, number> = {}
      codesInfo.forEach((c) => {
        if (prevMap[c.code] == null && c.prevPrice != null) prevMap[c.code] = c.prevPrice
      })
      const results: Record<string, IndexQuoteData> = {}
      await Promise.all(
        watchCodes.map(async (code) => {
          const rec = await window.api.prices.getLatest(code)
          if (!rec) return
          const prevClose = prevMap[code] ?? rec.price
          const change = rec.price - prevClose
          const changePct = prevClose ? (change / prevClose) * 100 : 0
          results[code] = {
            code,
            name: code,
            price: rec.price,
            change,
            changePct,
            open: rec.open ?? rec.price,
            high: rec.high ?? rec.price,
            low: rec.low ?? rec.price,
            prevClose,
            volume: rec.volume ?? 0,
            amount: 0,
            updateTime: rec.date || ''
          }
        })
      )
      setQuotes(results)
    } catch {
      // 无存储数据时保持为空
    } finally {
      setQuoteLoading(false)
    }
  }, [watchCodes])

  // 打开页面读取系统存储的行情快照；实时刷新需手动点击
  useEffect(() => {
    loadStoredQuotes()
  }, [loadStoredQuotes])

  return (
    <div>
      {/* 页面标题（保持卡片原位，仅升级为页面标题，不改变卡片位置） */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>投资总览</h2>
      </div>
      <Row gutter={[12, 12]} style={{ marginTop: -4, marginBottom: 20 }} align="stretch">
        <Col span={6}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
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
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
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
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
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
        <Col span={6}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
            <div className="stat-card-inner">
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>已了结收益</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {formatMoney(totalSettledGain)}
                </div>
                <div style={{ fontSize: 11, opacity: 0.45, fontWeight: 400, marginTop: 4, lineHeight: 1.5 }}>
                  雪球了结 {formatMoney(snowballSettledGain)}<br />
                  凤凰派息 {formatMoney(phoenixCouponGain)} · 凤凰了结 {formatMoney(phoenixSettledGain)}
                </div>
              </div>
              <div className="stat-icon"><TrophyOutlined /></div>
            </div>
          </Card>
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
        {watchCodes.length === 0 ? (
          <Col span={24}>
            <div style={{ fontSize: 12, opacity: 0.4, padding: '12px 0' }}>
              暂未在「标的管理」中收藏任何标的。前往标的管理页，点击标的操作列的「收藏」即可将其添加到此处。
            </div>
          </Col>
        ) : (
          watchCodes.map((code) => {
            const q = quotes[code]
            const up = q ? q.change >= 0 : true
            const color = q ? (up ? '#ef4444' : '#22c55e') : undefined

            return (
              <Col span={6} key={code}>
                <Card className="glass-card index-card" variant="borderless">
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{q?.name || code}</span>
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
          })
        )}
      </Row>
    </div>
  )
}
