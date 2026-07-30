import { contextBridge, ipcRenderer } from 'electron'
import type { KLinePoint } from './services/market-data'

export interface PositionData {
  id?: number
  structure_type?: string // 'snowball' 雪球 | 'phoenix' 凤凰
  // 通用簿记
  contract_no?: string // 合约编号
  // 起息日（雪球/凤凰共用）
  trade_start_date?: string
  // 敲出参数（序列以 JSON 字符串存储）
  knock_out_dates?: string // 敲出观察日（日期序列）
  knock_out_barriers?: string // 敲出障碍价格（百分比序列，原始百分比数值）
  knock_out_coupons?: string // 雪球：敲出票息（百分比序列）
  knock_out_enhance_participation?: number // 雪球：敲出增强参与率（百分比）
  maturity_coupon?: number // 雪球：到期票息（百分比）
  // 敲入参数
  knock_in_observation?: string // 敲入观察方式（daily 每日 / maturity 到期）
  knock_in_barrier?: number // 敲入障碍比例（百分比）
  knock_in_strike?: number // 敲入执行价比例（百分比）
  knock_in_participation?: number // 敲入参与率（百分比）
  // 保证金与最大亏损
  margin_ratio?: number // 保证金比例（百分比）
  max_loss_pct?: number // 最大亏损（百分比）
  // 雪球：终止条款
  termination_date?: string // 了结（终止）日期
  termination_payoff?: number // 了结收益（绝对金额）
  // 返息信息
  rebate_annual_pct?: number // 年化后端返息（百分比）
  rebate_absolute_back_pct?: number // 绝对后端返息（百分比）
  rebate_absolute_front_pct?: number // 绝对前端返息（百分比）
  // 计息规则
  accrual_basis?: string // 计息规则（both 双含 / one 单含）
  accrual_settle_tplus?: number // 计息结算T+（整数）
  // 费用
  abs_fee_pct?: number // 绝对费用（百分比）
  annual_fee_pct?: number // 年化费用（百分比）
  income_dividend_pct?: number // 收益分红（百分比）
  // 凤凰派息
  coupon_barrier?: number // 派息障碍比例（百分比）
  coupon_dates?: string // 派息观察日（日期序列）
  coupon_rate?: number // 派息率（百分比，按名义本金绝对百分比）
  coupon_received?: string // 已派息记录（JSON 数组）
  coupon_payment_dates?: string // 派息支付日（JSON 日期数组）
  // 通用
  product_name?: string
  broker?: string
  underlying?: string // 标的名称（兼容旧数据）
  underlying_code?: string
  notional?: number
  initial_price?: number
  status?: string
  is_ki?: boolean // 敲入状态（0=未敲入 1=已敲入）
  knock_in_date?: string // 敲入日期（标记敲入时记录，撤销时清空）
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface PriceData {
  id?: number
  underlying_code: string
  price: number
  date: string
  source: string
  open?: number | null
  high?: number | null
  low?: number | null
  volume?: number | null
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
  // 当前运行平台
  platform: process.platform as NodeJS.Platform,

  // 登录验证
  auth: {
    login: (username: string, password: string): Promise<{ ok: boolean; status: number; data: any; error?: string; dbError?: string }> =>
      ipcRenderer.invoke('auth:login', username, password),
    // 应用启动时恢复已保存会话对应的用户数据库
    resume: (username: string): Promise<boolean> => ipcRenderer.invoke('auth:resume', username),
    // 登出：通知主进程关闭当前用户数据库
    logout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout'),
    ping: (): Promise<boolean> => ipcRenderer.invoke('auth:ping')
  },

  // 持仓操作
  positions: {
    getAll: (): Promise<PositionData[]> => ipcRenderer.invoke('positions:get-all'),
    getById: (id: number, structureType?: string): Promise<PositionData | null> =>
      ipcRenderer.invoke('positions:get-by-id', id, structureType),
    create: (data: Omit<PositionData, 'id' | 'created_at' | 'updated_at'>): Promise<number> =>
      ipcRenderer.invoke('positions:create', data),
    update: (id: number, data: Partial<PositionData>): Promise<boolean> =>
      ipcRenderer.invoke('positions:update', id, data),
    delete: (id: number, structureType: string): Promise<boolean> =>
      ipcRenderer.invoke('positions:delete', id, structureType),
    updateStatus: (id: number, status: string, structureType: string, isKi?: boolean, knockInDate?: string, terminationDate?: string, payoff?: number): Promise<boolean> =>
      ipcRenderer.invoke('positions:update-status', id, status, structureType, isKi, knockInDate, terminationDate, payoff)
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
      ipcRenderer.invoke('prices:delete-by-code', code),
    getOhlc: (
      code: string
    ): Promise<
      {
        date: string
        open: number | null
        high: number | null
        low: number | null
        close: number
        volume: number | null
        ma5: number | null
        ma10: number | null
        ma20: number | null
      }[]
    > => ipcRenderer.invoke('prices:get-ohlc', code),
    getCodes: (): Promise<{
      code: string
      latestPrice: number
      date: string
      prevPrice: number | null
      priceWeekAgo: number | null
      priceMonthAgo: number | null
      priceYearAgo: number | null
    }[]> => ipcRenderer.invoke('prices:get-codes'),
    getWatchlist: (): Promise<string[]> => ipcRenderer.invoke('prices:get-watchlist'),
    setWatchlist: (codes: string[]): Promise<boolean> => ipcRenderer.invoke('prices:set-watchlist', codes)
  },

  // 事件操作
  events: {
    getByPositionId: (positionId: number, structureType?: string): Promise<EventData[]> =>
      ipcRenderer.invoke('events:get-by-position-id', positionId, structureType),
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
      ipcRenderer.invoke('market:fetch-index-quote', code),
    fetchKline: (code: string, days?: number): Promise<KLinePoint[]> =>
      ipcRenderer.invoke('market:fetch-kline', code, days)
  },

  // 通知
  notification: {
    check: (): Promise<string[]> => ipcRenderer.invoke('notification:check')
  },

  // 关于窗口 + 窗口控制
  app: {
    about: (): Promise<boolean> => ipcRenderer.invoke('app:about'),
    updateTitlebarOverlay: (color: string, symbolColor: string): Promise<boolean> =>
      ipcRenderer.invoke('app:update-titlebar-overlay', color, symbolColor)
  },

  // 窗口控制（Windows 自定义标题栏）
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized')
  },

  // 指数历史数据
  indexHistory: {
    backfill: (days?: number, clean?: boolean): Promise<{ code: string; saved: number }[]> =>
      ipcRenderer.invoke('index-history:backfill', days, clean),
    backfillCode: (code: string, days?: number): Promise<{ code: string; saved: number }> =>
      ipcRenderer.invoke('index-history:backfill-code', code, days),
    refresh: (): Promise<{ code: string; added: number }[]> =>
      ipcRenderer.invoke('index-history:refresh'),
    get: (code: string, limit?: number): Promise<{ id: number; underlying_code: string; price: number; date: string; source: string }[]> =>
      ipcRenderer.invoke('index-history:get', code, limit)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
