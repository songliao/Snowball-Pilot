import { useState, useCallback, useMemo } from 'react'
import { Card, Button, Table, Tag, message, Empty, Spin } from 'antd'
import { SearchOutlined, EyeOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
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

type MissedItem = MissedKo | MissedCoupon

const STRUCTURE_LABEL: Record<string, string> = { snowball: '雪球', phoenix: '凤凰' }

// 模块级持久状态
let savedResults: MissedItem[] = []
let savedChecked = false

export default function ContractCheck() {
  const navigate = useNavigate()
  const { positions, fetchAll } = usePositionStore()
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<MissedItem[]>(savedResults)
  const [checked, setChecked] = useState(savedChecked)

  const setResultsAndSave = (v: MissedItem[]) => { savedResults = v; setResults(v) }
  const setCheckedAndSave = (v: boolean) => { savedChecked = v; setChecked(v) }

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
      const getPrices = async (code?: string): Promise<PriceData[]> => {
        if (!code) return []
        if (priceCache.has(code)) return priceCache.get(code)!
        try {
          const data = await window.api.prices.getByCode(code)
          const sorted = [...(data || [])].filter((p) => p.price != null && p.date).sort((a, b) => a.date.localeCompare(b.date))
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
            if (!koDate.isValid() || !koDate.isBefore(today)) continue
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
            if (!cd.isValid() || !cd.isBefore(today)) continue
            if (paidDates.has(dateStr)) continue
            const closePrice = findClosePrice(sortedPrices, cd)
            if (closePrice != null && closePrice >= initialPrice * couponBarrier) {
              missed.push({ type: 'coupon', position: pos, date: dateStr, barrier: couponBarrier * 100, barrierPrice: initialPrice * couponBarrier, closePrice })
            }
          }
        }
      }

      setResultsAndSave(missed)
      setCheckedAndSave(true)

      if (missed.length === 0) {
        message.success('检查完成：所有合约状态正常')
      } else {
        const koCount = missed.filter((m) => m.type === 'ko').length
        const cpCount = missed.filter((m) => m.type === 'coupon').length
        const parts: string[] = []
        if (koCount) parts.push(`${koCount} 个遗漏敲出`)
        if (cpCount) parts.push(`${cpCount} 个遗漏派息`)
        message.warning(`发现 ${parts.join('、')}`)
      }
    } catch (e) {
      message.error('检查过程出错，请重试')
      console.error(e)
    } finally {
      setChecking(false)
    }
  }, [fetchAll])

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
            {r.type === 'ko' ? '敲出' : '派息'}
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
      render: (v: number) => (
        <span style={{ color: '#22c55e', fontWeight: 600 }}>{v.toFixed(2)}</span>
      )
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
        <Button
          type="text" size="small" className="icon-btn" title="查看"
          onClick={() => navigate(`/positions/${r.position.structure_type}/${r.position.id}`, { state: { from: '/contract-check' } })}
        >
          <span className="nav-icon-circle"><EyeOutlined /></span>
        </Button>
      )
    }
  ]

  const koResults = useMemo(() => results.filter((r) => r.type === 'ko'), [results])
  const couponResults = useMemo(() => results.filter((r) => r.type === 'coupon'), [results])

  const mutedText = isDark ? 'rgba(244,244,245,0.5)' : 'rgba(30,30,34,0.5)'

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2>合约检查</h2>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<SearchOutlined />}
          loading={checking}
          onClick={runCheck}
          style={{ height: 32, fontWeight: 500 }}
        >
          开始检查
        </Button>
      </div>

      {!checked && !checking ? (
        <Card className="glass-card" variant="borderless">
          <Empty
            description={
              <span style={{ color: mutedText }}>
                点击「开始检查」扫描所有存续中的合约，<br />
                自动比对历史价格与障碍价，发现遗漏的敲出/派息信号
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
            description="所有合约状态正常，无遗漏敲出或派息信号"
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
            <Card className="glass-card" variant="borderless">
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
        </>
      )}
    </div>
  )
}
