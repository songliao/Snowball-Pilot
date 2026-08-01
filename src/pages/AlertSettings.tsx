import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, InputNumber, Button, Divider, Form, Typography, Space, message, Popconfirm, Row, Col, Empty, Tooltip, theme } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, ReloadOutlined, NotificationOutlined, EyeOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useAlertSettingsStore, ALERT_DEFAULTS } from '../stores/alertSettingsStore'
import { usePositionStore } from '../stores/positionStore'
import { useMarketStore } from '../stores/marketStore'
import { computeAlerts, type AlertConfig } from '../utils/alerts'

const { Title } = Typography

const STRUCTURE_LABEL: Record<string, string> = { snowball: '雪球', phoenix: '凤凰' }
const STRUCTURE_COLOR: Record<string, { color: string; bg: string }> = {
  snowball: { color: '#7c3aed', bg: 'rgba(176,124,255,0.18)' },
  phoenix: { color: '#c2410c', bg: 'rgba(255,143,60,0.18)' }
}
const TONE_COLOR: Record<string, string> = {
  danger: '#f87171',
  warn: '#f59e0b',
  info: '#3b82f6'
}

const gapText = (g?: number) =>
  typeof g === 'number' ? `${g >= 0 ? '低于' : '高于'} ${Math.abs(g).toFixed(2)}%` : '—'

export default function AlertSettings() {
  const navigate = useNavigate()
  const { knockOutLeadDays, knockOutNearPct, couponNearPct, knockInNearPct, set, reset } =
    useAlertSettingsStore()
  const { positions, fetchAll } = usePositionStore()
  const { latestPrices, hydrateSnapshot } = useMarketStore()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { token } = theme.useToken()

  const loadPrices = useCallback(async () => {
    try {
      const codes = await window.api.prices.getCodes()
      const items = codes
        .filter((c) => typeof c.latestPrice === 'number')
        .map((c) => ({ code: c.code, price: c.latestPrice as number }))
      hydrateSnapshot(items)
    } catch {
      /* ignore */
    }
  }, [hydrateSnapshot])

  useEffect(() => {
    fetchAll()
    loadPrices()
  }, [fetchAll, loadPrices])

  const onSave = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      set({
        knockOutLeadDays: Number(v.knockOutLeadDays),
        knockOutNearPct: Number(v.knockOutNearPct),
        couponNearPct: Number(v.couponNearPct),
        knockInNearPct: Number(v.knockInNearPct)
      })
      message.success('预警设置已保存')
    } finally {
      setSaving(false)
    }
  }

  const onReset = () => {
    reset()
    form.setFieldsValue({ ...ALERT_DEFAULTS })
    message.success('已恢复默认设置')
  }

  // 实时预览：基于表单当前值（未保存也会即时反映），复用与总览页完全相同的判定逻辑
  const formVals = Form.useWatch([], form) as Partial<AlertConfig> | undefined
  const previewCfg: AlertConfig = {
    knockOutLeadDays: Number(formVals?.knockOutLeadDays ?? knockOutLeadDays),
    knockOutNearPct: Number(formVals?.knockOutNearPct ?? knockOutNearPct),
    couponNearPct: Number(formVals?.couponNearPct ?? couponNearPct),
    knockInNearPct: Number(formVals?.knockInNearPct ?? knockInNearPct)
  }
  const preview = useMemo(
    () => computeAlerts(positions, latestPrices, previewCfg),
    [
      positions,
      latestPrices,
      previewCfg.knockOutLeadDays,
      previewCfg.knockOutNearPct,
      previewCfg.couponNearPct,
      previewCfg.knockInNearPct
    ]
  )

  const hasPrices = Object.keys(latestPrices).length > 0

  return (
    <div style={{ marginTop: -32 }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ opacity: 0.6 }} />
        <Title level={3} style={{ margin: 0 }}>
          <NotificationOutlined style={{ marginRight: 8, color: '#4d77ef' }} />
          合约预警信号设置
        </Title>
      </div>

      {/* 说明条 */}
      <div
        className="glass-card"
        style={{
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: 12.5,
          opacity: 0.9
        }}
      >
        <span style={{ opacity: 0.7 }}>
          以下阈值用于<strong>总览页「合约预警」</strong>区块的触发判定。调整参数后，右侧将实时预览当前会触发的预警。
        </span>
        <Button icon={<EyeOutlined />} onClick={() => navigate('/')} style={{ height: 32, fontWeight: 500 }}>
          前往总览查看
        </Button>
      </div>

      <Row gutter={[16, 16]} align="top">
        {/* 参数设置 */}
        <Col xs={24} lg={10}>
          <Card className="glass-card" variant="borderless" title="预警参数">
            <Form
              form={form}
              layout="vertical"
              requiredMark={(label, { required }) =>
                required ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {label}
                    <Tooltip title="必填项">
                      <InfoCircleOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
                    </Tooltip>
                  </span>
                ) : (
                  label
                )
              }
              initialValues={{ knockOutLeadDays, knockOutNearPct, couponNearPct, knockInNearPct }}
            >
              <Form.Item
                label="敲出 / 派息观察提前预警天数"
                name="knockOutLeadDays"
                tooltip="在敲出或派息观察日之前的 N 个自然日内，触发临近预警。"
                extra="例如 5 天：观察日距今 5 天内即纳入预警。"
                rules={[{ required: true, message: '请输入提前预警天数' }]}
              >
                <InputNumber min={1} max={60} precision={0} addonAfter="天" style={{ width: 200 }} />
              </Form.Item>

              <Divider style={{ margin: '4px 0 12px' }} />

              <Form.Item
                label="敲出线临近阈值"
                name="knockOutNearPct"
                tooltip="现价距敲出障碍价的「跌幅」≤ N% 即预警，即 敲出障碍价 ÷ 现价 − 1 ≤ N%。现价已高于敲出线（差距为负）时立即预警。"
                extra="例如 5%：现价低于敲出线 5% 以内（含已突破）均会提示。"
                rules={[{ required: true, message: '请输入阈值' }]}
              >
                <InputNumber min={0} max={50} precision={1} addonAfter="%" style={{ width: 200 }} />
              </Form.Item>

              <Form.Item
                label="派息线临近阈值"
                name="couponNearPct"
                tooltip="现价距派息障碍价的「跌幅」≤ N% 即预警。现价已站上派息线时立即预警。"
                extra="例如 5%：现价低于派息线 5% 以内（含已站上）均会提示。"
                rules={[{ required: true, message: '请输入阈值' }]}
              >
                <InputNumber min={0} max={50} precision={1} addonAfter="%" style={{ width: 200 }} />
              </Form.Item>

              <Form.Item
                label="敲入线临近阈值"
                name="knockInNearPct"
                tooltip="现价距敲入障碍价的「涨幅」≤ N% 即预警，即 敲入障碍价 ÷ 现价 − 1 ≥ −N%。现价已跌破敲入线（差距为正）时立即预警。"
                extra="例如 10%：现价高于敲入线 10% 以内（含已跌破）均会提示。"
                rules={[{ required: true, message: '请输入阈值' }]}
              >
                <InputNumber min={0} max={50} precision={1} addonAfter="%" style={{ width: 200 }} />
              </Form.Item>
            </Form>

            <Divider style={{ margin: '8px 0 16px' }} />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Popconfirm title="恢复为默认设置？" onConfirm={onReset} okText="恢复" cancelText="取消">
                  <Button icon={<ReloadOutlined />} style={{ height: 32, fontWeight: 500 }}>恢复默认</Button>
                </Popconfirm>
                <Button icon={<SaveOutlined />} loading={saving} onClick={onSave} style={{ height: 32, fontWeight: 500 }}>
                  保存
                </Button>
              </Space>
            </div>
          </Card>
        </Col>

        {/* 实时预览 */}
        <Col xs={24} lg={14}>
          <Card className="glass-card" variant="borderless" title="实时预览">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: preview.length ? '#f87171' : 'rgba(244,244,245,0.4)'
                }}
              >
                {preview.length}
              </span>
              <span style={{ fontSize: 13, opacity: 0.6 }}>个合约将触发预警</span>
            </div>

            {!hasPrices ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span style={{ fontSize: 12, opacity: 0.5 }}>暂无行情快照，请先在总览页刷新行情</span>}
              />
            ) : preview.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.45, padding: '8px 0' }}>
                当前参数下无触发预警的合约。可尝试调大「临近阈值」或「提前预警天数」。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 460, overflow: 'auto' }}>
                {preview.map((a) => {
                  const sc = STRUCTURE_COLOR[a.structureType] || STRUCTURE_COLOR.snowball
                  return (
                    <div
                      key={a.id}
                      onClick={() => navigate(`/positions/${a.structureType || 'snowball'}/${a.id}`, { state: { from: '/settings/alerts' } })}
                      style={{
                        border: '1px solid rgba(248,113,113,0.28)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(248,113,113,0.55)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(248,113,113,0.28)')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {a.title}
                        </span>
                        <span
                          className="struct-tag"
                          style={{ color: sc.color, background: sc.bg, flexShrink: 0 }}
                        >
                          {STRUCTURE_LABEL[a.structureType] || a.structureType}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
                        {a.code} · 现价 {a.cur.toFixed(2)}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                        {a.reasons.map((r, i) => {
                          const tc = TONE_COLOR[r.tone] || '#f87171'
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: tc, flexShrink: 0 }} />
                              <span style={{ color: tc, fontWeight: 600, flexShrink: 0 }}>{r.label}</span>
                              <span style={{ opacity: 0.55, marginLeft: 'auto' }}>
                                {r.date ? `${r.date} · ` : ''}差距 {gapText(r.gap)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
