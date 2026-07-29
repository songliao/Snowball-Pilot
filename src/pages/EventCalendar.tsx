import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useThemeStore } from '../stores/themeStore'
import { useCalendarStore } from '../stores/calendarStore'
import type { PositionData } from '../utils/calc'

type EventType = 'ko' | 'coupon'

interface CalEvent {
  key: string
  date: string // YYYY-MM-DD
  type: EventType
  positionId: number
  productName: string
  underlying: string
  contractNo: string
  status: string
  structureType?: string
  // 敲出：障碍比例（百分比）；派息：派息率（百分比）
  barrier?: number
  couponRate?: number
}

const parseList = <T,>(raw?: string): T[] => {
  if (!raw) return []
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) ? (a as T[]) : []
  } catch {
    return []
  }
}

const koStyle = {
  color: '#22c55e',
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid rgba(34,197,94,0.28)'
}
const couponStyle = {
  color: '#3b82f6',
  background: 'rgba(59,130,246,0.12)',
  border: '1px solid rgba(59,130,246,0.28)'
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

// 结构类型 → 展示标签
const STRUCTURE_LABEL: Record<string, string> = {
  snowball: '雪球',
  phoenix: '凤凰'
}
// 结构类型 → 标签配色（文字色 / 背景色）
const STRUCTURE_COLOR: Record<string, { color: string; bg: string }> = {
  snowball: { color: '#38bdf8', bg: 'rgba(56,189,248,0.16)' },
  phoenix: { color: '#f59e0b', bg: 'rgba(245,158,11,0.16)' }
}

// 轻量自绘月历：紧凑、无多余留白，事件可点击跳转
function MiniMonthCalendar({
  value,
  onSelect,
  onNavigate,
  eventsByDate,
  onEventClick
}: {
  value: Dayjs
  onSelect: (d: Dayjs) => void
  onNavigate: (m: Dayjs) => void
  eventsByDate: Map<string, CalEvent[]>
  onEventClick: (positionId: number) => void
}) {
  const today = dayjs()
  const start = value.startOf('month')
  // 以周一为每周起点
  const leading = (start.day() + 6) % 7
  const gridStart = start.subtract(leading, 'day')
  const cells = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'))

  const renderEvents = (dateStr: string) => {
    const list = eventsByDate.get(dateStr) || []
    if (!list.length) return null
    const first = list[0]
    return (
      <div
        className="mini-cal-dots"
        title={list
          .map(
            (e) =>
              `${(e.productName || e.contractNo) || '事件'}（${e.type === 'ko' ? '敲出' : '派息'}）`
          )
          .join('、')}
        onClick={(e) => {
          e.stopPropagation()
          onEventClick(first.positionId)
        }}
      >
        {list.slice(0, 3).map((e) => (
          <span
            key={e.key}
            className="mini-cal-dot"
            style={e.type === 'ko' ? koStyle : couponStyle}
          />
        ))}
        {list.length > 3 && <span className="mini-cal-more">{list.length - 3}</span>}
      </div>
    )
  }

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <div className="mini-cal-title">{value.format('YYYY 年 M 月')}</div>
        <div className="mini-cal-nav">
          <button className="mini-cal-nav-btn" onClick={() => onNavigate(value.subtract(1, 'month'))} aria-label="上个月">
            ‹
          </button>
          <button className="mini-cal-nav-today" onClick={() => onNavigate(dayjs())}>今天</button>
          <button className="mini-cal-nav-btn" onClick={() => onNavigate(value.add(1, 'month'))} aria-label="下个月">
            ›
          </button>
        </div>
      </div>
      <div className="mini-cal-weekrow">
        {WEEKDAYS.map((w) => (
          <div key={w} className="mini-cal-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="mini-cal-grid">
        {cells.map((d) => {
          const dateStr = d.format('YYYY-MM-DD')
          const inMonth = d.isSame(value, 'month')
          const isToday = d.isSame(today, 'day')
          return (
            <div
              key={dateStr}
              className={
                'mini-cal-cell' +
                (inMonth ? '' : ' is-out') +
                (isToday ? ' is-today' : '')
              }
              onClick={() => onSelect(d)}
            >
              <div className="mini-cal-date">{d.date()}</div>
              {renderEvents(dateStr)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function EventCalendar() {
  const { positions, fetchAll } = usePositionStore()
  const isDark = useThemeStore((s) => s.mode) === 'dark'
  const navigate = useNavigate()
  // 视图状态从 store 读取，避免跳转持仓详情再返回时重置为初始月
  // 选择器只取稳定字符串，Dayjs 在渲染体内转换，避免每次返回新对象导致重复渲染
  const curMonthStr = useCalendarStore((s) => s.curMonth)
  const curMonth = dayjs(curMonthStr)
  const selectedDateStr = useCalendarStore((s) => s.selectedDate)
  const selectedDate = selectedDateStr ? dayjs(selectedDateStr) : null
  const setCurMonth = useCalendarStore((s) => s.setCurMonth)
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 从持仓自动派生事件：敲出观察日（雪球/凤凰） + 派息观察日（凤凰）
  // 已了结（敲出/到期）持仓的观察日均在过去，默认不展示；仅展示存续 / 已敲入持仓
  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = []
    positions.forEach((p: PositionData) => {
      if (p.status === 'knocked_out' || p.status === 'matured') return
      const koDates = parseList<string>(p.knock_out_dates)
      const koBarriers = parseList<number>(p.knock_out_barriers)
      koDates.forEach((d, i) => {
        if (!d) return
        if (dayjs(d).isBefore(dayjs(), 'day')) return
        list.push({
          key: `${p.id}-ko-${i}`,
          date: dayjs(d).format('YYYY-MM-DD'),
          type: 'ko',
          positionId: p.id!,
          productName: p.product_name || '',
          underlying: p.underlying_code || '',
          contractNo: p.contract_no || '',
          status: p.status || '',
          structureType: p.structure_type || '',
          barrier: koBarriers[i]
        })
      })
      const cpDates = parseList<string>(p.coupon_dates)
      cpDates.forEach((d, i) => {
        if (!d) return
        if (dayjs(d).isBefore(dayjs(), 'day')) return
        list.push({
          key: `${p.id}-cp-${i}`,
          date: dayjs(d).format('YYYY-MM-DD'),
          type: 'coupon',
          positionId: p.id!,
          productName: p.product_name || '',
          underlying: p.underlying_code || '',
          contractNo: p.contract_no || '',
          status: p.status || '',
          structureType: p.structure_type || '',
          couponRate: p.coupon_rate != null ? p.coupon_rate * 100 : undefined
        })
      })
    })
    return list
  }, [positions])

  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    events.forEach((e) => {
      const arr = m.get(e.date)
      if (arr) arr.push(e)
      else m.set(e.date, [e])
    })
    return m
  }, [events])

  // 当前展示月份的事件，按日期排序
  const monthEvents = useMemo(
    () =>
      events
        .filter((e) => e.date.startsWith(curMonth.format('YYYY-MM')))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [events, curMonth]
  )
  const monthKo = monthEvents.filter((e) => e.type === 'ko')
  const monthCoupon = monthEvents.filter((e) => e.type === 'coupon')

  // 选中某天时，右侧展示那一日的事件；否则展示整月
  const dayEvents = useMemo(() => {
    if (!selectedDate) return []
    const ds = selectedDate.format('YYYY-MM-DD')
    return events
      .filter((e) => e.date === ds)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }, [events, selectedDate])
  const dayKo = dayEvents.filter((e) => e.type === 'ko')
  const dayCoupon = dayEvents.filter((e) => e.type === 'coupon')

  const activeKo = selectedDate ? dayKo : monthKo
  const activeCoupon = selectedDate ? dayCoupon : monthCoupon
  const selLabel = selectedDate ? selectedDate.format('M 月 D 日') : '当月'

  return (
    <div>
      <div
        className="page-header"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}
      >
        <h2 style={{ margin: 0 }}>事件日历</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#22c55e' }} />
            敲出观察
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#3b82f6' }} />
            派息观察
          </span>
        </div>
      </div>

      {/* 三列：日历 | 当月敲出事件 | 当月派息事件 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr 1fr',
          gap: 16,
          alignItems: 'start',
          marginTop: 4
        }}
      >
        <div className="glass-card content-card" style={{ marginBottom: 0, padding: 12 }}>
          <MiniMonthCalendar
            value={curMonth}
            onSelect={(d) => {
              setCurMonth(d)
              setSelectedDate(d)
            }}
            onNavigate={(m) => {
              setCurMonth(m)
              setSelectedDate(null)
            }}
            eventsByDate={eventsByDate}
            onEventClick={(id) => navigate(`/positions/${id}`, { state: { from: '/events' } })}
          />
        </div>

        <div className="glass-card content-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#22c55e' }} />
            {selLabel}敲出观察
            <span
              className="count-badge"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
            >
              {activeKo.length}
            </span>
            {selectedDate && (
              <button
                onClick={() => setSelectedDate(null)}
                style={{ marginLeft: 'auto', fontSize: 11, color: '#3b82f6', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                查看整月
              </button>
            )}
          </div>
          {activeKo.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.4 }}>{selectedDate ? '当日无敲出观察事件' : '本月无敲出观察事件'}</div>
          ) : (
            activeKo.map((e) => (
              <div
                key={e.key}
                onClick={() => navigate(`/positions/${e.positionId}`, { state: { from: '/events' } })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, cursor: 'pointer' }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>{e.productName || e.contractNo}</span>
                    {e.structureType && (
                      <span
                        className="struct-tag"
                        style={{
                          color: (STRUCTURE_COLOR[e.structureType] || {}).color || 'var(--mc-accent, #93c5fd)',
                          background: (STRUCTURE_COLOR[e.structureType] || {}).bg || 'var(--mc-accent-bg, rgba(96,165,250,0.16))'
                        }}
                      >
                        {STRUCTURE_LABEL[e.structureType] || e.structureType}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>
                    {e.underlying}
                    {e.barrier != null ? ` · 障碍 ${e.barrier.toFixed(2)}%` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>{e.date.slice(5)}</div>
              </div>
            ))
          )}
        </div>

        <div className="glass-card content-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#3b82f6' }} />
            {selLabel}派息观察
            <span
              className="count-badge"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}
            >
              {activeCoupon.length}
            </span>
            {selectedDate && (
              <button
                onClick={() => setSelectedDate(null)}
                style={{ marginLeft: 'auto', fontSize: 11, color: '#3b82f6', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                查看整月
              </button>
            )}
          </div>
          {activeCoupon.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.4 }}>{selectedDate ? '当日无派息观察事件' : '本月无派息观察事件'}</div>
          ) : (
            activeCoupon.map((e) => (
              <div
                key={e.key}
                onClick={() => navigate(`/positions/${e.positionId}`, { state: { from: '/events' } })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, cursor: 'pointer' }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>{e.productName || e.contractNo}</span>
                    {e.structureType && (
                      <span
                        className="struct-tag"
                        style={{
                          color: (STRUCTURE_COLOR[e.structureType] || {}).color || 'var(--mc-accent, #93c5fd)',
                          background: (STRUCTURE_COLOR[e.structureType] || {}).bg || 'var(--mc-accent-bg, rgba(96,165,250,0.16))'
                        }}
                      >
                        {STRUCTURE_LABEL[e.structureType] || e.structureType}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>
                    {e.underlying}
                    {e.couponRate != null ? ` · 派息率 ${e.couponRate.toFixed(2)}%` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>{e.date.slice(5)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
