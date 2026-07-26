import { create } from 'zustand'

interface AuthState {
  isAuthenticated: boolean
  username: string
  token: string
  loading: boolean
  error: string
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

function getStoredAuth(): { username: string; token: string } | null {
  const token = localStorage.getItem('auth-token')
  const username = localStorage.getItem('auth-username')
  if (token && username) return { username, token }
  return null
}

export const useAuthStore = create<AuthState>((set) => {
  const stored = getStoredAuth()

  return {
    isAuthenticated: !!stored,
    username: stored?.username || '',
    token: stored?.token || '',
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

        localStorage.setItem('auth-token', token)
        localStorage.setItem('auth-username', username)

        set({
          isAuthenticated: true,
          username,
          token,
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
      set({ isAuthenticated: false, username: '', token: '', error: '' })
    }
  }
})
