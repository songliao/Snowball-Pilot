import { create } from 'zustand'

// 本机用户名：沿用历史会话的账号（老用户数据无缝延续），无历史则使用 local 库。
// 与 iOS 端保持一致：2026-10-19 起免登录直启，启动即进主界面。
const DEFAULT_USERNAME = 'local'

// localStorage key：用户名经 OS 级加密后以 base64 存储。
// key 后缀 _enc 标记已加密数据，与旧版明文 key 区分。
const KEY_USER = 'auth-username_enc'

interface AuthState {
  username: string
  /** 启动时异步确定本机用户名，期间显示加载占位 */
  initializing: boolean
  /** 主进程是否已打开本机数据库；未就绪前不渲染主界面，避免访问空库 */
  dbReady: boolean
  /** 数据库打开失败时的提示文案 */
  error: string
  /** 启动时调用：确定用户名 */
  init: () => Promise<void>
  /** 打开本机数据库（并触发行情历史补足） */
  resume: () => Promise<void>
}

// ——— 安全存储辅助函数 ———
// encrypt/decrypt 转发给主进程 safeStorage（macOS Keychain / Windows DPAPI）。
async function secureGet(key: string): Promise<string | null> {
  const encrypted = localStorage.getItem(key)
  if (encrypted) {
    try {
      const plain = await window.api.secureStore.decrypt(encrypted)
      if (plain != null) return plain
    } catch {
      // 解密失败，可能是旧数据损坏或 OS 密钥变更；回退读取明文副本
    }
  }
  return localStorage.getItem(key.replace(/_enc$/, ''))
}

export const useAuthStore = create<AuthState>((set, get) => ({
  username: '',
  initializing: true,
  dbReady: false,
  error: '',

  init: async () => {
    let username = DEFAULT_USERNAME
    try {
      const stored = await secureGet(KEY_USER)
      if (stored && stored.trim()) username = stored.trim()
    } catch {
      // 读取失败：回退到 local 库
    }
    set({ username, initializing: false })
  },

  resume: async () => {
    const { username } = get()
    if (!username) return
    try {
      const ok = await window.api.auth.resume(username)
      set(ok ? { dbReady: true, error: '' } : { error: '数据库打开失败，请重启应用后重试' })
    } catch (e) {
      console.error('恢复本机数据库失败：', e)
      set({ error: '数据库打开失败，请重启应用后重试' })
    }
  }
}))
