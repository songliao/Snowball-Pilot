import { Typography } from 'antd'

const { Title } = Typography

export default function Analysis() {
  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={5} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          组合分析
        </Title>
      </div>
    </div>
  )
}
