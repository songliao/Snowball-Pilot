import { useEffect } from 'react'
import { Modal, Progress } from 'antd'
import { useUpdaterStore } from '../stores/updaterStore'
import { useThemeStore } from '../stores/themeStore'

/**
 * 全局更新提示：挂在主界面外层，登录页同样可见。
 * - 主进程启动后静默检查并后台下载（autoDownload），此处只负责展示进度
 * - 下载完成后弹出一次「重启并安装」；用户可稍后，之后不再重复打扰
 */
export default function UpdateNotifier() {
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const phase = useUpdaterStore((s) => s.phase)
  const version = useUpdaterStore((s) => s.version)
  const percent = useUpdaterStore((s) => s.percent)
  const dismissed = useUpdaterStore((s) => s.dismissed)
  const applyEvent = useUpdaterStore((s) => s.applyEvent)
  const install = useUpdaterStore((s) => s.install)
  const dismiss = useUpdaterStore((s) => s.dismiss)

  // 订阅主进程推送的更新事件
  useEffect(() => {
    if (!window.api?.updater?.onEvent) return
    return window.api.updater.onEvent(applyEvent)
  }, [applyEvent])

  const surface = isDark ? '#1f1f23' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const text = isDark ? 'rgba(244,244,245,0.8)' : 'rgba(30,30,34,0.78)'
  const muted = isDark ? 'rgba(244,244,245,0.42)' : 'rgba(30,30,34,0.45)'

  const showProgress = phase === 'checking' || phase === 'downloading'
  const showReady = phase === 'downloaded' && !dismissed

  return (
    <>
      {showProgress && (
        <div
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            width: 260,
            padding: '12px 14px',
            borderRadius: 10,
            background: surface,
            border: `1px solid ${border}`,
            boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.08)',
            zIndex: 1000
          }}
        >
          <div style={{ fontSize: 13, color: text, marginBottom: 8 }}>
            {phase === 'checking'
              ? '正在检查更新…'
              : `正在下载新版本${version ? ` ${version}` : ''}`}
          </div>
          <Progress
            percent={phase === 'checking' ? undefined : percent}
            size="small"
            status={phase === 'checking' ? 'active' : 'normal'}
            showInfo={phase !== 'checking'}
          />
          <div style={{ fontSize: 11, color: muted, marginTop: 6 }}>
            {phase === 'checking' ? '连接更新服务器' : `${percent}%`}
          </div>
        </div>
      )}

      <Modal
        open={showReady}
        title="新版本已就绪"
        okText="立即重启并安装"
        cancelText="稍后"
        onOk={install}
        onCancel={dismiss}
        closable={false}
        maskClosable={false}
        width={380}
      >
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          版本 <strong>{version}</strong> 已下载完成，重启应用即可生效。
        </div>
      </Modal>
    </>
  )
}
