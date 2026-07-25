import { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import {
  CompassOutlined,
  WalletOutlined,
  PieChartOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useThemeStore } from '../stores/themeStore'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <span className="nav-icon-circle"><CompassOutlined /></span>, label: '总览' },
  { key: '/positions', icon: <span className="nav-icon-circle"><WalletOutlined /></span>, label: '持仓管理' },
  { key: '/analysis', icon: <span className="nav-icon-circle"><PieChartOutlined /></span>, label: '组合分析' }
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const mode = useThemeStore((s) => s.mode)
  const isDark = mode === 'dark'

  const selectedKey = menuItems.find(
    (item) => item.key !== '/' && location.pathname.startsWith(item.key)
  )?.key || '/'

  const isSettings = location.pathname.startsWith('/settings')

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={200}
        style={{
          background: isDark ? '#111113' : '#fafaf9',
          borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* 窗口拖拽区域 + 标题 */}
        <div className="titlebar-drag" style={{ height: 64, flexShrink: 0, position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: 46,
            left: 30,
            fontSize: 15,
            fontWeight: 700,
            color: isDark ? 'rgba(244,244,245,0.82)' : 'rgba(30,30,34,0.78)',
            letterSpacing: '-0.02em'
          }}>
            Snowball Pilot
          </div>
        </div>

        {/* Menu - 上沿与右侧卡片对齐 */}
        <Menu
          mode="inline"
          selectedKeys={isSettings ? [] : [selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="sidebar-menu"
          style={{
            background: 'transparent',
            borderRight: 0,
            flex: 1,
            paddingTop: 16
          }}
        />

        {/* Bottom: 设置按钮 - 固定窗口左下角 */}
        <div style={{ position: 'absolute', bottom: 12, left: 24 }}>
          <div
            onClick={() => navigate('/settings')}
            style={{
              cursor: 'pointer',
              opacity: isSettings ? 1 : 0.6,
              transition: 'opacity 0.2s'
            }}
          >
            <span className={`nav-icon-circle${isSettings ? ' nav-icon-circle--active' : ''}`}>
              <SettingOutlined />
            </span>
          </div>
        </div>
      </Sider>

      <Layout style={{ marginLeft: 200 }}>
        <Content
          style={{
            padding: '16px 24px',
            paddingTop: 81,
            background: isDark ? '#09090b' : '#f5f5f4',
            overflow: 'auto',
            minHeight: '100vh'
          }}
        >
          <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto' }}>
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
