import { ReactNode, useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Popover, Segmented, Divider, Button } from 'antd'
import {
  CompassOutlined,
  WalletOutlined,
  SettingOutlined,
  LogoutOutlined,
  PlusOutlined,
  FundOutlined,
  CalendarOutlined,
  NotificationOutlined
} from '@ant-design/icons'
import snowPng from '../assets/snow.png'
import { useThemeStore } from '../stores/themeStore'
import { useAuthStore } from '../stores/authStore'
import { usePositionStore } from '../stores/positionStore'
import logo from '../assets/logo.png'
import phoenixPng from '../assets/money-saving.png'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <span className="nav-icon-circle"><CompassOutlined /></span>, label: '总览' },
  { key: '/events', icon: <span className="nav-icon-circle"><CalendarOutlined /></span>, label: '事件日历' },
  { key: '/positions', icon: <span className="nav-icon-circle"><WalletOutlined /></span>, label: '持仓管理' },
  { key: '/instruments', icon: <span className="nav-icon-circle"><FundOutlined /></span>, label: '标的管理' },
]

const STRUCTURE_TYPES = [
  {
    key: 'snowball',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 18,
          height: 18,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(${snowPng})`,
          maskImage: `url(${snowPng})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center'
        }}
      />
    ),
    title: '雪球类',
    desc: '敲入敲出结构，到期/敲出获取票息'
  },
  {
    key: 'phoenix',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 18,
          height: 18,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(${phoenixPng})`,
          maskImage: `url(${phoenixPng})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center'
        }}
      />
    ),
    title: '凤凰类',
    desc: '定期派息结构，价格高于派息障碍即派息'
  }
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const mode = useThemeStore((s) => s.mode)
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)
  const isDark = mode === 'dark'
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: MouseEvent) => {
      if (settingsWrapRef.current && !settingsWrapRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [settingsOpen])

  const selectedKey = menuItems.find(
    (item) => item.key !== '/' && location.pathname.startsWith(item.key)
  )?.key || '/'

  // 仅凤凰持仓详情页需要更宽的内容区以容纳并排的 4 张指标卡片；雪球及其它页面保持 1100
  const currentStructure = usePositionStore((s) => s.current?.structure_type)
  const isPhoenixDetail =
    /^\/positions\/.+/.test(location.pathname) && currentStructure === 'phoenix'
  const isPositionsList = location.pathname === '/positions'
  const contentMaxWidth = isPhoenixDetail ? 1480 : isPositionsList ? 1200 : 1100

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={224}
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
            top: 54,
            left: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <img src={logo} alt="logo" style={{ width: 24, height: 24, borderRadius: 4 }} />
            <span style={{
              fontSize: 19,
              fontWeight: 800,
              fontFamily: "Nunito, -apple-system, sans-serif",
              color: isDark ? 'rgba(244,244,245,0.82)' : 'rgba(30,30,34,0.78)',
              letterSpacing: '-0.01em'
            }}>
              Snowball <span style={{ color: '#4d77ef' }}>P</span>ilot
            </span>
          </div>
        </div>

        {/* 新增持仓按钮 - 固定于导航栏上部 */}
        <div style={{ padding: '50px 12px 0 6px' }}>
          <Popover
            open={addOpen}
            onOpenChange={setAddOpen}
            trigger="click"
            placement="bottom"
            arrow
            getPopupContainer={(node) => node.parentElement || document.body}
            overlayInnerStyle={{ padding: 6 }}
            content={
              <div style={{ width: 188 }}>
                {STRUCTURE_TYPES.map((t) => (
                  <div
                    key={t.key}
                    onClick={() => {
                      setAddOpen(false)
                      navigate(`/positions/new?type=${t.key}`)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 8px',
                      cursor: 'pointer',
                      borderRadius: 8,
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className="nav-icon-circle">{t.icon}</span>
                    <div style={{
                      fontSize: 13,
                      color: isDark ? 'rgba(244,244,245,0.85)' : 'rgba(30,30,34,0.85)'
                    }}>{t.title}</div>
                  </div>
                ))}
              </div>
            }
          >
            <Button block icon={<PlusOutlined />} style={{ height: 32, fontWeight: 500 }}>
              新增持仓
            </Button>
          </Popover>
        </div>

        {/* Menu - 上沿与右侧卡片对齐 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
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

        {/* Bottom: 设置按钮 + 弹出菜单（内联在导航栏内） */}
        <div ref={settingsWrapRef} style={{ position: 'absolute', bottom: 12, left: 24 }}>
          <div
            onClick={() => setSettingsOpen((v) => !v)}
            style={{
              cursor: 'pointer',
              opacity: 0.85,
              transition: 'opacity 0.2s'
            }}
          >
            <span className="nav-icon-circle" style={isDark ? { background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(244,244,245,0.8)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(30,30,34,0.55)' }}>
              <SettingOutlined />
            </span>
          </div>

          {settingsOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 44,
                left: -12,
                width: 200,
                background: isDark ? '#1c1c1f' : '#ffffff',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                borderRadius: 10,
                boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                padding: 8,
                zIndex: 200
              }}
            >
              <div style={{ padding: '4px 4px 8px' }}>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 8 }}>主题</div>
                <Segmented
                  block
                  size="small"
                  value={preference}
                  options={[
                    { label: '浅色', value: 'light' },
                    { label: '暗黑', value: 'dark' },
                    { label: '系统', value: 'system' }
                  ]}
                  onChange={(val) => setPreference(val as 'light' | 'dark' | 'system')}
                />
              </div>

              <Divider style={{ margin: '8px 0' }} />

              <div
                onClick={() => { setSettingsOpen(false); navigate('/settings/alerts') }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 4px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: isDark ? 'rgba(244,244,245,0.82)' : 'rgba(30,30,34,0.78)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <NotificationOutlined />
                <span>合约预警设置</span>
              </div>

              <Divider style={{ margin: '8px 0' }} />

              <div
                onClick={() => { setSettingsOpen(false); useAuthStore.getState().logout() }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 4px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#ef4444',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <LogoutOutlined />
                <span>退出登录</span>
              </div>

              <div
                style={{
                  position: 'absolute',
                  bottom: -5,
                  left: 28,
                  width: 0,
                  height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderTop: `6px solid ${isDark ? '#1c1c1f' : '#ffffff'}`
                }}
              />
            </div>
          )}
        </div>
      </Sider>

      <Layout style={{ marginLeft: 224 }}>
        <Content
          style={{
            padding: '16px 24px',
            paddingTop: 82,
            background: isDark ? '#09090b' : '#f5f5f4',
            overflow: 'auto',
            minHeight: '100vh'
          }}
        >
          <div className="page-content" style={{ maxWidth: contentMaxWidth }}>
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
