import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from 'react'
import dayjs from 'dayjs'
import { Card, Row, Col, Button, Popover, Switch, Segmented, Tag } from 'antd'
import {
  DollarOutlined,
  SafetyCertificateOutlined,
  SnippetsOutlined,
  ReloadOutlined,
  TrophyOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { usePositionStore } from '../stores/positionStore'
import { useAlertSettingsStore } from '../stores/alertSettingsStore'
import { useMarketStore } from '../stores/marketStore'
import { formatMoney } from '../utils/format'
import { computeAlerts, type AlertItem, type AlertReason } from '../utils/alerts'
import type { PositionData } from '../utils/calc'

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

const STRUCTURE_LABEL: Record<string, string> = { snowball: '雪球', phoenix: '凤凰' }
const ALERT_TONE: Record<string, CSSProperties> = {
  danger: { color: 'var(--mc-danger, #f87171)', background: 'rgba(248,113,113,0.14)' },
  warn: { color: '#f59e0b', background: 'rgba(245,158,11,0.14)' },
  info: { color: '#3b82f6', background: 'rgba(59,130,246,0.14)' }
}

export default function Dashboard() {
  const { positions, fetchAll } = usePositionStore()
  const { latestPrices, fetchBatchLatest, hydrateSnapshot } = useMarketStore()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Record<string, IndexQuoteData>>({})
  const [quoteLoading, setQuoteLoading] = useState(false)
  // 总览卡片显示的标的（来自标的管理页的置顶选择）
  const [watchCodes, setWatchCodes] = useState<string[]>([])

  // 自动刷新设置：开关、间隔（秒，最小 10s）、剩余倒计时
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [intervalSec, setIntervalSec] = useState(30)
  const [remaining, setRemaining] = useState(30)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const autoSettingsKey = 'dashboard.autoRefresh'

  // 读取系统已存储的所有标的最新价快照（不调用实时接口），初始化全局 latestPrices
  const loadPrices = useCallback(async () => {
    try {
      const codes = await window.api.prices.getCodes()
      const items = codes
        .filter((c) => typeof c.latestPrice === 'number')
        .map((c) => ({ code: c.code, price: c.latestPrice as number }))
      hydrateSnapshot(items)
    } catch {
      // 无存储数据时保持为空
    }
  }, [hydrateSnapshot])

  useEffect(() => {
    fetchAll()
    loadWatchlist()
    loadPrices()
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

  // 刷新合约预警的标的最新价：拉取所有存续合约标的的实时行情，统一写入全局 latestPrices（与详情页同源）
  const refreshAlertPrices = useCallback(async () => {
    const codes = new Set<string>()
    for (const p of positions) {
      if (p.status === 'knocked_out' || p.status === 'matured') continue
      if (p.underlying_code) codes.add(p.underlying_code)
    }
    if (codes.size === 0) return
    await fetchBatchLatest(Array.from(codes))
  }, [positions, fetchBatchLatest])

  // 统一刷新动作（手动/自动共用）：实时行情 + 合约预警最新价，并重置倒计时
  const doRefresh = useCallback(async () => {
    await fetchQuotes()
    await refreshAlertPrices()
    setRemaining(intervalSec)
  }, [fetchQuotes, refreshAlertPrices, intervalSec])

  // 读取持久化的自动刷新设置
  useEffect(() => {
    try {
      const saved = localStorage.getItem(autoSettingsKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.autoRefresh === 'boolean') setAutoRefresh(parsed.autoRefresh)
        if (typeof parsed.intervalSec === 'number' && parsed.intervalSec >= 10) {
          setIntervalSec(parsed.intervalSec)
        }
      }
    } catch {
      /* ignore */
    }
  }, [])

  // 持久化自动刷新设置（跳过挂载时的首次写入，避免用初始默认值覆盖已保存的值）
  const firstPersist = useRef(true)
  useEffect(() => {
    if (firstPersist.current) {
      firstPersist.current = false
      return
    }
    try {
      localStorage.setItem(autoSettingsKey, JSON.stringify({ autoRefresh, intervalSec }))
    } catch {
      /* ignore */
    }
  }, [autoRefresh, intervalSec, autoSettingsKey])

  // 用 ref 持有最新回调与间隔，避免倒计时定时器频繁重建
  const doRefreshRef = useRef(doRefresh)
  useEffect(() => {
    doRefreshRef.current = doRefresh
  }, [doRefresh])
  const intervalRef = useRef(intervalSec)
  useEffect(() => {
    intervalRef.current = intervalSec
  }, [intervalSec])

  // 倒计时与自动刷新：每秒递减，归零时触发刷新并重新计时
  useEffect(() => {
    if (!autoRefresh) {
      setRemaining(intervalSec)
      return
    }
    setRemaining(intervalSec)
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          doRefreshRef.current()
          return intervalRef.current
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, intervalSec])

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

  // 合约预警：基于最新价（刷新后为实时价）判定并计算，筛选满足临近敲出/派息观察或逼近敲入线的合约
  const alertCfg = useAlertSettingsStore()
  const alerts = useMemo<AlertItem[]>(
    () => computeAlerts(positions, latestPrices, alertCfg),
    [positions, latestPrices, alertCfg]
  )

  // 当日已显示过的预警卡片：当天一旦触发就保留，刷新导致条件不再满足也不移除；次日自动清空
  const alertDayKey = dayjs().format('YYYY-MM-DD')
  const alertShownCache = useRef<{ date: string; items: Record<number, AlertItem> }>({
    date: alertDayKey,
    items: {}
  })
  useEffect(() => {
    if (alertShownCache.current.date !== alertDayKey) {
      alertShownCache.current = { date: alertDayKey, items: {} }
    }
    const items = { ...alertShownCache.current.items }
    for (const a of alerts) items[a.id] = a
    alertShownCache.current = { date: alertDayKey, items }
  }, [alerts, alertDayKey])

  // 用最新的实时价刷新缓存卡片的现价与差距，避免「当日保留」的卡片显示陈旧价格
  const refreshCachedCur = (a: AlertItem, freshCur: number): AlertItem => ({
    ...a,
    cur: freshCur,
    reasons: a.reasons.map((r) => ({
      ...r,
      gap: typeof r.level === 'number' ? (r.level / freshCur - 1) * 100 : r.gap
    }))
  })

  const displayedAlerts = useMemo<AlertItem[]>(() => {
    const map = new Map<number, AlertItem>()
    if (alertShownCache.current.date === alertDayKey) {
      for (const a of Object.values(alertShownCache.current.items)) {
        const freshCur = latestPrices[a.code]
        map.set(a.id, typeof freshCur === 'number' ? refreshCachedCur(a, freshCur) : a)
      }
    }
    for (const a of alerts) map.set(a.id, a)
    return Array.from(map.values())
  }, [alerts, alertDayKey, latestPrices])

  return (
    <div>
      {/* 页面标题（保持卡片原位，仅升级为页面标题，不改变卡片位置） */}
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>投资总览</h2>
      </div>
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }} align="stretch">
        <Col span={6}>
          <Card className="stat-card glass-card" variant="borderless" style={{ height: '100%' }}>
            <div className="stat-card-inner">
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>名义本金</div>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
                  {formatMoney(activeNotional)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.45, fontWeight: 400, marginTop: 2, whiteSpace: 'nowrap' }}>
                  {formatMoney(totalNotional)}
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
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
                  {formatMoney(activeMargin)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.45, fontWeight: 400, marginTop: 2, whiteSpace: 'nowrap' }}>
                  {formatMoney(totalMargin)}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>市场行情</span>
        {autoRefresh && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 90,
                height: 4,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.12)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(remaining / intervalSec) * 100}%`,
                  background: '#38bdf8',
                  transition: 'width 1s linear'
                }}
              />
            </div>
            <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: 'tabular-nums', minWidth: 28 }}>
              {remaining}s
            </span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <Popover
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          trigger="click"
          placement="bottomRight"
          content={
            <div style={{ width: 220 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600 }}>自动刷新</span>
                <Switch checked={autoRefresh} onChange={(v) => setAutoRefresh(v)} />
              </div>
              <Segmented
                block
                value={intervalSec}
                onChange={(v) => setIntervalSec(v as number)}
                options={[
                  { label: '10秒', value: 10 },
                  { label: '30秒', value: 30 },
                  { label: '1分', value: 60 },
                  { label: '5分', value: 300 }
                ]}
              />
            </div>
          }
        >
          <Button
            type="text"
            size="small"
            icon={<ClockCircleOutlined style={{ color: autoRefresh ? '#38bdf8' : undefined }} />}
            style={{ opacity: autoRefresh ? 1 : 0.5 }}
          />
        </Popover>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={quoteLoading} />}
          onClick={() => doRefresh()}
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

      {/* 合约预警 */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>合约预警</span>
        </div>
        {displayedAlerts.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.4, padding: '12px 0' }}>
            当前无触发预警的合约（仅统计已存储行情快照的存续 / 已敲入合约）。
          </div>
        ) : (
          <div>
            {/* 按卡片高度（预警事件数）从低到高排序，每满 3 张另起一行；
                同一行内卡片等高对齐，行与行之间由矮到高递增 */}
            {[...displayedAlerts]
            .sort((x, y) => x.reasons.length - y.reasons.length)
            .reduce<AlertItem[][]>((rows, a) => {
              // 遇到比当前行首张卡片更高的卡片就另起一行：
              // 矮卡片聚成一排，高卡片独占新行
              const cur = rows[rows.length - 1]
              if (!cur || cur.length > 0 && a.reasons.length > cur[0].reasons.length) {
                rows.push([a])
              } else {
                cur.push(a)
              }
              return rows
            }, [])
            .map((row, ri) => (
              <div
                key={ri}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: ri === 0 ? 0 : 12, alignItems: 'flex-start' }}
              >
                {row.map((a) => {
                  return (
                    <div key={a.id} style={{ flex: '0 0 calc((100% - 24px) / 3)', minWidth: 0, display: 'flex' }}>
                  <Card
                    className="glass-card"
                    variant="borderless"
                    hoverable
                    onClick={() => navigate(`/positions/${a.structureType || 'snowball'}/${a.id}`, { state: { from: '/' } })}
                    style={{ border: '1px solid rgba(248,113,113,0.28)', cursor: 'pointer', width: '100%' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {a.title}
                      </span>
                      <Tag className={`structure-tag structure-tag--${a.structureType || 'snowball'}`} style={{ flexShrink: 0 }}>
                        {STRUCTURE_LABEL[a.structureType] || a.structureType}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
                      {a.code} · 现价 {a.cur.toFixed(2)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                      {a.reasons.map((r, i) => {
                        const gapVal = typeof r.gap === 'number' ? r.gap : null
                        const gapTxt =
                          gapVal != null
                            ? `${gapVal >= 0 ? '低于' : '高于'} ${Math.abs(gapVal).toFixed(2)}%`
                            : '—'
                        const toneColor = (ALERT_TONE[r.tone] as CSSProperties).color
                        return (
                          <div
                            key={i}
                            style={{
                              borderLeft: `3px solid ${toneColor}`,
                              paddingLeft: 10
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 600, color: toneColor, marginBottom: 6 }}>
                              {r.label}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>
                                  {r.date && r.date !== '每日观察' ? '日期' : ' '}
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {r.date || '—'}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>点位</div>
                                <div style={{ fontSize: 12, fontWeight: 500 }}>
                                  {typeof r.level === 'number' ? r.level.toFixed(2) : '—'}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>差距</div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: gapVal != null ? (gapVal >= 0 ? '#ef4444' : '#22c55e') : undefined
                                  }}
                                >
                                  {gapTxt}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                </div>
              )
            })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
