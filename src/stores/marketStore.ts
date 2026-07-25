import { create } from 'zustand'
import type { PriceData } from '../utils/calc'

interface MarketState {
  prices: Record<string, PriceData[]>
  latestPrices: Record<string, number>
  loading: boolean

  fetchPriceHistory: (code: string) => Promise<void>
  fetchLatestPrice: (code: string) => Promise<number | null>
  fetchRemotePrice: (code: string) => Promise<number | null>
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
      set((state) => ({
        latestPrices: { ...state.latestPrices, [code]: data.price }
      }))
      return data.price
    }
    return null
  },

  fetchRemotePrice: async (code: string) => {
    set({ loading: true })
    try {
      const result = await window.api.market.fetchPrice(code)
      if (result) {
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
