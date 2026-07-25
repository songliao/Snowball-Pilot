import { useEffect } from 'react'
import { Card, Form, Input, InputNumber, DatePicker, Select, Button, Space, message, Divider } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { usePositionStore } from '../stores/positionStore'

const UNDERLYING_OPTIONS = [
  { value: '中证500', code: '000905.SH' },
  { value: '中证1000', code: '000852.SH' },
  { value: '沪深300', code: '000300.SH' },
  { value: '上证50', code: '000016.SH' },
  { value: '创业板指', code: '399006.SZ' },
  { value: '深证成指', code: '399001.SZ' }
]

export default function PositionForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const [form] = Form.useForm()
  const { create, update, fetchById, current } = usePositionStore()

  useEffect(() => {
    if (isEdit && id) {
      fetchById(Number(id))
    }
  }, [id])

  useEffect(() => {
    if (isEdit && current) {
      form.setFieldsValue({
        ...current,
        trade_date: dayjs(current.trade_date),
        effective_date: dayjs(current.effective_date),
        maturity_date: dayjs(current.maturity_date),
        knock_in_pct: current.knock_in_pct * 100,
        knock_out_pct: current.knock_out_pct * 100,
        coupon_rate: current.coupon_rate * 100,
        margin_rate: (current.margin_rate || 0) * 100
      })
    }
  }, [current, isEdit])

  const handleSubmit = async (values: Record<string, unknown>) => {
    const data = {
      product_name: values.product_name as string,
      broker: (values.broker as string) || '',
      underlying: values.underlying as string,
      underlying_code: values.underlying_code as string,
      notional: values.notional as number,
      trade_date: (values.trade_date as dayjs.Dayjs).format('YYYY-MM-DD'),
      effective_date: (values.effective_date as dayjs.Dayjs).format('YYYY-MM-DD'),
      maturity_date: (values.maturity_date as dayjs.Dayjs).format('YYYY-MM-DD'),
      initial_price: values.initial_price as number,
      knock_in_pct: (values.knock_in_pct as number) / 100,
      knock_out_pct: (values.knock_out_pct as number) / 100,
      coupon_rate: (values.coupon_rate as number) / 100,
      margin_rate: ((values.margin_rate as number) || 0) / 100,
      observation_freq: (values.observation_freq as string) || 'monthly',
      knock_in_observed: 0,
      knock_out_observed: 0,
      status: 'active',
      notes: (values.notes as string) || ''
    }

    try {
      if (isEdit && id) {
        await update(Number(id), data)
        message.success('更新成功')
      } else {
        await create(data)
        message.success('创建成功')
      }
      navigate('/positions')
    } catch {
      message.error('操作失败')
    }
  }

  const handleUnderlyingChange = (value: string) => {
    const option = UNDERLYING_OPTIONS.find((o) => o.value === value)
    if (option) {
      form.setFieldValue('underlying_code', option.code)
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Header */}
      <div className="page-header">
        <h2>{isEdit ? '编辑持仓' : '新增持仓'}</h2>
        <p>{isEdit ? '修改雪球合约要素信息' : '录入新的雪球结构化产品持仓'}</p>
      </div>

      <Card bordered={false} className="content-card">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            knock_in_pct: 75,
            knock_out_pct: 103,
            coupon_rate: 15,
            margin_rate: 0,
            observation_freq: 'monthly',
            underlying_code: '000905.SH'
          }}
        >
          {/* 基本信息 */}
          <div className="section-title">基本信息</div>
          <Form.Item
            name="product_name"
            label="产品名称"
            rules={[{ required: true, message: '请输入产品名称' }]}
          >
            <Input placeholder="如：XX证券雪球2024年第1期" />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="broker" label="券商" style={{ width: 220 }}>
              <Input placeholder="如：中信证券" />
            </Form.Item>
            <Form.Item
              name="underlying"
              label="标的资产"
              rules={[{ required: true, message: '请选择标的' }]}
              style={{ width: 220 }}
            >
              <Select
                placeholder="选择标的"
                options={UNDERLYING_OPTIONS.map((o) => ({ value: o.value, label: o.value }))}
                onChange={handleUnderlyingChange}
                showSearch
              />
            </Form.Item>
            <Form.Item name="underlying_code" label="标的代码" style={{ width: 220 }}>
              <Input placeholder="如：000905.SH" />
            </Form.Item>
          </Space>

          <Divider style={{ margin: '8px 0 24px' }} />

          {/* 合约条款 */}
          <div className="section-title">合约条款</div>
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="notional"
              label="名义本金（元）"
              rules={[{ required: true, message: '请输入名义本金' }]}
              style={{ width: 220 }}
            >
              <InputNumber
                min={0}
                step={100000}
                style={{ width: '100%' }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              />
            </Form.Item>
            <Form.Item
              name="coupon_rate"
              label="年化票息率（%）"
              rules={[{ required: true, message: '请输入票息率' }]}
              style={{ width: 220 }}
            >
              <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="margin_rate"
              label="保证金比例（%）"
              style={{ width: 220 }}
            >
              <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="observation_freq" label="敲出观察频率" style={{ width: 220 }}>
              <Select
                options={[
                  { value: 'daily', label: '每日' },
                  { value: 'weekly', label: '每周' },
                  { value: 'monthly', label: '每月' },
                  { value: 'quarterly', label: '每季度' }
                ]}
              />
            </Form.Item>
          </Space>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="initial_price"
              label="期初价格"
              rules={[{ required: true, message: '请输入期初价格' }]}
              style={{ width: 220 }}
            >
              <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="knock_in_pct"
              label="敲入比例（%）"
              rules={[{ required: true, message: '请输入敲入比例' }]}
              style={{ width: 220 }}
              tooltip="如 75 表示期初价的 75%"
            >
              <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="knock_out_pct"
              label="敲出比例（%）"
              rules={[{ required: true, message: '请输入敲出比例' }]}
              style={{ width: 220 }}
              tooltip="如 103 表示期初价的 103%"
            >
              <InputNumber min={0} max={200} step={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Divider style={{ margin: '8px 0 24px' }} />

          {/* 日期信息 */}
          <div className="section-title">日期信息</div>
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="trade_date"
              label="交易日期"
              rules={[{ required: true, message: '请选择交易日期' }]}
              style={{ width: 220 }}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="effective_date"
              label="生效日期（期初观察日）"
              rules={[{ required: true, message: '请选择生效日期' }]}
              style={{ width: 220 }}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="maturity_date"
              label="到期日"
              rules={[{ required: true, message: '请选择到期日' }]}
              style={{ width: 220 }}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Divider style={{ margin: '8px 0 24px' }} />

          {/* 备注 */}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="其他备注信息（选填）" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                {isEdit ? '保存修改' : '创建持仓'}
              </Button>
              <Button onClick={() => navigate('/positions')}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
