import { create } from 'zustand'
import type { PositionData, EventData } from '../utils/calc'

interface PositionState {
  positions: PositionData[]
  loading: boolean
  current: PositionData | null
  events: EventData[]

  fetchAll: () => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (data: Omit<PositionData, 'id' | 'created_at' | 'updated_at'>) => Promise<number>
  update: (id: number, data: Partial<PositionData>) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  updateStatus: (id: number, status: string) => Promise<boolean>
  fetchEvents: (positionId: number) => Promise<void>
  addEvent: (data: Omit<EventData, 'id' | 'created_at'>) => Promise<number>
}

export const usePositionStore = create<PositionState>((set, get) => ({
  positions: [],
  loading: false,
  current: null,
  events: [],

  fetchAll: async () => {
    set({ loading: true })
    try {
      const positions = await window.api.positions.getAll()
      set({ positions })
    } finally {
      set({ loading: false })
    }
  },

  fetchById: async (id: number) => {
    const current = await window.api.positions.getById(id)
    set({ current })
  },

  create: async (data) => {
    const id = await window.api.positions.create(data)
    await get().fetchAll()
    return id
  },

  update: async (id, data) => {
    const result = await window.api.positions.update(id, data)
    await get().fetchAll()
    return result
  },

  remove: async (id) => {
    const result = await window.api.positions.delete(id)
    await get().fetchAll()
    return result
  },

  updateStatus: async (id, status) => {
    const result = await window.api.positions.updateStatus(id, status)
    await get().fetchAll()
    return result
  },

  fetchEvents: async (positionId) => {
    const events = await window.api.events.getByPositionId(positionId)
    set({ events })
  },

  addEvent: async (data) => {
    const id = await window.api.events.create(data)
    await get().fetchEvents(data.position_id)
    return id
  }
}))
