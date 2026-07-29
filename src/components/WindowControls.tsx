import { useState, useEffect } from 'react'
import { useThemeStore } from '../stores/themeStore'

/**
 * Windows 自定义窗口控制按钮（最小化 / 最大化 / 关闭）
 * 仅在非 macOS 平台显示（macOS 使用系统红绿灯）
 */
export default function WindowControls() {
  const mode = useThemeStore((s) => s.mode)
  const isDark = mode === 'dark'
  const [maximized, setMaximized] = useState(false)

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    if (!isMac) {
      window.api.win.isMaximized().then(setMaximized)
    }
  }, [isMac])

  // 仅 Windows/Linux 显示
  if (isMac) return null

  const btnStyle: React.CSSProperties = {
    width: 46,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: isDark ? 'rgba(244,244,245,0.7)' : 'rgba(30,30,34,0.6)',
    cursor: 'pointer',
    position: 'relative',
    pointerEvents: 'auto',
    WebkitAppRegion: 'no-drag',
    transition: 'background 0.15s, color 0.15s'
  } as React.CSSProperties

  const hoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const closeHoverBg = '#e81123'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 138,
        height: 36,
        display: 'flex',
        zIndex: 2147483647,
        pointerEvents: 'auto',
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}
    >
      {/* 最小化 */}
      <button
        style={btnStyle}
        onClick={() => window.api.win.minimize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-label="最小化"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* 最大化 / 还原 */}
      <button
        style={btnStyle}
        onClick={() => {
          window.api.win.maximize()
          setMaximized((v) => !v)
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-label={maximized ? '还原' : '最大化'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2.5" y="0.5" width="7" height="7" rx="1" />
            <path d="M0.5 2.5 L0.5 9.5 L7.5 9.5 L7.5 2.5" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>

      {/* 关闭 */}
      <button
        style={btnStyle}
        onClick={() => window.api.win.close()}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = closeHoverBg
          e.currentTarget.style.color = '#ffffff'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = isDark ? 'rgba(244,244,245,0.7)' : 'rgba(30,30,34,0.6)'
        }}
        aria-label="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  )
}
