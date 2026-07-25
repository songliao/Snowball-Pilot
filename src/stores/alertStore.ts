import { create } from 'zustand'

export interface PriceAlert {
  id: string
  code: string        // 指数代码 e.g. '000852.SH'
  label: string       // 指数名称 e.g. '中证1000'
  targetPrice: number // 目标价格
  direction: 'above' | 'below' // 到达方向
  enabled: boolean
  triggered: boolean  // 是否已触发
  createdAt: string
}

interface AlertState {
  alerts: PriceAlert[]
  addAlert: (alert: Omit<PriceAlert, 'id' | 'triggered' | 'createdAt'>) => void
  removeAlert: (id: string) => void
  toggleAlert: (id: string) => void
  markTriggered: (id: string) => void
  checkAlerts: (prices: Record<string, number>) => PriceAlert[]
}

const STORAGE_KEY = 'price-alerts'

function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts))
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: loadAlerts(),

  addAlert: (alert) => {
    const newAlert: PriceAlert = {
      ...alert,
      id: `${alert.code}-${Date.now()}`,
      triggered: false,
      createdAt: new Date().toISOString()
    }
    const alerts = [...get().alerts, newAlert]
    saveAlerts(alerts)
    set({ alerts })
  },

  removeAlert: (id) => {
    const alerts = get().alerts.filter((a) => a.id !== id)
    saveAlerts(alerts)
    set({ alerts })
  },

  toggleAlert: (id) => {
    const alerts = get().alerts.map((a) =>
      a.id === id ? { ...a, enabled: !a.enabled, triggered: false } : a
    )
    saveAlerts(alerts)
    set({ alerts })
  },

  markTriggered: (id) => {
    const alerts = get().alerts.map((a) =>
      a.id === id ? { ...a, triggered: true } : a
    )
    saveAlerts(alerts)
    set({ alerts })
  },

  // 检查是否有提醒触发，返回新触发的提醒列表
  checkAlerts: (prices) => {
    const { alerts, markTriggered } = get()
    const triggered: PriceAlert[] = []

    for (const alert of alerts) {
      if (!alert.enabled || alert.triggered) continue
      const price = prices[alert.code]
      if (!price) continue

      const hit = alert.direction === 'above'
        ? price >= alert.targetPrice
        : price <= alert.targetPrice

      if (hit) {
        triggered.push(alert)
        markTriggered(alert.id)
      }
    }

    return triggered
  }
}))
