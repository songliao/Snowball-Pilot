/**
 * 行情数据拉取服务
 * 支持东方财富、新浪财经等免费 API
 */

interface MarketPriceResult {
  price: number
  name: string
}

export interface IndexQuote {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number       // 手
  amount: number       // 元
  updateTime: string
}

// 标的代码映射（常用指数）
const INDEX_CODE_MAP: Record<string, string> = {
  '000905.SH': '1.000905', // 中证500
  '000852.SH': '1.000852', // 中证1000
  '000300.SH': '1.000300', // 沪深300
  '000016.SH': '1.000016', // 上证50
  '399006.SZ': '0.399006', // 创业板指
  '399001.SZ': '0.399001', // 深证成指
  '000001.SH': '1.000001'  // 上证指数
}

/**
 * 从东方财富 API 获取实时行情
 */
export async function fetchMarketPrice(code: string): Promise<MarketPriceResult | null> {
  try {
    // 转换代码格式
    let secid = INDEX_CODE_MAP[code]
    if (!secid) {
      // 尝试自动转换: 000905.SH -> 1.000905, 399006.SZ -> 0.399006
      const parts = code.split('.')
      if (parts.length === 2) {
        const [numCode, market] = parts
        const prefix = market === 'SH' ? '1' : '0'
        secid = `${prefix}.${numCode}`
      } else {
        return null
      }
    }

    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f58,f170&ut=fa5fd1943c7b386f172d6893dbbd1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: 'https://quote.eastmoney.com/'
      }
    })

    if (!response.ok) return null

    const json = await response.json()
    if (json?.data?.f43) {
      // 东方财富返回的价格需要除以 100（指数和个股均为×100整数）
      const divisor = 100
      return {
        price: json.data.f43 / divisor,
        name: json.data.f58 || code
      }
    }

    return null
  } catch (error) {
    console.error('Failed to fetch market price:', error)
    return null
  }
}

/**
 * 获取指数完整实时行情
 */
export async function fetchIndexQuote(code: string): Promise<IndexQuote | null> {
  try {
    let secid = INDEX_CODE_MAP[code]
    if (!secid) {
      const parts = code.split('.')
      if (parts.length === 2) {
        const [numCode, market] = parts
        const prefix = market === 'SH' ? '1' : '0'
        secid = `${prefix}.${numCode}`
      } else {
        return null
      }
    }

    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170,f86&ut=fa5fd1943c7b386f172d6893dbbd1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: 'https://quote.eastmoney.com/'
      }
    })

    if (!response.ok) return null

    const json = await response.json()
    const d = json?.data
    if (!d || !d.f43) return null

    const divisor = 100 // 东方财富指数价格字段为×100整数
    return {
      code,
      name: d.f58 || code,
      price: d.f43 / divisor,
      change: (d.f169 || 0) / divisor,
      changePct: (d.f170 || 0) / 100,
      open: (d.f46 || 0) / divisor,
      high: (d.f44 || 0) / divisor,
      low: (d.f45 || 0) / divisor,
      prevClose: (d.f60 || 0) / divisor,
      volume: d.f47 || 0,
      amount: d.f48 || 0,
      updateTime: d.f86 ? new Date(d.f86 * 1000).toLocaleTimeString('zh-CN') : ''
    }
  } catch (error) {
    console.error('Failed to fetch index quote:', error)
    return null
  }
}

/**
 * 批量获取行情
 */
export async function fetchMultiplePrices(
  codes: string[]
): Promise<Record<string, MarketPriceResult>> {
  const results: Record<string, MarketPriceResult> = {}

  for (const code of codes) {
    const result = await fetchMarketPrice(code)
    if (result) {
      results[code] = result
    }
    // 避免请求过快
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  return results
}
