import { create } from 'zustand'

// 合约预警信号的可配置参数（设置页面可调整，持久化到 localStorage）
interface AlertSettingsState {
  // 敲出/派息观察的提前预警天数
  knockOutLeadDays: number
  // 敲出线临近阈值（%）：现价高于 敲出障碍×(1-阈值) 即视为临近
  knockOutNearPct: number
  // 派息线临近阈值（%）：现价高于 派息障碍×(1-阈值) 即视为临近
  couponNearPct: number
  // 敲入线临近阈值（%）：现价高于 敲入障碍 且低于 敲入障碍×(1+阈值) 即视为逼近
  knockInNearPct: number
  set: (partial: Partial<Omit<AlertSettingsState, 'set' | 'reset'>>) => void
  reset: () => void
}

const STORAGE_KEY = 'alert-settings'

const DEFAULTS = {
  knockOutLeadDays: 5,
  knockOutNearPct: 5,
  couponNearPct: 5,
  knockInNearPct: 10
}

export const ALERT_DEFAULTS = DEFAULTS

function getInitial(): Omit<AlertSettingsState, 'set' | 'reset'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        knockOutLeadDays:
          typeof parsed.knockOutLeadDays === 'number' ? parsed.knockOutLeadDays : DEFAULTS.knockOutLeadDays,
        knockOutNearPct:
          typeof parsed.knockOutNearPct === 'number' ? parsed.knockOutNearPct : DEFAULTS.knockOutNearPct,
        couponNearPct:
          typeof parsed.couponNearPct === 'number' ? parsed.couponNearPct : DEFAULTS.couponNearPct,
        knockInNearPct:
          typeof parsed.knockInNearPct === 'number' ? parsed.knockInNearPct : DEFAULTS.knockInNearPct
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

export const useAlertSettingsStore = create<AlertSettingsState>((set) => {
  const initial = getInitial()
  return {
    ...initial,
    set: (partial) => {
      set(partial)
      const s = useAlertSettingsStore.getState()
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          knockOutLeadDays: s.knockOutLeadDays,
          knockOutNearPct: s.knockOutNearPct,
          couponNearPct: s.couponNearPct,
          knockInNearPct: s.knockInNearPct
        })
      )
    },
    reset: () => {
      set({ ...DEFAULTS })
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS }))
    }
  }
})
