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
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
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

export const useAuthStore = create<AuthState>((set) => {
  const stored = getStoredAuth()

  return {
    isAuthenticated: !!stored,
    username: stored?.username || '',
    token: stored?.token || '',
    loginTime: stored?.loginTime || 0,
    loading: false,
    error: '',

    login: async (username: string, password: string) => {
      set({ loading: true, error: '' })
      try {
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
          error: ''
        })
        return true
      } catch {
        set({ loading: false, error: '网络连接失败，请检查网络后重试' })
        return false
      }
    },

    logout: () => {
      localStorage.removeItem('auth-token')
      localStorage.removeItem('auth-username')
      localStorage.removeItem('auth-login-time')
      set({ isAuthenticated: false, username: '', token: '', loginTime: 0, error: '' })
    }
  }
})
