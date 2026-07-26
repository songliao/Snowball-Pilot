import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { ConfigProvider, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useThemeStore } from './stores/themeStore'
import { useAuthStore } from './stores/authStore'
import AppLayout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Positions from './pages/Positions'
import PositionForm from './pages/PositionForm'
import PositionDetail from './pages/PositionDetail'
import Analysis from './pages/Analysis'

import InstrumentManagement from './pages/InstrumentManagement'
import EventCalendar from './pages/EventCalendar'

export default function App() {
  const mode = useThemeStore((s) => s.mode)
  const isDark = mode === 'dark'
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    const bg = isDark ? '#09090b' : '#f5f5f4'
    document.body.style.background = bg
    document.documentElement.style.background = bg
    // 暴露主题到根元素，使 Tooltip 等渲染在 body 层的浮层也能读取主题
    document.documentElement.setAttribute('data-theme', mode)
  }, [isDark, mode])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#e4e4e7' : '#3f3f46',
          colorSuccess: '#52c41a',
          colorWarning: '#faad14',
          colorError: '#ff4d4f',
          colorInfo: isDark ? '#a1a1aa' : '#52525b',
          // 聚焦高亮配色改为系统底色（与页面背景一致，视觉上不可见），
          // 避免 colorPrimary（近黑）被回退用于聚焦环而显示黑框
          controlOutlineWidth: 2,
          borderRadius: 8,
          fontSize: 13,
          fontFamily: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif`,
          ...(isDark
            ? {
                colorBgLayout: '#09090b',
                colorBgContainer: '#18181b',
                colorBgElevated: '#1f1f23',
                controlOutline: '#09090b',
                colorBorder: 'rgba(255,255,255,0.07)',
                colorBorderSecondary: 'rgba(255,255,255,0.04)',
                colorText: 'rgba(244,244,245,0.72)',
                colorTextSecondary: 'rgba(244,244,245,0.42)',
                colorTextTertiary: 'rgba(244,244,245,0.25)',
                boxShadow: '0 0.5px 1px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
                boxShadowSecondary: '0 4px 16px rgba(0,0,0,0.4)'
              }
            : {
                colorBgLayout: '#f5f5f4',
                colorBgContainer: '#ffffff',
                colorBgElevated: '#ffffff',
                controlOutline: '#f5f5f4',
                colorBorder: 'rgba(0,0,0,0.08)',
                colorBorderSecondary: 'rgba(0,0,0,0.04)',
                colorText: 'rgba(30,30,34,0.68)',
                colorTextSecondary: 'rgba(30,30,34,0.42)',
                colorTextTertiary: 'rgba(30,30,34,0.25)',
                boxShadow: '0 0.5px 1px rgba(0,0,0,0.03), 0 1px 3px rgba(0,0,0,0.04)',
                boxShadowSecondary: '0 4px 16px rgba(0,0,0,0.08)'
              })
        },
        components: {
          Card: {
            borderRadiusLG: 6,
            paddingLG: 20
          },
          Table: {
            borderRadiusLG: 10,
            fontSize: 13,
            ...(isDark
              ? { headerBg: 'rgba(255,255,255,0.03)', rowHoverBg: 'rgba(255,255,255,0.035)' }
              : { headerBg: 'rgba(0,0,0,0.015)', rowHoverBg: 'rgba(0,0,0,0.018)' })
          },
          Button: {
            borderRadius: 8,
            controlHeight: 34,
            defaultBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
            defaultBorderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            defaultHoverBg: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            defaultHoverBorderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
            defaultActiveBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
            defaultActiveBorderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            defaultColor: isDark ? 'rgba(244,244,245,0.6)' : 'rgba(30,30,34,0.6)',
            defaultHoverColor: isDark ? 'rgba(244,244,245,0.8)' : 'rgba(30,30,34,0.78)',
            defaultActiveColor: isDark ? 'rgba(244,244,245,0.6)' : 'rgba(30,30,34,0.6)',
            primaryColor: isDark ? '#09090b' : '#ffffff'
          },
          Menu: {
            itemBorderRadius: 7,
            itemMarginInline: 8,
            itemHeight: 36,
            fontSize: 13,
            ...(isDark
              ? { itemSelectedBg: 'rgba(255,255,255,0.08)', itemSelectedColor: 'rgba(244,244,245,0.85)', itemHoverBg: 'rgba(255,255,255,0.04)' }
              : { itemSelectedBg: 'rgba(0,0,0,0.05)', itemSelectedColor: 'rgba(30,30,34,0.8)', itemHoverBg: 'rgba(0,0,0,0.03)' })
          },
          Segmented: {
            borderRadius: 8,
            ...(isDark
              ? { itemSelectedBg: 'rgba(255,255,255,0.12)', itemSelectedColor: 'rgba(244,244,245,0.85)', trackBg: 'rgba(255,255,255,0.05)' }
              : { itemSelectedBg: '#ffffff', itemSelectedColor: 'rgba(30,30,34,0.78)', trackBg: 'rgba(0,0,0,0.04)' })
          },
          Input: {
            borderRadius: 6,
            activeBorderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
            hoverBorderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
            activeShadow: 'none'
          },
          // InputNumber / Select / DatePicker 各自独立组件，需单独覆盖聚焦边框色，
          // 否则回退到 colorPrimary（近黑）导致聚焦出现黑框
          InputNumber: {
            borderRadius: 6,
            activeBorderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
            hoverBorderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
            activeShadow: 'none'
          },
          Select: {
            borderRadius: 8,
            activeBorderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
            hoverBorderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
            activeShadow: 'none'
          },
          DatePicker: {
            borderRadius: 6,
            activeBorderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
            hoverBorderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
            activeShadow: 'none'
          },
          Tag: { borderRadiusSM: 5 }
        }
      }}
    >
      <div data-theme={mode} style={{ minHeight: '100vh', background: isDark ? '#09090b' : '#f5f5f4' }}>
        {!isAuthenticated ? (
          <Login />
        ) : (
          <HashRouter>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/positions/new" element={<PositionForm />} />
                <Route path="/positions/:id/edit" element={<PositionForm />} />
                <Route path="/positions/:id" element={<PositionDetail />} />
                <Route path="/analysis" element={<Analysis />} />
                <Route path="/instruments" element={<InstrumentManagement />} />
                <Route path="/events" element={<EventCalendar />} />
              </Routes>
            </AppLayout>
          </HashRouter>
        )}
      </div>
    </ConfigProvider>
  )
}
