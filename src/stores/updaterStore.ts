import { create } from 'zustand'
import type { UpdaterEvent } from '../../electron/services/updater-types'

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface UpdaterState {
  phase: UpdaterPhase
  version?: string
  percent: number
  message?: string
  /** 本次会话用户是否已关闭「更新已就绪」弹窗（关闭后不再主动打扰） */
  dismissed: boolean

  /** 主动检查更新（主进程启动后也会静默查一次） */
  check: () => Promise<void>
  /** 手动触发下载；autoDownload 已开启时通常不需要调用 */
  download: () => Promise<void>
  /** 退出并应用已下载的更新 */
  install: () => Promise<void>
  /** 忽略「更新已就绪」弹窗 */
  dismiss: () => void
  /** 接收主进程推送的状态事件 */
  applyEvent: (event: UpdaterEvent) => void
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  phase: 'idle',
  percent: 0,
  dismissed: false,

  check: async () => {
    set({ phase: 'checking', percent: 0 })
    const result = await window.api.updater.check()
    if (!result.ok) {
      set({
        phase: 'error',
        message: result.reason === 'dev-mode' ? '开发模式不支持更新' : result.reason || '检查失败'
      })
      return
    }
    if (!result.updateAvailable) {
      set({ phase: 'idle', percent: 0 })
    }
  },

  download: async () => {
    // autoDownload 开启后，check 结束即自动开始下载，无需重复触发
    if (get().phase === 'downloading' || get().phase === 'downloaded') return
    set({ phase: 'downloading', percent: 0 })
    await window.api.updater.download()
  },

  install: async () => {
    await window.api.updater.install()
  },

  dismiss: () => set({ dismissed: true }),

  applyEvent: (event: UpdaterEvent) => {
    switch (event.type) {
      case 'checking':
        set({ phase: 'checking', percent: 0 })
        break
      case 'available':
        set({ phase: 'available', version: event.version, percent: 0, dismissed: false })
        break
      case 'not-available':
        set({ phase: 'idle', percent: 0 })
        break
      case 'progress':
        set({ phase: 'downloading', percent: Math.round(event.percent) })
        break
      case 'downloaded':
        // 新版本就绪时重置 dismissed，确保用户能收到提示
        set({ phase: 'downloaded', version: event.version, percent: 100, dismissed: false })
        break
      case 'error':
        set({ phase: 'error', message: event.message })
        break
    }
  }
}))
