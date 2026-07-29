import { create } from 'zustand'

type ThemePreference = 'system' | 'light' | 'dark'
type ResolvedMode = 'light' | 'dark'

interface ThemeState {
  preference: ThemePreference
  mode: ResolvedMode
  setPreference: (pref: ThemePreference) => void
}

function getSystemMode(): ResolvedMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveMode(pref: ThemePreference): ResolvedMode {
  if (pref === 'system') return getSystemMode()
  return pref
}

function getInitialPreference(): ThemePreference {
  const saved = localStorage.getItem('theme-preference')
  if (saved === 'system' || saved === 'light' || saved === 'dark') return saved
  return 'dark'
}

// 监听系统主题变化
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

export const useThemeStore = create<ThemeState>((set, get) => {
  // 系统主题变化时，如果当前是 system 模式则跟随
  mediaQuery.addEventListener('change', () => {
    if (get().preference === 'system') {
      set({ mode: getSystemMode() })
    }
  })

  const preference = getInitialPreference()
  return {
    preference,
    mode: resolveMode(preference),
    setPreference: (pref: ThemePreference) => {
      localStorage.setItem('theme-preference', pref)
      set({ preference: pref, mode: resolveMode(pref) })
    }
  }
})
