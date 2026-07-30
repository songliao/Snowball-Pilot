/**
 * 行情数据拉取服务
 * 数据源：腾讯财经免费接口（无需 key、国内访问稳定、限流宽松）
 * 历史 K 线：web.ifzq.gtimg.cn
 * 实时行情：qt.gtimg.cn
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

// 标的代码映射（常用指数）—— 仅作兼容保留，腾讯接口直接由代码推导 symbol
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
 * 将标的代码（如 000852.SH）转换为东方财富 secid（如 1.000852）
 * 无法识别时返回 null。保留以兼容可能的调用方。
 */
export function toSecid(code: string): string | null {
  // 防御：先把全角字符转半角、去除空白，避免从界面/外部传入的全角代码（如 000852．ＳＨ）导致 secid 错误
  const c = (code || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, '')
    .trim()
  if (INDEX_CODE_MAP[c]) return INDEX_CODE_MAP[c]
  const parts = c.split('.')
  if (parts.length === 2) {
    const [numCode, market] = parts
    const prefix = market === 'SH' ? '1' : '0'
    return `${prefix}.${numCode}`
  }
  return null
}

/**
 * 将标的代码（如 000852.SH）转换为腾讯财经 symbol（如 sh000852）。
 * 腾讯接口使用「市场前缀(小写) + 代码」格式，与东方财富的 secid 不同。
 */
export function toTencentSymbol(code: string): string | null {
  const c = (code || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, '')
    .trim()
  const parts = c.split('.')
  if (parts.length === 2) {
    const [numCode, market] = parts
    const prefix = market === 'SH' ? 'sh' : 'sz'
    return `${prefix}${numCode}`
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 腾讯实时接口返回 GBK 编码：价格为 ASCII 安全，但中文名为 GBK。
// 用 gbk 解码可保留名称；环境不支持时回退 utf-8（名称会乱码但价格正常）。
function decodeTencentText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('gbk').decode(new Uint8Array(buf))
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(buf))
  }
}

// 腾讯实时时间字段格式：YYYYMMDDHHMMSS
function formatTencentTime(raw: string): string {
  if (raw && raw.length >= 14) {
    return `${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`
  }
  return raw || ''
}

/**
 * 从腾讯财经实时接口获取价格与名称
 * 返回：v_sh000852="1~名称~代码~当前价~昨收~今开~成交量~..."
 */
export async function fetchMarketPrice(code: string): Promise<MarketPriceResult | null> {
  try {
    const symbol = toTencentSymbol(code)
    if (!symbol) return null

    const url = `https://qt.gtimg.cn/q=${symbol}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' }
    })
    if (!response.ok) return null

    const text = decodeTencentText(await response.arrayBuffer())
    const start = text.indexOf('"')
    const end = text.lastIndexOf('"')
    const content = start >= 0 && end > start ? text.slice(start + 1, end) : ''
    if (!content) return null
    const f = content.split('~')
    const price = parseFloat(f[3])
    if (!isFinite(price)) return null
    return { price, name: f[1] || code }
  } catch (error) {
    console.error('Failed to fetch market price:', error)
    return null
  }
}

/**
 * 获取指数完整实时行情（腾讯财经）
 */
export async function fetchIndexQuote(code: string): Promise<IndexQuote | null> {
  try {
    const symbol = toTencentSymbol(code)
    if (!symbol) return null

    const url = `https://qt.gtimg.cn/q=${symbol}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' }
    })
    if (!response.ok) return null

    const text = decodeTencentText(await response.arrayBuffer())
    const start = text.indexOf('"')
    const end = text.lastIndexOf('"')
    const content = start >= 0 && end > start ? text.slice(start + 1, end) : ''
    if (!content) return null
    const f = content.split('~')
    const price = parseFloat(f[3])
    if (!isFinite(price)) return null

    // f[35] 形如「当前价/成交量(手)/成交额(元)」，取成交额
    const extra = (f[35] || '').split('/')
    return {
      code,
      name: f[1] || code,
      price,
      change: parseFloat(f[31]) || 0,
      changePct: parseFloat(f[32]) || 0,
      open: parseFloat(f[5]) || 0,
      high: parseFloat(f[33]) || 0,
      low: parseFloat(f[34]) || 0,
      prevClose: parseFloat(f[4]) || 0,
      volume: parseFloat(f[6]) || 0,
      amount: parseFloat(extra[2]) || 0,
      updateTime: formatTencentTime(f[30])
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

export interface KLinePoint {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * 从腾讯财经 K 线接口拉取历史 OHLC 数据（开高低收），用于绘制蜡烛图。
 * 腾讯返回每根 K 线为 [日期, 开盘, 收盘, 最高, 最低, 成交量]。
 * 轻量重试：腾讯免费接口偶发抖动时重试一次，避免新增标的误报「未获取到行情」。
 */
export async function fetchKline(code: string, days = 365): Promise<KLinePoint[]> {
  const symbol = toTencentSymbol(code)
  if (!symbol) return []
  // 注意：fqkline 接口必须带 qfq（前复权）后缀，否则只返回 version、不含 day 数据
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${days},qfq`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' }
      })
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await sleep(500)
          continue
        }
        return []
      }
      const json = await response.json()
      const node = json?.data?.[symbol]
      const rows: any[] = node?.day || node?.qfqday || []
      if (!rows.length) return []
      return rows
        .map((arr: any[]) => ({
          date: String(arr[0]),
          open: parseFloat(arr[1]),
          high: parseFloat(arr[3]),
          low: parseFloat(arr[4]),
          close: parseFloat(arr[2]),
          volume: parseFloat(arr[5]) || 0
        }))
        .filter((k) => k.close > 0)
    } catch (error) {
      console.error('Failed to fetch kline:', error)
      if (attempt === 0) await sleep(500)
    }
  }
  return []
}
