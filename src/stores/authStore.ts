import { create } from 'zustand'

// 登录有效期：30 天，超过则需重新登录
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

interface AuthState {
  isAuthenticated: boolean
  username: string
  token: string
  loginTime: number
  loading: boolean
  error: string
  // 主进程是否已为该用户打开独立数据库；未就绪前不渲染主界面，避免访问空库
  dbReady: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  // 应用启动时若本地已保存登录态，恢复对应账号的数据库
  resume: () => Promise<void>
}

function getStoredAuth(): { username: string; token: string; loginTime: number } | null {
  const token = localStorage.getItem('auth-token')
  const username = localStorage.getItem('auth-username')
  const loginTimeStr = localStorage.getItem('auth-login-time')
  if (token && username && loginTimeStr) {
    const loginTime = Number(loginTimeStr)
    // 超过 30 天有效期则视为未登录，并清理本地凭证
    if (Date.now() - loginTime > SESSION_TTL) {
      localStorage.removeItem('auth-token')
      localStorage.removeItem('auth-username')
      localStorage.removeItem('auth-login-time')
      return null
    }
    return { username, token, loginTime }
  }
  return null
}

export const useAuthStore = create<AuthState>((set, get) => {
  const stored = getStoredAuth()

  return {
    isAuthenticated: !!stored,
    username: stored?.username || '',
    token: stored?.token || '',
    loginTime: stored?.loginTime || 0,
    loading: false,
    error: '',
    dbReady: false,

    login: async (username: string, password: string) => {
      set({ loading: true, error: '' })
      try {
        // 主进程在返回前已完成「打开该用户独立数据库 + 补足行情历史」
        const result = await window.api.auth.login(username, password)
        if (result.error) {
          set({ loading: false, error: '网络连接失败，请检查网络后重试' })
          return false
        }
        if (!result.ok) {
          const msg = result.data?.message || result.data?.detail || `登录失败 (${result.status})`
          set({ loading: false, error: msg })
          return false
        }
        // 远程鉴权通过，但本地用户数据库打开失败（如文件名编码问题）：不要进入主界面，直接暴露错误
        if (result.dbError) {
          set({ loading: false, error: `数据库打开失败：${result.dbError}` })
          return false
        }
        const token = result.data?.token || result.data?.data?.token || ''
        const loginTime = Date.now()
        localStorage.setItem('auth-token', token)
        localStorage.setItem('auth-username', username)
        localStorage.setItem('auth-login-time', loginTime.toString())
        set({
          isAuthenticated: true,
          username,
          token,
          loginTime,
          loading: false,
          error: '',
          dbReady: true
        })
        return true
      } catch {
        set({ loading: false, error: '网络连接失败，请检查网络后重试' })
        return false
      }
    },

    resume: async () => {
      const stored = getStoredAuth()
      if (!stored) {
        set({ isAuthenticated: false, dbReady: false })
        return
      }
      try {
        await window.api.auth.resume(stored.username)
        set({ dbReady: true })
      } catch (e) {
        console.error('恢复用户数据库失败：', e)
      }
    },

    logout: async () => {
      // 通知主进程关闭当前用户数据库（落盘），再清理本地凭证
      try {
        await window.api.auth.logout()
      } catch { /* 忽略主进程未就绪等异常 */ }
      localStorage.removeItem('auth-token')
      localStorage.removeItem('auth-username')
      localStorage.removeItem('auth-login-time')
      set({ isAuthenticated: false, username: '', token: '', loginTime: 0, error: '', dbReady: false })
    }
  }
})
