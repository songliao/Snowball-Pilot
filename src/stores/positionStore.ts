import { create } from 'zustand'
import type { PositionData, EventData } from '../utils/calc'

interface PositionState {
  positions: PositionData[]
  loading: boolean
  current: PositionData | null
  events: EventData[]

  fetchAll: () => Promise<void>
  fetchById: (id: number, structureType?: string) => Promise<void>
  create: (data: Omit<PositionData, 'id' | 'created_at' | 'updated_at'>) => Promise<number>
  update: (id: number, data: Partial<PositionData>) => Promise<boolean>
  remove: (id: number, structureType: string) => Promise<boolean>
  updateStatus: (id: number, status: string, structureType: string, isKi?: boolean, knockInDate?: string, terminationDate?: string, payoff?: number) => Promise<boolean>
  fetchEvents: (positionId: number, structureType?: string) => Promise<void>
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

  fetchById: async (id: number, structureType?: string) => {
    const current = await window.api.positions.getById(id, structureType)
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

  remove: async (id, structureType) => {
    const result = await window.api.positions.delete(id, structureType)
    await get().fetchAll()
    return result
  },

  updateStatus: async (id, status, structureType, isKi, knockInDate, terminationDate, payoff) => {
    const result = await window.api.positions.updateStatus(id, status, structureType, isKi, knockInDate, terminationDate, payoff)
    await get().fetchAll()
    return result
  },

  fetchEvents: async (positionId, structureType) => {
    const events = await window.api.events.getByPositionId(positionId, structureType)
    set({ events })
  },

  addEvent: async (data) => {
    const id = await window.api.events.create(data)
    await get().fetchEvents(data.position_id, data.structure_type)
    return id
  }
}))
