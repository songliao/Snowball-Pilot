import { create } from 'zustand'
import dayjs, { type Dayjs } from 'dayjs'

// 事件日历的视图状态（当前月份 / 选中日期）。
// 放在 store 中而非组件本地 useState，是因为从日历跳转持仓详情会卸载组件、
// 返回时本地状态会丢失；提至 store 可在路由切换间保留用户的浏览位置。
interface CalendarState {
  curMonth: string // YYYY-MM-DD
  selectedDate: string | null // YYYY-MM-DD
  setCurMonth: (m: Dayjs) => void
  setSelectedDate: (d: Dayjs | null) => void
}

export const useCalendarStore = create<CalendarState>((set) => ({
  curMonth: dayjs().format('YYYY-MM-DD'),
  selectedDate: null,
  setCurMonth: (m) => set({ curMonth: m.format('YYYY-MM-DD') }),
  setSelectedDate: (d) => set({ selectedDate: d ? d.format('YYYY-MM-DD') : null })
}))
