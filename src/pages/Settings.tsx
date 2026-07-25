import { useState } from 'react'
import { Card, Form, Input, Button, Space, message, Divider, Typography, Alert, Segmented } from 'antd'
import { ApiOutlined, InfoCircleOutlined, BgColorsOutlined } from '@ant-design/icons'
import { useMarketStore } from '../stores/marketStore'
import { useThemeStore } from '../stores/themeStore'

const { Text, Paragraph } = Typography

export default function Settings() {
  const { fetchRemotePrice } = useMarketStore()
  const { preference, setPreference } = useThemeStore()
  const [testCode, setTestCode] = useState('000905.SH')
  const [testResult, setTestResult] = useState<string>('')

  const handleTestConnection = async () => {
    setTestResult('正在获取...')
    const price = await fetchRemotePrice(testCode)
    if (price) {
      setTestResult(`成功！${testCode} 当前价格: ${price.toFixed(2)}`)
      message.success('行情接口正常')
    } else {
      setTestResult('获取失败，请检查网络连接')
      message.error('行情接口连接失败')
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Header */}
      <div className="page-header">
        <h2>设置</h2>
        <p>外观、行情接口与应用信息</p>
      </div>

      {/* 外观设置 */}
      <Card
        title={<Space><BgColorsOutlined />外观</Space>}
        bordered={false}
        className="content-card"
        style={{ marginBottom: 16 }}
      >
        <Form layout="vertical">
          <Form.Item label="主题模式" style={{ marginBottom: 0 }}>
            <Segmented
              value={preference}
              onChange={(val) => setPreference(val as 'system' | 'light' | 'dark')}
              options={[
                { label: '跟随系统', value: 'system' },
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' }
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card
        title={<Space><ApiOutlined />行情设置</Space>}
        bordered={false}
        className="content-card"
        style={{ marginBottom: 16 }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 20 }}>
          本应用使用东方财富免费行情接口获取 A 股指数和个股实时数据。
        </Paragraph>

        <Form layout="vertical">
          <Form.Item label="测试标的代码">
            <Space>
              <Input
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
                style={{ width: 180 }}
                placeholder="如 000905.SH"
              />
              <Button type="primary" onClick={handleTestConnection}>
                测试连接
              </Button>
            </Space>
          </Form.Item>
          {testResult && (
            <Alert
              message={testResult}
              type={testResult.includes('成功') ? 'success' : testResult === '正在获取...' ? 'info' : 'error'}
              showIcon
              style={{ borderRadius: 6 }}
            />
          )}
        </Form>

        <Divider style={{ margin: '16px 0' }} />

        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>常用标的代码</Text>
        </Paragraph>
        <Paragraph style={{ marginBottom: 4 }}>
          <Text code>000905.SH</Text> 中证500 &nbsp;&nbsp;
          <Text code>000852.SH</Text> 中证1000 &nbsp;&nbsp;
          <Text code>000300.SH</Text> 沪深300
        </Paragraph>
        <Paragraph style={{ marginBottom: 0 }}>
          <Text code>000016.SH</Text> 上证50 &nbsp;&nbsp;
          <Text code>399006.SZ</Text> 创业板指 &nbsp;&nbsp;
          <Text code>399001.SZ</Text> 深证成指
        </Paragraph>
      </Card>

      <Card
        title={<Space><InfoCircleOutlined />关于</Space>}
        bordered={false}
        className="content-card"
      >
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>雪球持仓管理</Text> <Text type="secondary">v1.0.0</Text>
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 4 }}>
          一款用于管理场外衍生品（雪球结构化产品）投资持仓的桌面工具。
          支持持仓录入、盈亏监控、组合分析和事件提醒等功能。
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          数据存储于本地 SQLite 数据库，无需联网即可使用基本功能。
        </Paragraph>
      </Card>
    </div>
  )
}
