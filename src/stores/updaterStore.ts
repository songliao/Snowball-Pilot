import { create } from 'zustand'
import type { UpdaterEvent, UpdaterErrorCode } from '../../electron/services/updater-types'

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
  /** 可直接展示的简短错误文案 */
  message?: string
  /** 错误分类 */
  code?: UpdaterErrorCode
  /** 原始错误（响应体 / 堆栈），只在用户主动点「查看详情」时展示 */
  detail?: string
  /** 一次性提示，例如「已是最新版本」，展示后自动清除 */
  notice?: string
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

let noticeTimer: ReturnType<typeof setTimeout> | null = null

/** 设置一次性提示，若干秒后自动消失 */
function setNotice(set: (partial: Partial<UpdaterState>) => void, text: string, ms = 3000): void {
  set({ notice: text })
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => set({ notice: undefined }), ms)
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  phase: 'idle',
  percent: 0,
  dismissed: false,

  check: async () => {
    set({ phase: 'checking', percent: 0, message: undefined, detail: undefined, notice: undefined })
    const result = await window.api.updater.check()
    if (!result.ok) {
      // reason 已是主进程归一化后的短文案，detail 只在详情里看
      set({ phase: 'error', message: result.reason || '检查失败', code: result.code, detail: result.detail })
      return
    }
    if (!result.updateAvailable) {
      set({ phase: 'idle', percent: 0 })
      setNotice(set, '已是最新版本')
    }
  },

  download: async () => {
    // autoDownload 开启后，check 结束即自动开始下载，无需重复触发
    if (get().phase === 'downloading' || get().phase === 'downloaded') return
    set({ phase: 'downloading', percent: 0 })
    const result = await window.api.updater.download()
    if (!result.ok && result.reason) {
      set({ phase: 'error', message: result.reason, code: result.code, detail: result.detail })
    }
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
        // 静默轮询的结果不打扰用户，只回到空闲态
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
        set({ phase: 'error', message: event.message, code: event.code, detail: event.detail })
        break
    }
  }
}))
