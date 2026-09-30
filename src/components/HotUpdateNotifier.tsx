import { useEffect, useState } from 'react'
import { ConfigProvider, Modal, Progress } from 'antd'
import { useThemeStore } from '../stores/themeStore'
import { solidButtonTheme } from '../utils/solidButtonTheme'
import type { HotUpdateEvent } from '../../electron/services/hot-update-types'

/**
 * 渲染层热更新提示：挂在主界面外层（登录页同样可见）。
 * - 主进程启动后静默检查清单并后台下载校验，这里只负责展示进度
 * - 应用完成后弹一次「立即刷新」；点「稍后」则下次启动窗口时自动生效
 * - 后台轮询的失败不打扰用户（主进程已写日志），只有下载中的进度与就绪态会展示
 */
export default function HotUpdateNotifier() {
  const isDark = useThemeStore((s) => s.mode === 'dark')
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'ready'>('idle')
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    if (!window.api?.hotUpdate?.onEvent) return
    return window.api.hotUpdate.onEvent((event: HotUpdateEvent) => {
      switch (event.type) {
        case 'progress':
          setPhase('downloading')
          setPercent(event.percent)
          break
        case 'applied':
          setPhase('ready')
          setPercent(100)
          setVersion(event.rendererVersion)
          setNotes(event.notes || '')
          break
        case 'error':
          // 静默：热更新是锦上添花，失败不影响现有功能，主进程已写 updater.log
          setPhase('idle')
          setPercent(0)
          break
        default:
          break
      }
    })
  }, [])

  const surface = isDark ? '#1f1f23' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const text = isDark ? 'rgba(244,244,245,0.8)' : 'rgba(30,30,34,0.78)'
  const muted = isDark ? 'rgba(244,244,245,0.42)' : 'rgba(30,30,34,0.45)'

  const reload = (): void => {
    void window.api.hotUpdate.reload()
  }

  return (
    <>
      {phase === 'downloading' && (
        <div
          style={{
            position: 'fixed',
            right: 20,
            // 全量更新的进度卡片占据右下角，这里往上错开，二者可能同时下载
            bottom: 96,
            width: 260,
            padding: '12px 14px',
            borderRadius: 10,
            background: surface,
            border: `1px solid ${border}`,
            boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.08)',
            zIndex: 1000
          }}
        >
          <div style={{ fontSize: 13, color: text, marginBottom: 8 }}>正在接收界面更新…</div>
          <Progress percent={percent} size="small" showInfo={false} />
          <div style={{ fontSize: 11, color: muted, marginTop: 6 }}>{percent}%</div>
        </div>
      )}

      {/* 按钮不使用全局磨砂默认样式：包一层局部主题改为实底 */}
      <ConfigProvider theme={solidButtonTheme(isDark)}>
        <Modal
          open={phase === 'ready'}
          title="界面更新已就绪"
          className="solid-modal"
          okText="立即刷新"
          cancelText="下次启动时生效"
          onOk={reload}
          onCancel={() => setPhase('idle')}
          closable={false}
          maskClosable={false}
          width={380}
        >
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            新版界面 <strong>{version}</strong> 已下载完成，刷新后立即生效，无需重启应用。
            {notes && (
              <div style={{ marginTop: 8, color: muted, whiteSpace: 'pre-wrap' }}>{notes}</div>
            )}
          </div>
        </Modal>
      </ConfigProvider>
    </>
  )
}
