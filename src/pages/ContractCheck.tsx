import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Button, Table, Tag, message, Empty, Spin, Modal, Input } from 'antd'
import { SearchOutlined, EyeOutlined, ExclamationCircleOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'
import { useThemeStore } from '../stores/themeStore'
import { STATUS_MAP } from '../utils/format'
import type { PositionData, PriceData } from '../utils/calc'

interface MissedKo {
  type: 'ko'
  position: PositionData
  date: string
  barrier: number
  barrierPrice: number
  closePrice: number
}

interface MissedCoupon {
  type: 'coupon'
  position: PositionData
  date: string
  barrier: number
  barrierPrice: number
  closePrice: number
}

interface FalseKo {
  type: 'false_ko'
  position: PositionData
  date: string
  barrier: number
  barrierPrice: number
  closePrice: number
}

interface FalseCoupon {
  type: 'false_coupon'
  position: PositionData
  date: string
  barrier: number
  barrierPrice: number
  closePrice: number
}

type MissedItem = MissedKo | MissedCoupon | FalseKo | FalseCoupon

const STRUCTURE_LABEL: Record<string, string> = { snowball: '雪球', phoenix: '凤凰' }

const EVENT_LABEL: Record<string, string> = {
  ko: '遗漏敲出',
  coupon: '遗漏派息',
  false_ko: '误记敲出',
  false_coupon: '误记派息',
}

// 安全解析可能双重编码的 JSON 字段（与 calc.ts 的 parseJsonField 保持一致）
function parseField(raw?: string): any {
  if (!raw) return null
  let v: any = raw
  for (let i = 0; i < 3; i++) {
    if (typeof v === 'string') {
      try { v = JSON.parse(v) } catch { break }
    } else break
  }
  return v
}

const fmtCny = (n: number) =>
  `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// 生成检查内容摘要，预填到备注，便于正式操作时参考
function buildCheckSummary(item: MissedItem): string {
  const pos = item.position
  const lines = [
    `合约检查 · ${pos.contract_no || '—'}`,
    `结构：${STRUCTURE_LABEL[pos.structure_type || ''] || pos.structure_type || '—'}（${pos.underlying_code || '—'}）`,
    `事件：${EVENT_LABEL[item.type] || item.type}`,
    `观察日：${dayjs(item.date).format('YYYY-MM-DD')}`,
    `障碍价：${item.barrierPrice.toFixed(2)}（${item.barrier.toFixed(2)}%）`,
    `当日收盘价：${item.closePrice.toFixed(2)}`,
  ]
  if (pos.notional != null) lines.push(`名义本金：${pos.notional.toLocaleString('zh-CN')}`)

  // 金额：派息事件给出派息金额，敲出事件给出敲出票息金额
  if ((item.type === 'coupon' || item.type === 'false_coupon') && pos.coupon_rate != null) {
    const div = 1 - (pos.income_dividend_pct ?? 0)
    const amount = pos.notional != null ? pos.notional * pos.coupon_rate * div : null
    const rateStr = `${(pos.coupon_rate * 100).toFixed(2)}%`
    if (amount != null) {
      const divStr = div !== 1 ? ` ×(1-收益分红 ${((pos.income_dividend_pct ?? 0) * 100).toFixed(2)}%)` : ''
      lines.push(`派息金额：${fmtCny(amount)}（名义本金 × 派息率 ${rateStr}${divStr}）`)
    } else {
      lines.push(`派息率：${rateStr}`)
    }
  }

  if (item.type === 'ko' || item.type === 'false_ko') {
    try {
      const koDates = parseField(pos.knock_out_dates)
      const koCoupons = parseField(pos.knock_out_coupons)
      if (Array.isArray(koDates) && Array.isArray(koCoupons)) {
        const idx = koDates.findIndex(
          (d: string) => dayjs(d).startOf('day').isSame(dayjs(item.date).startOf('day'))
        )
        const koRate = idx >= 0 ? koCoupons[idx] : koCoupons[koCoupons.length - 1]
        if (typeof koRate === 'number') {
          if (pos.notional != null && pos.trade_start_date) {
            const years = Math.max(dayjs(item.date).diff(dayjs(pos.trade_start_date), 'day') / 365, 0)
            const amount = pos.notional * koRate * (years || 1)
            lines.push(
              `敲出票息金额：${fmtCny(amount)}（名义本金 × 票息率 ${(koRate * 100).toFixed(2)}%${
                years ? ` × 持有 ${years.toFixed(2)} 年` : ''
              }）`
            )
          } else {
            lines.push(`敲出票息率：${(koRate * 100).toFixed(2)}%`)
          }
        }
      }
    } catch { /* 忽略金额解析异常，金额仅作备注参考 */ }
  }

  return lines.join('\n')
}

// 模块级持久状态
let savedResults: MissedItem[] = []
let savedChecked = false
let savedDataAsOf: string | null = null

export default function ContractCheck() {
  const navigate = useNavigate()
  const { positions, fetchAll } = usePositionStore()
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<MissedItem[]>(savedResults)
  const [checked, setChecked] = useState(savedChecked)
  const [dataAsOf, setDataAsOf] = useState<string | null>(savedDataAsOf)
  const [remarkTarget, setRemarkTarget] = useState<PositionData | null>(null)
  const [remarkValue, setRemarkValue] = useState('')
  const [remarkSaving, setRemarkSaving] = useState(false)

  const setResultsAndSave = (v: MissedItem[]) => { savedResults = v; setResults(v) }
  const setCheckedAndSave = (v: boolean) => { savedChecked = v; setChecked(v) }
  const setDataAsOfAndSave = (v: string | null) => { savedDataAsOf = v; setDataAsOf(v) }

  function findClosePrice(sortedPrices: PriceData[], target: dayjs.Dayjs): number | null {
    for (const sp of sortedPrices) {
      if (dayjs(sp.date).startOf('day').isSame(target)) return sp.price
    }
    for (let j = sortedPrices.length - 1; j >= 0; j--) {
      if (dayjs(sortedPrices[j].date).startOf('day').isBefore(target)) return sortedPrices[j].price
    }
    return null
  }

  const runCheck = useCallback(async () => {
    setChecking(true)
    setCheckedAndSave(false)
    setResultsAndSave([])

    try {
      await fetchAll()
      const all = usePositionStore.getState().positions
      const today = dayjs().startOf('day')
      const active = all.filter((p) => p.status === 'active' || p.status === 'knocked_in')

      if (!active.length) {
        message.info('没有存续中的合约')
        setCheckedAndSave(true)
        setChecking(false)
        return
      }

      const priceCache = new Map<string, PriceData[]>()
      let dataAsOfDay: dayjs.Dayjs | null = null
      const getPrices = async (code?: string): Promise<PriceData[]> => {
        if (!code) return []
        if (priceCache.has(code)) return priceCache.get(code)!
        try {
          const data = await window.api.prices.getByCode(code)
          const sorted = [...(data || [])].filter((p) => p.price != null && p.date).sort((a, b) => a.date.localeCompare(b.date))
          // 跟踪价格数据最新日期，用于「数据截止日期」提示
          for (const p of sorted) {
            const d = dayjs(p.date)
            if (!dataAsOfDay || d.isAfter(dataAsOfDay)) dataAsOfDay = d
          }
          priceCache.set(code, sorted)
          return sorted
        } catch { priceCache.set(code, []); return [] }
      }

      const missed: MissedItem[] = []

      for (const pos of active) {
        const initialPrice = pos.initial_price
        if (initialPrice == null) continue
        const sortedPrices = await getPrices(pos.underlying_code)
        if (!sortedPrices.length) continue

        // 敲出检查（雪球 + 凤凰）
        if (pos.structure_type === 'snowball' || pos.structure_type === 'phoenix') {
          let koDates: string[] = [], koBarriers: number[] = []
          try {
            koDates = pos.knock_out_dates ? JSON.parse(pos.knock_out_dates) : []
            koBarriers = pos.knock_out_barriers ? JSON.parse(pos.knock_out_barriers) : []
          } catch { /* skip */ }

          for (let i = 0; i < koDates.length; i++) {
            const koDate = dayjs(koDates[i]).startOf('day')
            // 含今天：收盘后今日观察日即可参与检查，无需等到次日
            if (!koDate.isValid() || koDate.isAfter(today)) continue
            const barrierPct = koBarriers[i] ?? koBarriers[koBarriers.length - 1]
            if (barrierPct == null) continue
            const barrierPrice = initialPrice * (barrierPct / 100)
            const closePrice = findClosePrice(sortedPrices, koDate)
            if (closePrice != null && closePrice >= barrierPrice) {
              missed.push({ type: 'ko', position: pos, date: koDates[i], barrier: barrierPct, barrierPrice, closePrice })
            }
          }
        }

        // 派息检查（凤凰）
        if (pos.structure_type === 'phoenix') {
          const couponBarrier = pos.coupon_barrier
          if (couponBarrier == null) continue
          let couponDates: string[] = []
          try { couponDates = pos.coupon_dates ? JSON.parse(pos.coupon_dates) : [] } catch { continue }
          const paidDates = new Set<string>()
          try {
            (pos.coupon_payment_dates ? JSON.parse(pos.coupon_payment_dates) : []).forEach((d: string) => paidDates.add(d))
          } catch { /* 无记录 */ }

          for (const dateStr of couponDates) {
            const cd = dayjs(dateStr).startOf('day')
            // 含今天：收盘后今日派息观察日即可参与检查
            if (!cd.isValid() || cd.isAfter(today)) continue
            if (paidDates.has(dateStr)) continue
            const closePrice = findClosePrice(sortedPrices, cd)
            if (closePrice != null && closePrice >= initialPrice * couponBarrier) {
              missed.push({ type: 'coupon', position: pos, date: dateStr, barrier: couponBarrier * 100, barrierPrice: initialPrice * couponBarrier, closePrice })
            }
          }
        }
      }

      // 误记敲出 + 误记派息检查（遍历全部合约）
      for (const pos of all) {
        const initialPrice = pos.initial_price
        if (initialPrice == null) continue
        const sortedPrices = await getPrices(pos.underlying_code)
        if (!sortedPrices.length) continue

        // 误记敲出：已敲出合约，但所有敲出观察日收盘价均未达标
        if (pos.status === 'knocked_out') {
          let koDates: string[] = [], koBarriers: number[] = []
          try {
            koDates = pos.knock_out_dates ? JSON.parse(pos.knock_out_dates) : []
            koBarriers = pos.knock_out_barriers ? JSON.parse(pos.knock_out_barriers) : []
          } catch { /* skip */ }

          if (koDates.length > 0) {
            let anyMet = false
            let latestRef: { date: string; barrier: number; barrierPrice: number; closePrice: number } | null = null

            for (let i = 0; i < koDates.length; i++) {
              const koDate = dayjs(koDates[i]).startOf('day')
              // 含今天：收盘后今日敲出观察日即可参与误记核验
              if (!koDate.isValid() || koDate.isAfter(today)) continue
              const barrierPct = koBarriers[i] ?? koBarriers[koBarriers.length - 1]
              if (barrierPct == null) continue
              const barrierPrice = initialPrice * (barrierPct / 100)
              const closePrice = findClosePrice(sortedPrices, koDate)
              if (closePrice == null) continue

              if (!latestRef || dayjs(koDates[i]).isAfter(dayjs(latestRef.date))) {
                latestRef = { date: koDates[i], barrier: barrierPct, barrierPrice, closePrice }
              }

              if (closePrice >= barrierPrice) {
                anyMet = true
                break
              }
            }

            if (!anyMet && latestRef) {
              missed.push({ type: 'false_ko', position: pos, ...latestRef })
            }
          }
        }

        // 误记派息：已记录派息但当日收盘价未达 barrier
        if (pos.structure_type === 'phoenix') {
          const couponBarrier = pos.coupon_barrier
          if (couponBarrier == null) continue
          let paymentDates: string[] = []
          try {
            paymentDates = pos.coupon_payment_dates ? JSON.parse(pos.coupon_payment_dates) : []
          } catch { continue }

          for (const dateStr of paymentDates) {
            const pd = dayjs(dateStr).startOf('day')
            // 含今天：收盘后今日派息日即可参与误记核验
            if (!pd.isValid() || pd.isAfter(today)) continue
            const closePrice = findClosePrice(sortedPrices, pd)
            if (closePrice == null) continue
            const barrierPrice = initialPrice * couponBarrier
            if (closePrice < barrierPrice) {
              missed.push({
                type: 'false_coupon',
                position: pos,
                date: dateStr,
                barrier: couponBarrier * 100,
                barrierPrice,
                closePrice,
              })
            }
          }
        }
      }

      setResultsAndSave(missed)
      setCheckedAndSave(true)
      // 以全表最新行情日期为权威截止日期（优先），缺失时回退到本次检查覆盖到的价格日期
      const globalLatest = await window.api.prices.getLatestDate()
      setDataAsOfAndSave(globalLatest || (dataAsOfDay ? dataAsOfDay.format('YYYY-MM-DD') : null))

      if (missed.length === 0) {
        message.success('检查完成：所有合约状态正常')
      } else {
        const koCount = missed.filter((m) => m.type === 'ko').length
        const cpCount = missed.filter((m) => m.type === 'coupon').length
        const fkoCount = missed.filter((m) => m.type === 'false_ko').length
        const fcpCount = missed.filter((m) => m.type === 'false_coupon').length
        const parts: string[] = []
        if (koCount) parts.push(`${koCount} 个遗漏敲出`)
        if (cpCount) parts.push(`${cpCount} 个遗漏派息`)
        if (fkoCount) parts.push(`${fkoCount} 个误记敲出`)
        if (fcpCount) parts.push(`${fcpCount} 个误记派息`)
        message.warning(`发现 ${parts.join('、')}`)
      }
    } catch (e) {
      message.error('检查过程出错，请重试')
      console.error(e)
    } finally {
      setChecking(false)
    }
  }, [fetchAll])

  // 进页面即加载数据截止日期，无需先跑检查
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await window.api.prices.getLatestDate()
        if (!cancelled && d) setDataAsOfAndSave(d)
      } catch { /* 忽略：检查时可重新计算 */ }
    })()
    return () => { cancelled = true }
  }, [])

  // 点击「备注」：先弹窗让用户查看/补充，确认后再写入该合约 notes。
  // 预填检查内容（已有备注则追加去重），用户可在此基础上补充自己的备注。
  const openRemark = (item: MissedItem) => {
    const pos = item.position
    const existing = (pos.notes || '').trim()
    const summary = buildCheckSummary(item)
    const value =
      existing && !existing.includes(summary.trim())
        ? `${existing}\n\n${summary}`
        : (existing || summary)
    setRemarkTarget(pos)
    setRemarkValue(value)
  }

  const saveRemark = async () => {
    if (!remarkTarget) return
    setRemarkSaving(true)
    try {
      // 必须带上 structure_type，否则主进程默认落到 snowball 表，凤凰合约会写空（0 行受影响）
      const ok = await usePositionStore.getState().update(remarkTarget.id, {
        notes: remarkValue,
        structure_type: remarkTarget.structure_type,
      })
      if (ok) {
        // 同步本地 results 中该项的 notes，避免同会话再次点击重复追加
        setResultsAndSave(
          results.map((m) =>
            m.position.id === remarkTarget.id
              ? { ...m, position: { ...m.position, notes: remarkValue } }
              : m
          )
        )
        message.success(`已写入合约 ${remarkTarget.contract_no || '#' + remarkTarget.id} 备注`)
        setRemarkTarget(null)
      } else {
        message.error('备注写入失败')
      }
    } catch (e) {
      console.error(e)
      message.error('备注写入失败')
    } finally {
      setRemarkSaving(false)
    }
  }

  const columns = [
    {
      title: '合约编号',
      key: 'contractNo',
      width: 130,
      render: (_: any, r: MissedItem) => (
        <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{r.position.contract_no || '—'}</span>
      )
    },
    {
      title: '结构类型',
      key: 'structure',
      width: 75,
      render: (_: any, r: MissedItem) => {
        const t = r.position.structure_type || ''
        return <Tag className={`structure-tag structure-tag--${t}`}>{STRUCTURE_LABEL[t] || t}</Tag>
      }
    },
    {
      title: '标的',
      key: 'code',
      width: 100,
      render: (_: any, r: MissedItem) => r.position.underlying_code || '—'
    },
    {
      title: '期初价',
      key: 'initial',
      width: 85,
      render: (_: any, r: MissedItem) => r.position.initial_price?.toFixed(2) ?? '—'
    },
    {
      title: '观察日',
      dataIndex: 'date',
      key: 'date',
      width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD')
    },
    {
      title: '障碍价',
      key: 'barrier',
      width: 110,
      render: (_: any, r: MissedItem) => (
        <span>
          <span style={{ fontSize: 11, opacity: 0.5, marginRight: 4 }}>
            {r.type === 'ko' || r.type === 'false_ko' ? '敲出' : '派息'}
          </span>
          {r.barrierPrice.toFixed(2)}
          <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>{r.barrier.toFixed(2)}%</span>
        </span>
      )
    },
    {
      title: '当日收盘价',
      dataIndex: 'closePrice',
      key: 'close',
      width: 95,
      render: (v: number, _: any, r: MissedItem) => {
        const isFalse = r.type === 'false_ko' || r.type === 'false_coupon'
        return (
          <span style={{ color: isFalse ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{v.toFixed(2)}</span>
        )
      }
    },
    {
      title: '合约状态',
      key: 'status',
      width: 85,
      render: (_: any, r: MissedItem) => {
        const s = r.position.status || ''
        const info = STATUS_MAP[s]
        return <Tag className={`status-tag status-tag--${s}`}>{info?.label || s}</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_: any, r: MissedItem) => (
        <>
          <Button
            type="text" size="small" className="icon-btn" title="查看"
            onClick={() => navigate(`/positions/${r.position.structure_type}/${r.position.id}`, { state: { from: '/contract-check' } })}
          >
            <span className="nav-icon-circle"><EyeOutlined /></span>
          </Button>
          <Button
            type="text" size="small" className="icon-btn" title="备注：查看/补充后写入"
            onClick={() => openRemark(r)}
          >
            <span className="nav-icon-circle"><EditOutlined /></span>
          </Button>
        </>
      )
    }
  ]

  const koResults = useMemo(() => results.filter((r) => r.type === 'ko'), [results])
  const couponResults = useMemo(() => results.filter((r) => r.type === 'coupon'), [results])
  const falseKoResults = useMemo(() => results.filter((r) => r.type === 'false_ko'), [results])
  const falseCouponResults = useMemo(() => results.filter((r) => r.type === 'false_coupon'), [results])

  const mutedText = isDark ? 'rgba(244,244,245,0.5)' : 'rgba(30,30,34,0.5)'

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2>合约检查</h2>
      </div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          className="toolbar-btn"
          icon={<span className="nav-icon-circle nav-icon-circle--add"><SearchOutlined /></span>}
          loading={checking}
          onClick={runCheck}
        >
          开始检查
        </Button>
        {dataAsOf && (
          <span style={{ fontSize: 12, color: mutedText }}>
            价格数据截至 <b style={{ color: isDark ? 'rgba(244,244,245,0.85)' : 'rgba(30,30,34,0.85)' }}>{dataAsOf}</b>
            {dayjs(dataAsOf).isSame(dayjs(), 'day')
              ? '（今日已入库，含今日观察日）'
              : '（今日数据未入库，今日观察日按最近交易日收盘价回退判定）'}
          </span>
        )}
      </div>

      {!checked && !checking ? (
        <Card className="glass-card" variant="borderless">
          <Empty
            description={
              <span style={{ color: mutedText }}>
                点击「开始检查」扫描所有合约，<br />
                自动比对历史价格与障碍价，发现遗漏/误记的敲出与派息信号
              </span>
            }
          />
        </Card>
      ) : checking ? (
        <Card className="glass-card" variant="borderless" style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <p style={{ marginTop: 16, color: mutedText }}>正在检查合约...</p>
        </Card>
      ) : results.length === 0 ? (
        <Card className="glass-card" variant="borderless">
          <Empty
            image={<ExclamationCircleOutlined style={{ fontSize: 48, color: '#22c55e' }} />}
            description="所有合约状态正常，无遗漏或误记的敲出/派息信号"
          />
        </Card>
      ) : (
        <>
          {koResults.length > 0 && (
            <Card className="glass-card" variant="borderless" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 13, color: mutedText }}>
                <Tag color="green" style={{ marginRight: 8 }}>遗漏敲出</Tag>
                共 <span style={{ color: '#ef4444', fontWeight: 600 }}>{koResults.length}</span> 条：
                以下观察日标的价格达到敲出障碍价但未标记敲出
              </div>
              <Table
                dataSource={koResults}
                columns={columns}
                rowKey={(r) => `ko-${r.position.id}-${r.date}`}
                size="middle"
                pagination={false}
                scroll={{ x: 850 }}
              />
            </Card>
          )}
          {couponResults.length > 0 && (
            <Card className="glass-card" variant="borderless" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 13, color: mutedText }}>
                <Tag color="blue" style={{ marginRight: 8 }}>遗漏派息</Tag>
                共 <span style={{ color: '#ef4444', fontWeight: 600 }}>{couponResults.length}</span> 条：
                以下观察日标的价格达到派息障碍价但未记录派息
              </div>
              <Table
                dataSource={couponResults}
                columns={columns}
                rowKey={(r) => `cp-${r.position.id}-${r.date}`}
                size="middle"
                pagination={false}
                scroll={{ x: 850 }}
              />
            </Card>
          )}
          {falseKoResults.length > 0 && (
            <Card className="glass-card" variant="borderless" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 13, color: mutedText }}>
                <Tag color="red" style={{ marginRight: 8 }}>误记敲出</Tag>
                共 <span style={{ color: '#ef4444', fontWeight: 600 }}>{falseKoResults.length}</span> 条：
                以下合约已标记为敲出，但所有敲出观察日收盘价均未达到障碍价
              </div>
              <Table
                dataSource={falseKoResults}
                columns={columns}
                rowKey={(r) => `fko-${r.position.id}-${r.date}`}
                size="middle"
                pagination={false}
                scroll={{ x: 850 }}
              />
            </Card>
          )}
          {falseCouponResults.length > 0 && (
            <Card className="glass-card" variant="borderless">
              <div style={{ marginBottom: 12, fontSize: 13, color: mutedText }}>
                <Tag color="orange" style={{ marginRight: 8 }}>误记派息</Tag>
                共 <span style={{ color: '#ef4444', fontWeight: 600 }}>{falseCouponResults.length}</span> 条：
                以下派息日已记录派息，但当日收盘价未达到派息障碍价
              </div>
              <Table
                dataSource={falseCouponResults}
                columns={columns}
                rowKey={(r) => `fcp-${r.position.id}-${r.date}`}
                size="middle"
                pagination={false}
                scroll={{ x: 850 }}
              />
            </Card>
          )}
        </>
      )}

      <Modal
        className="solid-modal"
        title={`备注 · ${remarkTarget?.contract_no || '—'}`}
        open={!!remarkTarget}
        onCancel={() => setRemarkTarget(null)}
        onOk={saveRemark}
        confirmLoading={remarkSaving}
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          rows={6}
          value={remarkValue}
          onChange={(e) => setRemarkValue(e.target.value)}
          placeholder="检查内容已预填，可查看并补充你自己的备注，保存后写入合约"
        />
      </Modal>
    </div>
  )
}
