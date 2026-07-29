import { create } from 'zustand'
import type { PriceData } from '../utils/calc'

interface MarketState {
  prices: Record<string, PriceData[]>
  latestPrices: Record<string, number>
  loading: boolean

  fetchPriceHistory: (code: string) => Promise<void>
  fetchLatestPrice: (code: string) => Promise<number | null>
  fetchRemotePrice: (code: string) => Promise<number | null>
  // 批量拉取实时行情并写入 latestPrices（供总览页预警卡片统一刷新，与详情页同源）
  fetchBatchLatest: (codes: string[]) => Promise<void>
  // 用数据库快照批量初始化 latestPrices（页面打开时、不调实时接口；已有实时价则不覆盖）
  hydrateSnapshot: (items: { code: string; price: number }[]) => void
  upsertPrice: (code: string, price: number, date: string, source?: string) => Promise<void>
}

export const useMarketStore = create<MarketState>((set, get) => ({
  prices: {},
  latestPrices: {},
  loading: false,

  fetchPriceHistory: async (code: string) => {
    const data = await window.api.prices.getByCode(code)
    set((state) => ({
      prices: { ...state.prices, [code]: data }
    }))
  },

  fetchLatestPrice: async (code: string) => {
    const data = await window.api.prices.getLatest(code)
    if (data) {
      // 不覆盖已存在的实时价，避免刷新后被旧的数据库快照覆盖
      set((state) => ({
        latestPrices:
          state.latestPrices[code] != null
            ? state.latestPrices
            : { ...state.latestPrices, [code]: data.price }
      }))
      return data.price
    }
    return null
  },

  // 统一使用指数完整行情接口（与总览页 refreshAlertPrices 同源），保证各页面敲入/敲出距离一致
  fetchRemotePrice: async (code: string) => {
    set({ loading: true })
    try {
      const result = await window.api.market.fetchIndexQuote(code)
      if (result && typeof result.price === 'number') {
        const today = new Date().toISOString().split('T')[0]
        // 自动保存到本地
        await window.api.prices.upsert({
          underlying_code: code,
          price: result.price,
          date: today,
          source: 'auto'
        })
        set((state) => ({
          latestPrices: { ...state.latestPrices, [code]: result.price }
        }))
        return result.price
      }
      return null
    } finally {
      set({ loading: false })
    }
  },

  // 批量拉取实时行情（指数完整行情接口），写入 latestPrices，供总览页预警卡片刷新
  fetchBatchLatest: async (codes: string[]) => {
    if (!codes.length) return
    const updated: Record<string, number> = {}
    await Promise.all(
      codes.map(async (code) => {
        const q = await window.api.market.fetchIndexQuote(code)
        if (q && typeof q.price === 'number') updated[code] = q.price
      })
    )
    if (Object.keys(updated).length) {
      set((state) => ({ latestPrices: { ...state.latestPrices, ...updated } }))
    }
  },

  // 用数据库快照批量初始化 latestPrices（页面打开时调用，不调实时接口）
  hydrateSnapshot: (items: { code: string; price: number }[]) => {
    set((state) => {
      const next = { ...state.latestPrices }
      for (const it of items) if (next[it.code] == null) next[it.code] = it.price
      return { latestPrices: next }
    })
  },

  upsertPrice: async (code, price, date, source = 'manual') => {
    await window.api.prices.upsert({
      underlying_code: code,
      price,
      date,
      source
    })
    set((state) => ({
      latestPrices: { ...state.latestPrices, [code]: price }
    }))
    await get().fetchPriceHistory(code)
  }
}))
