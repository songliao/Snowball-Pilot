import { useEffect, useState, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Card, Table, Button, Popconfirm, Drawer, Space, Empty, message, Modal, Form, Input, Tooltip } from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  StarOutlined,
  StarFilled,
  HistoryOutlined
} from '@ant-design/icons'
import KLineChart from '../components/KLineChart'
import { useThemeStore } from '../stores/themeStore'

interface InstrumentRow {
  code: string
  latestPrice: number
  date: string
  prevPrice: number | null
  priceWeekAgo: number | null
  priceMonthAgo: number | null
  priceYearAgo: number | null
}

interface HistoryRow {
  date: string
  price: number
}

// 解析 #rrggbb 为 [r, g, b]
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
]

// 按比例 t (0~1) 在两个 hex 颜色间插值，返回 #rrggbb
const mixHex = (from: string, to: string, t: number): string => {
  const [r1, g1, b1] = hexToRgb(from)
  const [r2, g2, b2] = hexToRgb(to)
  const c = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)]    .map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// 归一化标的代码：全角字符转半角、去除所有空白。
// 从网页/中文输入法复制的代码常带全角句号「．」或全角字母「ＳＨ」，
// 会被正则校验与 secid 转换当成非法字符，导致「新增标的」失败（看似编码问题，实为字符宽度）。
const normalizeCode = (raw: string): string =>
  (raw || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角 ！..～ → 半角
    .replace(/[　\s]/g, '') // 删除全角/半角空格与所有空白符
    .toUpperCase()
    .trim()

export default function InstrumentManagement() {
  const [data, setData] = useState<InstrumentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerCode, setDrawerCode] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [addForm] = Form.useForm<{ code: string }>()
  // 置顶（显示在总览卡片）的标的集合
  const [watchSet, setWatchSet] = useState<Set<string>>(new Set())

  const isDark = useThemeStore((s) => s.mode === 'dark')
  // Tooltip 浮层样式：以内联样式注入，确保覆盖 antd 默认卡片（避免被其自带样式覆盖）
  const tooltipBodyStyle: CSSProperties = {
    minWidth: 0,
    maxWidth: 280,
    padding: '9px 12px',
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.55,
    letterSpacing: '0.01em',
    color: isDark ? 'rgba(244,244,245,0.78)' : 'rgba(30,30,34,0.72)',
    background: isDark ? '#1f1f23' : '#ffffff',
    border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.08)',
    borderRadius: 8,
    boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.1)'
  }
  const tooltipRootStyle = { '--antd-arrow-background-color': isDark ? '#1f1f23' : '#ffffff' } as CSSProperties

  const loadWatchlist = useCallback(async () => {
    try {
      const codes = await window.api.prices.getWatchlist()
      setWatchSet(new Set(codes))
    } catch {
      setWatchSet(new Set())
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const codes = await window.api.prices.getCodes()
      setData(codes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    loadWatchlist()
  }, [loadData, loadWatchlist])

  // K线抽屉打开时，右上角原生窗口控件会叠在抽屉面板上。
  // 原生 titleBarOverlay 不支持 CSS 过渡，直接切色会显得突兀，
  // 因此用 rAF 在页面底色与抽屉面板色之间做 300ms 缓动插值（与 antd Drawer 动画时长一致）。
  const overlayAnimRef = useRef(0)
  const prevOpenRef = useRef(false)
  useEffect(() => {
    const open = !!drawerCode
    const panelBg = isDark ? '#1f1f23' : '#ffffff'
    const pageBg = isDark ? '#09090b' : '#f5f5f4'
    const symbolColor = isDark ? '#e4e4e7' : '#333333'

    cancelAnimationFrame(overlayAnimRef.current)

    // 初次挂载或仅主题变化（开合状态未变）：直接设为目标色，不做动画
    if (open === prevOpenRef.current) {
      window.api.app.updateTitlebarOverlay(open ? panelBg : pageBg, symbolColor)
      return () => cancelAnimationFrame(overlayAnimRef.current)
    }
    prevOpenRef.current = open

    const from = open ? pageBg : panelBg
    const to = open ? panelBg : pageBg
    const duration = 300
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // easeInOutCubic，与 antd Drawer 的缓动观感接近
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      window.api.app.updateTitlebarOverlay(mixHex(from, to, eased), symbolColor)
      if (t < 1) {
        overlayAnimRef.current = requestAnimationFrame(step)
      }
    }
    overlayAnimRef.current = requestAnimationFrame(step)

    return () => cancelAnimationFrame(overlayAnimRef.current)
  }, [drawerCode, isDark])

  // 离开页面（组件卸载）时还原为页面底色，避免残留抽屉面板色
  useEffect(() => {
    return () => {
      const dark = useThemeStore.getState().mode === 'dark'
      window.api.app.updateTitlebarOverlay(dark ? '#09090b' : '#f5f5f4', dark ? '#e4e4e7' : '#333333')
    }
  }, [])

  const openHistory = (code: string) => {
    setDrawerCode(code)
  }

  const handleDelete = async (code: string) => {
    await window.api.prices.deleteByCode(code)
    // 同步从总览自选列表中移除
    if (watchSet.has(code)) {
      const next = new Set(watchSet)
      next.delete(code)
      setWatchSet(next)
      try {
        await window.api.prices.setWatchlist([...next])
      } catch {
        /* 忽略写入失败，列表已本地更新 */
      }
    }
    message.success(`已删除 ${code} 的全部历史行情`)
    loadData()
  }

  // 置顶/取消置顶：切换该标的在总览卡片中的显示
  const togglePin = async (code: string) => {
    const next = new Set(watchSet)
    const willPin = !next.has(code)
    if (willPin) next.add(code)
    else next.delete(code)
    setWatchSet(next)
    try {
      await window.api.prices.setWatchlist([...next])
      message.success(willPin ? `已收藏 ${code}，将显示在总览` : `已取消收藏 ${code}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('No handler')) {
        message.error('操作失败：主进程未生效，请完全退出并重启本应用后重试')
      } else {
        message.error(`操作失败：${msg}`)
      }
      // 回滚本地状态
      setWatchSet(watchSet)
    }
  }

  // 手动补足全部标的近2年历史数据（覆盖旧数据）
  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const result = await window.api.indexHistory.backfill(730, true)
      const total = result.reduce((sum, r) => sum + r.saved, 0)
      message.success(`历史数据补足完成，共写入 ${total} 条记录（覆盖 ${result.length} 个标的）`)
      loadData()
    } catch (err) {
      message.error('补足历史数据失败，请稍后重试')
    } finally {
      setBackfilling(false)
    }
  }

  // 刷新：补足各标的缺失的至今天的收盘数据（增量，不重建全量历史）
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const result = await window.api.indexHistory.refresh()
      const totalAdded = result.reduce((sum, r) => sum + r.added, 0)
      const touched = result.filter((r) => r.added > 0).length
      message.success(
        touched > 0
          ? `已补足缺失数据 ${totalAdded} 条（涉及 ${touched} 个标的，更新至今天）`
          : '数据已是最新，无需补足'
      )
      loadData()
    } catch (err) {
      message.error('更新失败，请稍后重试')
    } finally {
      setRefreshing(false)
    }
  }

  // 新增标的并即时补足近2年历史数据
  const handleAdd = async () => {
    const values = await addForm.validateFields()
    const code = normalizeCode(values.code)
    setAddLoading(true)
    try {
      const result = await window.api.indexHistory.backfillCode(code, 730)
      if (result.saved > 0) {
        message.success(`已新增标的 ${code}，补足 ${result.saved} 条历史数据`)
        setAddOpen(false)
        addForm.resetFields()
        loadData()
      } else {
        const reason = (result as { reason?: string }).reason
        message.warning(reason || `未获取到 ${code} 的行情：请检查代码格式（6 位数字 + .SH/.SZ，半角）是否正确`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 主进程未重启时会出现 "No handler registered for 'index-history:backfill-code'"
      if (msg.includes('No handler')) {
        message.error('新增标的失败：主进程未生效，请完全退出并重启本应用后重试')
      } else {
        message.error(`新增标的失败：${msg}`)
      }
    } finally {
      setAddLoading(false)
    }
  }

  // 计算涨跌幅数值（基价为空或 0 时返回 null），用于渲染与排序
  const calcPct = (current: number, base: number | null): number | null => {
    if (base == null || base === 0) return null
    return ((current - base) / base) * 100
  }

  // 渲染涨跌幅：基价为空或 0 时显示占位符；A股习惯红涨绿跌
  const renderChangePct = (current: number, base: number | null) => {
    const pct = calcPct(current, base)
    if (pct == null) {
      return <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>
    }
    const up = pct >= 0
    const color = up ? '#cf1322' : '#3f8600'
    return (
      <span style={{ color, fontWeight: 600 }}>
        {up ? '+' : ''}
        {pct.toFixed(2)}%
      </span>
    )
  }

  // 排序比较：null（无数据）统一排在末尾
  const sortByPct = (baseKey: 'prevPrice' | 'priceWeekAgo' | 'priceMonthAgo' | 'priceYearAgo') => (
    a: InstrumentRow,
    b: InstrumentRow
  ) => (calcPct(a.latestPrice, a[baseKey]) ?? -Infinity) - (calcPct(b.latestPrice, b[baseKey]) ?? -Infinity)

  const columns = [
    {
      title: '标的代码',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => (
        <span style={{ fontFamily: 'SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>{code}</span>
      )
    },
    {
      title: '最新价格',
      dataIndex: 'latestPrice',
      key: 'latestPrice',
      align: 'right' as const,
      render: (v: number) => v.toFixed(2)
    },
    {
      title: '涨跌幅',
      key: 'changePct',
      align: 'right' as const,
      sorter: sortByPct('prevPrice'),
      render: (_: unknown, row: InstrumentRow) => renderChangePct(row.latestPrice, row.prevPrice)
    },
    {
      title: '近一周',
      key: 'weekChange',
      align: 'right' as const,
      sorter: sortByPct('priceWeekAgo'),
      render: (_: unknown, row: InstrumentRow) => renderChangePct(row.latestPrice, row.priceWeekAgo)
    },
    {
      title: '近一月',
      key: 'monthChange',
      align: 'right' as const,
      sorter: sortByPct('priceMonthAgo'),
      render: (_: unknown, row: InstrumentRow) => renderChangePct(row.latestPrice, row.priceMonthAgo)
    },
    {
      title: '近一年',
      key: 'yearChange',
      align: 'right' as const,
      sorter: sortByPct('priceYearAgo'),
      render: (_: unknown, row: InstrumentRow) => renderChangePct(row.latestPrice, row.priceYearAgo)
    },
    {
      title: '更新日期',
      dataIndex: 'date',
      key: 'date',
      align: 'right' as const
    },
    {
      title: '操作',
      key: 'action',
      align: 'right' as const,
      render: (_: unknown, row: InstrumentRow) => {
        const pinned = watchSet.has(row.code)
        return (
          <Space size={4}>
            <Button
              type="text"
              size="small"
              className="icon-btn"
              title={pinned ? '取消收藏（从总览移除）' : '收藏到总览'}
              onClick={() => togglePin(row.code)}
            >
              <span className="nav-icon-circle">
                {pinned ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              </span>
            </Button>
            <Button type="text" size="small" className="icon-btn" title="查看历史" onClick={() => openHistory(row.code)}>
              <span className="nav-icon-circle">
                <EyeOutlined />
              </span>
            </Button>
            <Popconfirm
              title="删除该标的全部历史行情？"
              description={`将永久删除 ${row.code} 的全部行情数据`}
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDelete(row.code)}
            >
              <Button type="text" size="small" className="icon-btn" danger title="删除">
                <span className="nav-icon-circle">
                  <DeleteOutlined />
                </span>
              </Button>
            </Popconfirm>
        </Space>
      )
    }
  },
]

  return (
    <div>
      <div
        className="page-header"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}
      >
        <h2 style={{ margin: 0 }}>标的管理</h2>
        <Space align="center">
          <Button
            type="primary"
            style={{ height: 31 }}
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
          >
            新增标的
          </Button>
          <Tooltip
            styles={{ root: tooltipRootStyle, body: tooltipBodyStyle }}
            title="重新拉取并覆盖全部标的近 2 年的完整历史行情数据（耗时较长，会覆盖已有记录）"
          >
            <Button style={{ height: 31, fontWeight: 500 }} icon={<HistoryOutlined spin={backfilling} />} loading={backfilling} onClick={handleBackfill}>
              补足历史数据
            </Button>
          </Tooltip>
          <Tooltip
            styles={{ root: tooltipRootStyle, body: tooltipBodyStyle }}
            title="增量补足各标的缺失的至今天的收盘数据，不重建全量历史（仅补充缺口，已有数据不动）"
          >
            <Button style={{ height: 31, fontWeight: 500 }} icon={<ReloadOutlined spin={refreshing} />} loading={refreshing} onClick={handleRefresh}>
              更新
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Modal
        title="新增标的"
        open={addOpen}
        onOk={handleAdd}
        confirmLoading={addLoading}
        onCancel={() => setAddOpen(false)}
        okText="新增并补足历史"
        cancelText="取消"
        destroyOnClose
      >
        <p className="instrument-hint" style={{ marginTop: 0 }}>
          输入标的代码后，将自动拉取并补足其近 2 年历史行情数据。
        </p>
        <Form form={addForm} layout="vertical" preserve={false}>
          <Form.Item
            name="code"
            label="标的代码"
            rules={[
              { required: true, message: '请输入标的代码' },
              {
                pattern: /^\d{6}\.(SH|SZ)$/,
                message: '格式如 000852.SH（6 位数字 + .SH/.SZ）'
              }
            ]}
          >
            <Input
              placeholder="例如 000852.SH"
              autoComplete="off"
              style={{ fontFamily: 'SFMono-Regular, Menlo, monospace' }}
              onChange={(e) => addForm.setFieldValue('code', normalizeCode(e.target.value))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Card variant="borderless" className="content-card">
        <Table<InstrumentRow>
          rowKey="code"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={data}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无已存历史行情的标的"
              />
            )
          }}
        />
      </Card>

      <Drawer
        title={drawerCode ? `K线走势 · ${drawerCode}` : 'K线走势'}
        placement="right"
        width={900}
        open={!!drawerCode}
        onClose={() => setDrawerCode(null)}
        closeIcon={null}
        destroyOnClose
        // 遮罩透明：避免打开抽屉时窗口其余区域（含右上角控件/侧边栏）被压暗，
        // 造成「亮卡片 vs 暗背景」的色差；点击外部仍可关闭
        styles={{ mask: { background: 'transparent' } }}
      >
        {drawerCode && <KLineChart code={drawerCode} />}
      </Drawer>
    </div>
  )
}
