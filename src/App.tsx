import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { ConfigProvider, theme as antTheme, message } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useThemeStore } from './stores/themeStore'
import { useAuthStore, SESSION_TTL } from './stores/authStore'
import AppLayout from './components/Layout'
import UpdateNotifier from './components/UpdateNotifier'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Positions from './pages/Positions'
import PositionForm from './pages/PositionForm'
import PositionDetail from './pages/PositionDetail'
import PositionAnalysis from './pages/PositionAnalysis'
import AlertSettings from './pages/AlertSettings'

import InstrumentManagement from './pages/InstrumentManagement'
import EventCalendar from './pages/EventCalendar'
import ContractCheck from './pages/ContractCheck'

export default function App() {
  const mode = useThemeStore((s) => s.mode)
  const isDark = mode === 'dark'
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const initializing = useAuthStore((s) => s.initializing)
  const loginTime = useAuthStore((s) => s.loginTime)
  const logout = useAuthStore((s) => s.logout)
  const dbReady = useAuthStore((s) => s.dbReady)
  const resume = useAuthStore((s) => s.resume)
  const init = useAuthStore((s) => s.init)

  // 启动时：从加密存储异步恢复登录态，解密完毕前显示加载占位
  useEffect(() => {
    init()
  }, [init])

  // 恢复登录态后，若本地已有凭据但数据库尚未打开，
  // 需先恢复对应用户的独立数据库，再渲染主界面，避免访问空库报错。
  useEffect(() => {
    if (isAuthenticated && !dbReady && !initializing) {
      resume()
    }
  }, [isAuthenticated, dbReady, initializing, resume])

  // 登录有效期为 30 天：本地记录登录时间，后台定期检查是否已过期；
  // 超过有效期则自动登出，要求重新登录（无需请求服务端校验）。
  useEffect(() => {
    if (!isAuthenticated || !loginTime) return
    let cancelled = false
    const checkExpiry = () => {
      if (cancelled) return
      if (Date.now() - loginTime > SESSION_TTL) {
        logout()
        message.warning('登录已过期（有效期 30 天），请重新登录')
      }
    }
    const timer = setInterval(checkExpiry, 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isAuthenticated, loginTime, logout])

  useEffect(() => {
    const bg = isDark ? '#09090b' : '#f5f5f4'
    document.body.style.background = bg
    document.documentElement.style.background = bg
    // 暴露主题到根元素，使 Tooltip 等渲染在 body 层的浮层也能读取主题
    document.documentElement.setAttribute('data-theme', mode)
    // 同步 Windows 原生窗口控制按钮颜色（跟随应用内主题切换）
    window.api.app.updateTitlebarOverlay(
      isDark ? '#09090b' : '#f5f5f4',
      isDark ? '#e4e4e7' : '#333333'
    )
  }, [isDark, mode])

  // 暴露运行平台到根元素：macOS 使用无边框 + 内嵌红绿灯，
  // Windows 使用隐藏标题栏 + 窗口控制按钮覆盖层
  useEffect(() => {
    const platform = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      ? 'mac'
      : /Win/.test(navigator.platform)
        ? 'win'
        : 'linux'
    document.documentElement.setAttribute('data-platform', platform)
  }, [])

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
          Tag: { borderRadiusSM: 5 },
          // Drawer 面板色与右上角控件区动画目标色保持一致（见 InstrumentManagement 的 overlay 渐变逻辑）
          Drawer: {
            colorBgElevated: isDark ? '#1f1f23' : '#ffffff'
          }
        }
      }}
    >
      <div data-theme={mode} style={{ minHeight: '100vh', background: isDark ? '#09090b' : '#f5f5f4' }}>
        {/* 全局更新提示：登录页与主界面均可见 */}
        <UpdateNotifier />
        {initializing ? (
          // 启动时正在从 OS 加密存储恢复凭据，短暂占位
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDark ? 'rgba(244,244,245,0.5)' : 'rgba(30,30,34,0.45)',
              fontSize: 14
            }}
          >
            正在加载数据…
          </div>
        ) : !isAuthenticated ? (
          <Login />
        ) : !dbReady ? (
          // 数据库尚未就绪（恢复会话中）：短暂占位，避免主界面访问空库
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDark ? 'rgba(244,244,245,0.5)' : 'rgba(30,30,34,0.45)',
              fontSize: 14
            }}
          >
            正在加载数据…
          </div>
        ) : (
          <HashRouter>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/positions/new" element={<PositionForm />} />
                <Route path="/positions/:type/:id/edit" element={<PositionForm />} />
                <Route path="/positions/:type/:id" element={<PositionDetail />} />
                {/* 旧链接兜底（无 type，getById 退回先雪球后凤凰） */}
                <Route path="/positions/:id/edit" element={<PositionForm />} />
                <Route path="/positions/:id" element={<PositionDetail />} />
                <Route path="/positions/analysis" element={<PositionAnalysis />} />
                <Route path="/instruments" element={<InstrumentManagement />} />
                <Route path="/contract-check" element={<ContractCheck />} />
                <Route path="/events" element={<EventCalendar />} />
                <Route path="/settings/alerts" element={<AlertSettings />} />
              </Routes>
            </AppLayout>
          </HashRouter>
        )}
      </div>
    </ConfigProvider>
  )
}
