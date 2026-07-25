import { contextBridge, ipcRenderer } from 'electron'

export interface PositionData {
  id?: number
  product_name: string
  broker: string
  underlying: string
  underlying_code: string
  notional: number
  trade_date: string
  effective_date: string
  maturity_date: string
  initial_price: number
  knock_in_pct: number
  knock_out_pct: number
  coupon_rate: number
  observation_freq: string
  knock_in_observed: number
  knock_out_observed: number
  status: string
  notes: string
  created_at?: string
  updated_at?: string
}

export interface PriceData {
  id?: number
  underlying_code: string
  price: number
  date: string
  source: string
}

export interface EventData {
  id?: number
  position_id: number
  event_type: string
  event_date: string
  description: string
  created_at?: string
}

const api = {
  // 持仓操作
  positions: {
    getAll: (): Promise<PositionData[]> => ipcRenderer.invoke('positions:get-all'),
    getById: (id: number): Promise<PositionData | null> =>
      ipcRenderer.invoke('positions:get-by-id', id),
    create: (data: Omit<PositionData, 'id' | 'created_at' | 'updated_at'>): Promise<number> =>
      ipcRenderer.invoke('positions:create', data),
    update: (id: number, data: Partial<PositionData>): Promise<boolean> =>
      ipcRenderer.invoke('positions:update', id, data),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('positions:delete', id),
    updateStatus: (id: number, status: string): Promise<boolean> =>
      ipcRenderer.invoke('positions:update-status', id, status)
  },

  // 价格操作
  prices: {
    getByCode: (code: string, limit?: number): Promise<PriceData[]> =>
      ipcRenderer.invoke('prices:get-by-code', code, limit),
    getLatest: (code: string): Promise<PriceData | null> =>
      ipcRenderer.invoke('prices:get-latest', code),
    upsert: (data: Omit<PriceData, 'id'>): Promise<boolean> =>
      ipcRenderer.invoke('prices:upsert', data),
    deleteByCode: (code: string): Promise<boolean> =>
      ipcRenderer.invoke('prices:delete-by-code', code)
  },

  // 事件操作
  events: {
    getByPositionId: (positionId: number): Promise<EventData[]> =>
      ipcRenderer.invoke('events:get-by-position-id', positionId),
    create: (data: Omit<EventData, 'id' | 'created_at'>): Promise<number> =>
      ipcRenderer.invoke('events:create', data),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('events:delete', id)
  },

  // 行情
  market: {
    fetchPrice: (code: string): Promise<{ price: number; name: string } | null> =>
      ipcRenderer.invoke('market:fetch-price', code),
    fetchIndexQuote: (code: string): Promise<{
      code: string; name: string; price: number; change: number; changePct: number;
      open: number; high: number; low: number; prevClose: number;
      volume: number; amount: number; updateTime: string
    } | null> =>
      ipcRenderer.invoke('market:fetch-index-quote', code)
  },

  // 通知
  notification: {
    check: (): Promise<string[]> => ipcRenderer.invoke('notification:check')
  },

  // 指数历史数据
  indexHistory: {
    backfill: (days?: number): Promise<{ code: string; saved: number }[]> =>
      ipcRenderer.invoke('index-history:backfill', days),
    get: (code: string, limit?: number): Promise<{ id: number; underlying_code: string; price: number; date: string; source: string }[]> =>
      ipcRenderer.invoke('index-history:get', code, limit)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
