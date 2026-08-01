import { create } from 'zustand'

// 登录有效期：30 天，超过则需重新登录
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

// localStorage key：凭据经 OS 级加密后以 base64 存储，渲染进程永不见明文。
// key 后缀 _enc 标记已加密数据，与旧版明文 key 区分，便于迁移清理。
const KEY_TOKEN = 'auth-token_enc'
const KEY_USER = 'auth-username_enc'
const KEY_TIME = 'auth-login-time_enc'
// 旧版明文 key（迁移后清理）
const OLD_KEYS = ['auth-token', 'auth-username', 'auth-login-time']

interface AuthState {
  isAuthenticated: boolean
  username: string
  token: string
  loginTime: number
  loading: boolean
  error: string
  initializing: boolean
  // 主进程是否已为该用户打开独立数据库；未就绪前不渲染主界面，避免访问空库
  dbReady: boolean
  /** 启动时调用：从加密存储恢复登录态 */
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  /** 应用启动时若本地已保存登录态，恢复对应账号的数据库 */
  resume: () => Promise<void>
}

// ——— 安全存储辅助函数 ———
// encrypt/decrypt 转发给主进程 safeStorage（macOS Keychain / Windows DPAPI）。
// 若 OS 加密不可用则回退到明文 localStorage。
async function secureSet(key: string, value: string): Promise<void> {
  const encrypted = await window.api.secureStore.encrypt(value)
  if (encrypted) {
    // 加密成功：存 base64 密文，同时写明文副本到旧 key 以保证回退兼容
    localStorage.setItem(key, encrypted)
    // 迁移：清除旧明文 key
    for (const ok of OLD_KEYS) localStorage.removeItem(ok)
  } else {
    // 加密不可用：回退明文（仅存到旧 key，不标 _enc）
    const fallback = key.replace(/_enc$/, '')
    localStorage.setItem(fallback, value)
  }
}

async function secureGet(key: string): Promise<string | null> {
  const encrypted = localStorage.getItem(key)
  if (encrypted) {
    try {
      const plain = await window.api.secureStore.decrypt(encrypted)
      if (plain != null) return plain
    } catch {
      // 解密失败，可能是旧数据损坏或 OS 密钥变更
    }
  }
  // 回退：尝试读取旧版明文 key（兼容从明文版本升级的用户）
  const fallback = key.replace(/_enc$/, '')
  const legacy = localStorage.getItem(fallback)
  if (legacy) {
    // 自动迁移：读到明文后立刻加密存储，后续不再走回退路径
    secureSet(key, legacy)
    return legacy
  }
  return null
}

function secureRemove(key: string): void {
  localStorage.removeItem(key)
  localStorage.removeItem(key.replace(/_enc$/, ''))
}

// ——— 过期判断（客户端时间，无需服务端校验）———
function isExpired(loginTime: number): boolean {
  return Date.now() - loginTime > SESSION_TTL
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  username: '',
  token: '',
  loginTime: 0,
  loading: false,
  error: '',
  initializing: true,
  dbReady: false,

  init: async () => {
    try {
      const token = await secureGet(KEY_TOKEN)
      const username = await secureGet(KEY_USER)
      const timeStr = await secureGet(KEY_TIME)

      if (token && username && timeStr) {
        const loginTime = Number(timeStr)
        if (!Number.isNaN(loginTime) && !isExpired(loginTime)) {
          set({
            isAuthenticated: true,
            username,
            token,
            loginTime,
            initializing: false
          })
          return
        }
        // 凭据已过期，清理
        secureRemove(KEY_TOKEN)
        secureRemove(KEY_USER)
        secureRemove(KEY_TIME)
      }
    } catch {
      // 读取失败：视为未登录
    }
    set({ initializing: false })
  },

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

      // 凭据经 OS 级加密后再落 localStorage，渲染进程永不见明文
      await Promise.all([
        secureSet(KEY_TOKEN, token),
        secureSet(KEY_USER, username),
        secureSet(KEY_TIME, String(loginTime))
      ])

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
    const { username } = get()
    if (!username) {
      set({ isAuthenticated: false, dbReady: false })
      return
    }
    try {
      await window.api.auth.resume(username)
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

    // 清除加密凭据 + 旧明文 key（彻底清理）
    secureRemove(KEY_TOKEN)
    secureRemove(KEY_USER)
    secureRemove(KEY_TIME)

    set({ isAuthenticated: false, username: '', token: '', loginTime: 0, error: '', dbReady: false })
  }
}))
