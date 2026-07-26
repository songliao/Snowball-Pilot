import { useState, useEffect } from 'react'
import { Input, Button, Alert, Segmented } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import logo from '../assets/logo.png'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serviceReady, setServiceReady] = useState<boolean | null>(null)
  const { login, loading, error } = useAuthStore()
  const mode = useThemeStore((s) => s.mode)
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)
  const isDark = mode === 'dark'

  // 检测服务是否就绪
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const ok = await window.api.auth.ping()
      if (!cancelled) setServiceReady(ok)
    }
    check()
    const timer = setInterval(check, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return
    await login(username.trim(), password)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div
      className="titlebar-drag"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark ? '#09090b' : '#f5f5f4'
      }}
    >
      <div
        style={{
          width: 340,
          padding: '44px 36px 32px',
          borderRadius: 14,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.4)'
            : '0 8px 32px rgba(0,0,0,0.06)',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        {/* Logo + Title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src={logo}
            alt="logo"
            style={{ width: 44, height: 44, borderRadius: 10, marginBottom: 12 }}
          />
          <div
            style={{
              fontSize: 21,
              fontWeight: 800,
              fontFamily: 'Nunito, -apple-system, sans-serif',
              color: isDark ? 'rgba(244,244,245,0.88)' : 'rgba(30,30,34,0.85)',
              letterSpacing: '-0.01em'
            }}
          >
            Snowball <span style={{ color: '#4d77ef' }}>P</span>ilot
          </div>
        </div>

        {/* 服务状态指示 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginBottom: 20,
          fontSize: 12,
          color: isDark ? 'rgba(244,244,245,0.55)' : 'rgba(30,30,34,0.5)'
        }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: serviceReady === null ? '#faad14' : serviceReady ? '#52c41a' : '#ff4d4f',
            boxShadow: serviceReady === true ? '0 0 4px rgba(82,196,26,0.5)' : serviceReady === false ? '0 0 4px rgba(255,77,79,0.5)' : 'none',
            display: 'inline-block'
          }} />
          <span>
            {serviceReady === null ? '正在连接服务...' : serviceReady ? '服务就绪' : '服务不可用'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 18, borderRadius: 6, fontSize: 12 }}
          />
        )}

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onKeyDown={handleKeyDown}>
          <Input
            size="large"
            placeholder="用户名"
            prefix={<UserOutlined style={{ opacity: 0.35 }} />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            style={{ borderRadius: 6, height: 38 }}
          />
          <Input.Password
            size="large"
            placeholder="密码"
            prefix={<LockOutlined style={{ opacity: 0.35 }} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ borderRadius: 6, height: 38 }}
          />
          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={handleLogin}
            disabled={!username.trim() || !password.trim() || serviceReady === false}
            style={{
              borderRadius: 6,
              height: 38,
              marginTop: 4,
              fontWeight: 600
            }}
          >
            登 录
          </Button>
        </div>

        {/* 主题切换 */}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
          <Segmented
            size="small"
            value={preference}
            options={[
              { label: '浅色', value: 'light' },
              { label: '暗黑', value: 'dark' },
              { label: '系统', value: 'system' }
            ]}
            onChange={(val) => setPreference(val as 'light' | 'dark' | 'system')}
            style={{ opacity: 0.75 }}
          />
        </div>
      </div>
    </div>
  )
}
