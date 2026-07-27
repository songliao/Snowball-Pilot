import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  Card, Form, Input, InputNumber, DatePicker, Select, Button, Row, Col,
  Space, Typography, message, Tag, Tooltip, Checkbox
} from 'antd'
import {
  InfoCircleOutlined,
  RiseOutlined,
  FallOutlined,
  SafetyCertificateOutlined,
  RedoOutlined,
  CalculatorOutlined,
  GiftOutlined,
  EditOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'

const { Title } = Typography

function SectionHeader({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="bookkeeping-section-divider">
      <span className="bookkeeping-section-title">
        <span className="nav-icon-circle">{icon}</span>
        <span>{children}</span>
      </span>
      <span className="bookkeeping-section-line" />
    </div>
  )
}

const parseJsonArray = <T,>(s?: string): T[] => {
  try {
    return s ? (JSON.parse(s) as T[]) : []
  } catch {
    return []
  }
}

// 解析用空格/逗号/换行分隔的日期文本，归一化为 YYYY-MM-DD 数组
const parseDateList = (input?: string): string[] => {
  if (!input) return []
  return input
    .split(/[\s,，、]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const d = dayjs(t)
      return d.isValid() ? d.format('YYYY-MM-DD') : null
    })
    .filter((x): x is string => x !== null)
}

// 解析用空格/逗号/换行分隔的数值文本（可带 % 或不带），返回 number 数组
const parseNumberList = (input?: string): number[] => {
  if (!input) return []
  return input
    .split(/[\s,，、；;]+/)
    .map((t) => t.trim().replace(/[%％]/g, '').trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

const parseStringList = (input?: string): string[] => {
  if (!input) return []
  return input
    .split(/[\s,，、；;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export default function PositionForm({ readOnly = false, bare = false }: { readOnly?: boolean; bare?: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [isPhoenix, setIsPhoenix] = useState(false)
  const isEdit = !!id
  const koDatesCount = parseDateList(Form.useWatch('knock_out_dates', form)).length
  const koBarriersCount = parseNumberList(Form.useWatch('knock_out_barriers', form)).length
  const koCouponsCount = parseNumberList(Form.useWatch('knock_out_coupons', form)).length
  const couponDatesCount = parseDateList(Form.useWatch('coupon_dates', form)).length
  const { create, update } = usePositionStore()
  const [underlyingOptions, setUnderlyingOptions] = useState<{ label: string; value: string }[]>([])

  useEffect(() => {
    window.api.prices
      .getCodes()
      .then((rows) =>
        setUnderlyingOptions(
          rows.map((r) => ({
            label: r.code,
            value: r.code
          }))
        )
      )
      .catch(() => setUnderlyingOptions([]))
  }, [])

  const currentCode = Form.useWatch('underlying_code', form)
  const underlyingSelectOptions = useMemo(() => {
    if (currentCode && !underlyingOptions.some((o) => o.value === currentCode)) {
      return [{ label: currentCode, value: currentCode }, ...underlyingOptions]
    }
    return underlyingOptions
  }, [underlyingOptions, currentCode])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setIsPhoenix(params.get('type') === 'phoenix')
  }, [location.search])

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const current = await window.api.positions.getById(Number(id))
      if (!current) {
        message.error('未找到该持仓')
        navigate('/positions')
        return
      }
      setIsPhoenix(current.structure_type === 'phoenix')
      const isPhx = current.structure_type === 'phoenix'
      form.setFieldsValue({
        ...current,
        notional: current.notional,
        initial_price: current.initial_price,
        trade_start_date: current.trade_start_date || current.interest_start_date
          ? dayjs(current.trade_start_date || current.interest_start_date)
          : null,
        knock_in_barrier: ((current.knock_in_barrier ?? current.knock_in_pct) ?? 0) * 100,
        coupon_rate: (current.coupon_rate ?? 0) * 100,
        margin_ratio: ((current.margin_ratio ?? current.margin_rate) ?? 0) * 100,
        coupon_barrier: (current.coupon_barrier ?? 0) * 100,
        // 雪球簿记字段
        knock_out_barriers: parseJsonArray<number>(current.knock_out_barriers).join('\n'),
        knock_out_coupons: parseJsonArray<number>(current.knock_out_coupons).join('\n'),
        knock_out_dates: parseJsonArray<string>(current.knock_out_dates).join('\n'),
        knock_out_enhance_participation: (current.knock_out_enhance_participation ?? 0) * 100,
        maturity_coupon: ((isPhx ? current.dividend_coupon : current.maturity_coupon) ?? 0) * 100,
        knock_in_observation: current.knock_in_observation || 'daily',
        knock_in_strike: ((current.knock_in_strike ?? current.knock_in_strike_pct) ?? 100) * 100,
        knock_in_participation: (current.knock_in_participation ?? 100) * 100,
        max_loss_pct: (current.max_loss_pct ?? 0) * 100,
        rebate_annual_pct: (current.rebate_annual_pct ?? 0) * 100,
        rebate_absolute_back_pct: (current.rebate_absolute_back_pct ?? 0) * 100,
        rebate_absolute_front_pct: (current.rebate_absolute_front_pct ?? 0) * 100,
        accrual_basis: current.accrual_basis || 'both',
        accrual_settle_tplus: current.accrual_settle_tplus || 0,
        abs_fee_pct: (current.abs_fee_pct ?? 0) * 100,
        annual_fee_pct: (current.annual_fee_pct ?? 0) * 100,
        income_dividend_pct: (current.income_dividend_pct ?? 0) * 100,
        termination_date: current.termination_date ? dayjs(current.termination_date) : null,
        termination_payoff: current.termination_payoff ?? 0,
        // 凤凰簿记字段
        coupon_dates: parseJsonArray<string>(current.coupon_dates).join('\n'),
        coupon_received: parseJsonArray<string>(current.coupon_received).join('\n'),
        coupon_payment_dates: parseJsonArray<string>(current.coupon_payment_dates).join('\n'),
        is_ki: !!current.is_ki
      })
    }
    load()
  }, [id, navigate, form])

  const handleSubmit = async (values: any) => {
    setSaving(true)
    try {
      if (isPhoenix) {
        const dates = parseDateList(values.knock_out_dates)
        const barriers = parseNumberList(values.knock_out_barriers)
        const dividendDates = parseDateList(values.coupon_dates)
        if (dates.length !== barriers.length) {
          message.error('敲出观察日、敲出障碍价格的数量必须一致')
          return
        }
        const margin = Number(values.margin_ratio || 0)
        const v = {
          product_name: values.product_name,
          broker: values.broker,
          underlying_code: values.underlying_code,
          notional: Number(values.notional),
          initial_price: Number(values.initial_price || 0),
          trade_start_date: values.trade_start_date ? values.trade_start_date.format('YYYY-MM-DD') : '',
          knock_in_barrier: Number(values.knock_in_barrier || 0) / 100,
          coupon_rate: Number(values.coupon_rate || 0) / 100,
          margin_ratio: margin / 100,
          status: 'active',
          notes: values.notes || '',
          structure_type: 'phoenix',
          coupon_barrier: Number(values.coupon_barrier || 0) / 100,
          contract_no: values.contract_no || '',
          knock_out_dates: JSON.stringify(dates),
          knock_out_barriers: JSON.stringify(barriers),
          knock_out_coupons: '',
          knock_out_enhance_participation: 0,
          knock_in_observation: values.knock_in_observation || 'daily',
          knock_in_strike: Number(values.knock_in_strike ?? 100) / 100,
          knock_in_participation: Number(values.knock_in_participation ?? 100) / 100,
          max_loss_pct:
            values.max_loss_pct != null && values.max_loss_pct !== ''
              ? Number(values.max_loss_pct) / 100
              : margin / 100,
          rebate_annual_pct: Number(values.rebate_annual_pct || 0) / 100,
          rebate_absolute_back_pct: Number(values.rebate_absolute_back_pct || 0) / 100,
          rebate_absolute_front_pct: Number(values.rebate_absolute_front_pct || 0) / 100,
          accrual_basis: values.accrual_basis || 'both',
          accrual_settle_tplus: Number(values.accrual_settle_tplus || 0),
          abs_fee_pct: Number(values.abs_fee_pct || 0) / 100,
          annual_fee_pct: Number(values.annual_fee_pct || 0) / 100,
          income_dividend_pct: Number(values.income_dividend_pct || 0) / 100,
          coupon_dates: JSON.stringify(dividendDates),
          coupon_received: JSON.stringify(parseStringList(values.coupon_received)),
          coupon_payment_dates: JSON.stringify(parseDateList(values.coupon_payment_dates)),
          is_ki: values.is_ki ? 1 : 0,
          termination_date: values.termination_date ? values.termination_date.format('YYYY-MM-DD') : '',
          termination_payoff: values.termination_payoff != null && values.termination_payoff !== '' ? Number(values.termination_payoff) : null
        }
        if (id) await update(Number(id), v)
        else await create(v)
      } else {
        const dates = parseDateList(values.knock_out_dates)
        const barriers = parseNumberList(values.knock_out_barriers)
        const coupons = parseNumberList(values.knock_out_coupons)
        if (dates.length !== barriers.length || barriers.length !== coupons.length) {
          message.error('敲出观察日、敲出障碍价格、敲出票息的数量必须一致')
          return
        }
        const margin = Number(values.margin_ratio || 0)
        const v = {
          product_name: values.product_name,
          broker: values.broker,
          underlying_code: values.underlying_code,
          notional: Number(values.notional),
          initial_price: Number(values.initial_price || 0),
          trade_start_date: values.trade_start_date ? values.trade_start_date.format('YYYY-MM-DD') : '',
          knock_in_barrier: Number(values.knock_in_barrier || 0) / 100,
          margin_ratio: margin / 100,
          status: 'active',
          notes: values.notes || '',
          structure_type: 'snowball',
          coupon_barrier: 0,
          coupon_dates: '',
          contract_no: values.contract_no || '',
          knock_out_barriers: JSON.stringify(barriers),
          knock_out_coupons: JSON.stringify(coupons),
          knock_out_dates: JSON.stringify(dates),
          knock_out_enhance_participation: Number(values.knock_out_enhance_participation || 0) / 100,
          maturity_coupon: Number(values.maturity_coupon || 0) / 100,
          knock_in_observation: values.knock_in_observation || 'daily',
          knock_in_strike: Number(values.knock_in_strike ?? 100) / 100,
          knock_in_participation: Number(values.knock_in_participation ?? 100) / 100,
          max_loss_pct:
            values.max_loss_pct != null && values.max_loss_pct !== ''
              ? Number(values.max_loss_pct) / 100
              : margin / 100,
          rebate_annual_pct: Number(values.rebate_annual_pct || 0) / 100,
          rebate_absolute_back_pct: Number(values.rebate_absolute_back_pct || 0) / 100,
          rebate_absolute_front_pct: Number(values.rebate_absolute_front_pct || 0) / 100,
          accrual_basis: values.accrual_basis || 'both',
          accrual_settle_tplus: Number(values.accrual_settle_tplus || 0),
          abs_fee_pct: Number(values.abs_fee_pct || 0) / 100,
          annual_fee_pct: Number(values.annual_fee_pct || 0) / 100,
          income_dividend_pct: Number(values.income_dividend_pct || 0) / 100,
          termination_date: values.termination_date ? values.termination_date.format('YYYY-MM-DD') : '',
          termination_payoff: values.termination_payoff != null && values.termination_payoff !== '' ? Number(values.termination_payoff) : null,
          is_ki: values.is_ki ? 1 : 0
        }
        if (id) await update(Number(id), v)
        else await create(v)
      }
      message.success(id ? '持仓已更新' : '持仓已创建')
      navigate('/positions')
    } catch (e) {
      message.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const label = isPhoenix ? '凤凰' : '雪球'

  const formBody = (
    <Card className="bookkeeping-card">
      <Form
        form={form}
        className="bookkeeping-form"
        layout="vertical"
        disabled={readOnly}
        requiredMark={(label, { required }) =>
            required ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {label}
                <Tooltip title="必填项">
                  <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
                </Tooltip>
              </span>
            ) : (
              label
            )
          }
          initialValues={{
            underlying_code: '000905.SH',
            coupon_rate: 15,
            margin_ratio: 0,
            // 雪球默认
            knock_in_barrier: 75,
            knock_in_observation: 'daily',
            knock_in_strike: 100,
            knock_in_participation: 100,
            knock_out_enhance_participation: 0,
            maturity_coupon: 0,
            accrual_basis: 'both',
            accrual_settle_tplus: 0,
            rebate_annual_pct: 0,
            rebate_absolute_back_pct: 0,
            rebate_absolute_front_pct: 0,
            abs_fee_pct: 0,
            annual_fee_pct: 0,
            income_dividend_pct: 0,
            termination_payoff: 0,
            // 凤凰默认
            coupon_barrier: 80
          }}
          onFinish={handleSubmit}
        >
          {/* 基本信息 */}
          <SectionHeader icon={<InfoCircleOutlined />}>基本信息</SectionHeader>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="产品名称" name="product_name">
                <Input placeholder="如：中证500雪球第12期" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="交易对手方" name="broker">
                <Input placeholder="券商 / 交易对手" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="合约编号" name="contract_no">
                <Input placeholder="如：HT-2024-001" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="挂钩标的" name="underlying_code" rules={[{ required: true, message: '请选择挂钩标的' }]}>
                <Select
                  showSearch
                  placeholder="选择已存行情的标的"
                  optionFilterProp="label"
                  options={underlyingSelectOptions}
                  notFoundContent="暂无已存行情的标的"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="名义本金" name="notional" rules={[{ required: true, message: '请输入名义本金' }]}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={100000}
                  formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(val) => (val ? val.replace(/,/g, '') : '0') as any}
                  addonAfter="元"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="起息日" name="trade_start_date" rules={[{ required: true, message: '请选择起息日' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="起息价格" name="initial_price" rules={[{ required: true, message: '请输入起息价格' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} addonAfter="点" />
              </Form.Item>
            </Col>
          </Row>

          {/* 敲出参数：雪球与凤凰共用观察日与障碍价格；凤凰无敲出票息/增强参与率/红利票息 */}
          <SectionHeader icon={<RiseOutlined />}>敲出参数</SectionHeader>
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item
                label={<span>敲出观察日<Tag color="blue" style={{ marginLeft: 6 }}>{koDatesCount} 期</Tag></span>}
                name="knock_out_dates"
                tooltip="可一次性输入多个日期，用空格、逗号或换行分隔"
                rules={[{ required: true, message: '请输入敲出观察日' }]}
              >
                <Input.TextArea
                  rows={2}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  placeholder={'如：2024-03-20 2024-04-20, 2024-05-20\n2024-06-20'}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                label={<span>敲出障碍价格<Tag color="blue" style={{ marginLeft: 6 }}>{koBarriersCount} 期</Tag></span>}
                name="knock_out_barriers"
                tooltip="可一次性输入多个数值，用空格、逗号或换行分隔；可带 % 或不带"
                rules={[{ required: true, message: '请输入敲出障碍价格' }]}
              >
                <Input.TextArea
                  rows={2}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  placeholder={'如：103 103 104\n105% 106'}
                />
              </Form.Item>
            </Col>
            {!isPhoenix && (
              <Col xs={24}>
                <Form.Item
                  label={<span>敲出票息<Tag color="blue" style={{ marginLeft: 6 }}>{koCouponsCount} 期</Tag></span>}
                  name="knock_out_coupons"
                  tooltip="可一次性输入多个数值，用空格、逗号或换行分隔；可带 % 或不带"
                  rules={[{ required: true, message: '请输入敲出票息' }]}
                >
                  <Input.TextArea
                    rows={2}
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    placeholder={'如：15 15 16\n18%'}
                  />
                </Form.Item>
              </Col>
            )}
            {!isPhoenix && (
              <Col xs={24} sm={12} md={8}>
                <Form.Item label="敲出增强参与率" name="knock_out_enhance_participation" rules={[{ required: true, message: '请输入敲出增强参与率' }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
                </Form.Item>
              </Col>
            )}
            {!isPhoenix && (
              <Col xs={24} sm={12} md={8}>
                <Form.Item label="红利票息" name="maturity_coupon" rules={[{ required: true, message: '请输入红利票息' }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
                </Form.Item>
              </Col>
            )}
          </Row>

          {isPhoenix && (
            <>
              <SectionHeader icon={<GiftOutlined />}>派息参数</SectionHeader>
              <Row gutter={16}>
                <Col xs={24}>
                  <Form.Item
                    label={<span>派息观察日<Tag color="blue" style={{ marginLeft: 6 }}>{couponDatesCount} 期</Tag></span>}
                    name="coupon_dates"
                    tooltip="可一次性输入多个日期，用空格、逗号或换行分隔"
                    rules={[{ required: true, message: '请输入派息观察日' }]}
                  >
                    <Input.TextArea
                      rows={2}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder={'如：2024-03-20 2024-04-20, 2024-05-20\n2024-06-20'}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item
                    label="派息障碍价格"
                    name="coupon_barrier"
                    tooltip="标的在派息观察日收盘价高于该比例时支付票息"
                    rules={[{ required: true, message: '请输入派息障碍价格' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item
                    label="派息率"
                    name="coupon_rate"
                    tooltip="按名义本金的绝对百分比计算"
                    rules={[{ required: true, message: '请输入派息率' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
                  </Form.Item>
                </Col>
                {isEdit && (
                <Col xs={24}>
                  <Form.Item
                    label="派息支付日"
                    name="coupon_payment_dates"
                    tooltip="可一次性输入多个日期，用空格、逗号或换行分隔"
                  >
                    <Input.TextArea rows={2} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="如：2024-03-20 2024-04-20" />
                  </Form.Item>
                </Col>
                )}
                {isEdit && (
                <Col xs={24}>
                  <Form.Item
                    label="已派息记录"
                    name="coupon_received"
                    tooltip="已实际支付的派息记录（数组，用空格、逗号或换行分隔）"
                  >
                    <Input.TextArea rows={2} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="如：2024-03-20 15%、2024-04-20 15%" />
                  </Form.Item>
                </Col>
                )}
              </Row>
            </>
          )}

              <SectionHeader icon={<FallOutlined />}>敲入参数</SectionHeader>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="敲入障碍价格" name="knock_in_barrier" rules={[{ required: true, message: '请输入敲入障碍价格' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="敲入观察方式" name="knock_in_observation" rules={[{ required: true, message: '请选择敲入观察方式' }]}>
                <Select
                  options={[
                    { label: '每日观察', value: 'daily' },
                    { label: '到期观察', value: 'maturity' }
                  ]}
                />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="敲入执行价格" name="knock_in_strike" rules={[{ required: true, message: '请输入敲入执行价格' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="敲入参与率" name="knock_in_participation" rules={[{ required: true, message: '请输入敲入参与率' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
                {isEdit && !bare && (
                <Col xs={24} sm={12} md={8}>
                  <Form.Item name="is_ki" valuePropName="checked">
                    <Checkbox>已敲入（KI）</Checkbox>
                  </Form.Item>
                </Col>
                )}
              </Row>

              <SectionHeader icon={<SafetyCertificateOutlined />}>保证金与最大亏损</SectionHeader>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="保证金比例" name="margin_ratio" rules={[{ required: true, message: '请输入保证金比例' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={1} addonAfter="%" />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="最大亏损" name="max_loss_pct" rules={[{ required: true, message: '请输入最大亏损' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={1} addonAfter="%" />
              </Form.Item>
                </Col>
              </Row>

              <SectionHeader icon={<RedoOutlined />}>返息</SectionHeader>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="年化后端返息" name="rebate_annual_pct" rules={[{ required: true, message: '请输入年化后端返息' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="绝对后端返息" name="rebate_absolute_back_pct" rules={[{ required: true, message: '请输入绝对后端返息' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="绝对前端返息" name="rebate_absolute_front_pct" rules={[{ required: true, message: '请输入绝对前端返息' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.5} addonAfter="%" />
              </Form.Item>
                </Col>
              </Row>

              <SectionHeader icon={<CalculatorOutlined />}>计息规则</SectionHeader>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="计息规则" name="accrual_basis" rules={[{ required: true, message: '请选择计息规则' }]}>
                <Select
                  options={[
                    { label: '双含', value: 'both' },
                    { label: '单含', value: 'one' }
                  ]}
                />
              </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
              <Form.Item label="计息结算 T+" name="accrual_settle_tplus" rules={[{ required: true, message: '请输入计息结算 T+' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={1} precision={0} />
              </Form.Item>
                </Col>
              </Row>

              <SectionHeader icon={<CalculatorOutlined />}>交易费用</SectionHeader>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item
                    label="绝对费用"
                    name="abs_fee_pct"
                    tooltip="按名义本金的百分比"
                    rules={[{ required: true, message: '请输入绝对费用' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} addonAfter="%" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item
                    label="年化费用"
                    name="annual_fee_pct"
                    tooltip="按名义本金的百分比年化"
                    rules={[{ required: true, message: '请输入年化费用' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} addonAfter="%" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item
                    label="收益分红"
                    name="income_dividend_pct"
                    tooltip="按派息金额的百分比"
                    rules={[{ required: true, message: '请输入收益分红' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} addonAfter="%" />
                  </Form.Item>
                </Col>
              </Row>

              {isEdit && !bare && (
                <>
                  <SectionHeader icon={<CalculatorOutlined />}>终止条款</SectionHeader>
                  <Row gutter={16}>
                    <Col xs={24} sm={12} md={8}>
                      <Form.Item label="终止日期" name="termination_date">
                        <DatePicker style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} md={8}>
                      <Form.Item
                        label="了结收益"
                        name="termination_payoff"
                        tooltip="到期或提前终止时的了结收益（绝对金额），存续中可留空"
                      >
                        <InputNumber style={{ width: '100%' }} min={0} precision={2} step={1000} addonAfter="元" />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

          {/* 备注 */}
          <SectionHeader icon={<EditOutlined />}>备注</SectionHeader>
          <Form.Item name="notes">
            <Input.TextArea rows={3} placeholder="可选：备注信息" />
          </Form.Item>
        </Form>
      </Card>
  )

  if (bare) return formBody

  return (
    <div className="page-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -10 }}>
          <Title level={5} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {id ? '编辑持仓' : '新增持仓'}
          </Title>
          <Tag className={`structure-tag ${isPhoenix ? 'structure-tag--phoenix' : 'structure-tag--snowball'}`}>{label}</Tag>
        </div>
        <Space style={{ marginTop: 18 }}>
          {readOnly ? (
            <Button type="primary" style={{ width: 96, height: 31 }} onClick={() => navigate(`/positions/${id}/edit`)}>
              编辑
            </Button>
          ) : (
            <>
              <Button style={{ width: 96, height: 31 }} onClick={() => navigate(-1)}>取消</Button>
              <Button type="primary" style={{ width: 96, height: 31 }} loading={saving} onClick={() => form.submit()}>
                保存
              </Button>
            </>
          )}
        </Space>
      </div>
      {formBody}
    </div>
  )
}
