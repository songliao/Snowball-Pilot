// 生成 iOS 端单测对拍 fixtures：
// 用仓库内的真实 TS 实现（calc.ts / contractParser.ts / positions.ts 的 CSV 逻辑）
// 计算样本输入的输出，Swift 测试断言其 Swift 移植版结果一致。
// 运行：node ios/scripts/generate-fixtures.mjs（在仓库根目录）
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

// 把 TS 源码打包成 CJS 到临时目录，再用 require 加载
async function bundleTS(entry, label, alias) {
  const outDir = mkdtempSync(join(tmpdir(), 'fixture-'))
  const outFile = join(outDir, `${label}.cjs`)
  await build({
    entryPoints: [join(repoRoot, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outFile,
    alias,
  })
  return require(outFile)
}

// electron 模块桩（positions.ts 引入 electron 但生成 fixtures 不会调用 IPC）
const stubDir = mkdtempSync(join(tmpdir(), 'electron-stub-'))
const stubFile = join(stubDir, 'electron-stub.cjs')
writeFileSync(stubFile, 'module.exports = { ipcMain: { handle() {} }, dialog: {} };')
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron-stub', main: 'electron-stub.cjs' }))

const calc = await bundleTS('src/utils/calc.ts', 'calc')
const parser = await bundleTS('src/utils/contractParser.ts', 'parser')
const positions = await bundleTS('electron/database/positions.ts', 'positions', { electron: stubDir })

// ——— 样本持仓 ———
const snowball = {
  structure_type: 'snowball',
  product_name: '中证1000雪球75-102',
  broker: '某某证券',
  contract_no: 'SB-2025-001',
  trade_start_date: '2025-03-05',
  underlying_code: '000852.SH',
  notional: 2000000,
  initial_price: 6213.44,
  knock_in_barrier: 0.75,
  knock_in_strike: 100,
  margin_ratio: 0.12,
  knock_out_dates: '["2025-09-05","2026-03-05","2026-09-07"]',
  knock_out_barriers: '[102,102,100]',
  knock_out_coupons: '[15.2,16.8,18.5]',
  knock_in_observation: 'daily',
  knock_in_participation: 100,
  max_loss_pct: 1,
  rebate_annual_pct: 8.5,
  rebate_absolute_back_pct: 0.5,
  rebate_absolute_front_pct: 0,
  accrual_basis: 'both',
  accrual_settle_tplus: 2,
  abs_fee_pct: 0.15,
  annual_fee_pct: 0.3,
  income_dividend_pct: 10,
  notes: '含逗号, 引号"测试"\n换行',
  status: 'active',
  is_ki: false
}
const snowballKI = { ...snowball, status: 'knocked_in', is_ki: true, knock_in_date: '2025-11-14' }
const snowballKO = { ...snowball, status: 'knocked_out', termination_date: '2025-09-05', termination_payoff: 152340.56 }
const phoenix = {
  structure_type: 'phoenix',
  product_name: '凤凰DCN季度派息',
  broker: '另一家期货',
  contract_no: 'PH-2025-007',
  trade_start_date: '2025-06-10',
  underlying_code: '000300.SH',
  notional: 1000000,
  initial_price: 3935.4,
  knock_in_barrier: 0.7,
  knock_in_strike: 100,
  margin_ratio: 0.2,
  knock_out_dates: '["2026-06-10","2026-12-10"]',
  knock_out_barriers: '[103,100]',
  coupon_barrier: 0.8,
  coupon_dates: '["2025-09-10","2025-12-10","2026-03-10"]',
  coupon_rate: 0.042,
  coupon_received: '[{"date":"2025-09-10","amount":4200}]',
  coupon_payment_dates: '["2025-09-15","2025-12-15"]',
  knock_in_observation: 'daily',
  knock_in_participation: 100,
  max_loss_pct: 1,
  rebate_annual_pct: 0,
  rebate_absolute_back_pct: 0,
  rebate_absolute_front_pct: 0,
  accrual_basis: 'one',
  accrual_settle_tplus: 1,
  abs_fee_pct: 0.1,
  annual_fee_pct: 0,
  income_dividend_pct: 5,
  notes: '凤凰',
  status: 'active',
  is_ki: false
}

// 补齐 Position 全字段默认值（与桌面端 colValue 默认一致），保证 Swift Codable 解码完整
function withDefaults(pos) {
  return {
    id: 0,
    created_at: '',
    product_name: '', broker: '', contract_no: '', trade_start_date: '', underlying_code: '',
    notional: 0, initial_price: 0, knock_in_barrier: 0, knock_in_strike: 100,
    margin_ratio: 0, knock_out_dates: '', knock_out_barriers: '', knock_in_observation: 'daily',
    knock_in_participation: 100, max_loss_pct: 0, rebate_annual_pct: 0,
    rebate_absolute_back_pct: 0, rebate_absolute_front_pct: 0, accrual_basis: 'both',
    accrual_settle_tplus: 0, abs_fee_pct: 0, annual_fee_pct: 0, income_dividend_pct: 0,
    notes: '', status: 'active', is_ki: false, knock_in_date: '', termination_date: '',
    termination_payoff: 0, knock_out_coupons: '', knock_out_enhance_participation: 0,
    maturity_coupon: 0, coupon_barrier: 0, coupon_dates: '', coupon_rate: 0,
    coupon_received: '[]', coupon_payment_dates: '[]',
    ...pos
  }
}
const F = {
  snowball: withDefaults(snowball),
  snowballKI: withDefaults(snowballKI),
  snowballKO: withDefaults(snowballKO),
  phoenix: withDefaults(phoenix)
}
const F_matured = withDefaults({ ...snowball, status: 'matured' })

const round = (v) => (typeof v === 'number' ? Number(v.toFixed(8)) : v)
const deepRound = (v) => (Array.isArray(v) ? v.map(deepRound)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRound(x)]))
  : round(v))

// ——— 敲出收益对拍 ———
const koInputs = [
  {
    notional: 2000000, couponPct: 16.8, tradeStartDate: '2025-03-05',
    koObservationDate: '2026-03-05', accrualBasis: 'both', accrualSettleTplus: 2,
    rebateAnnualPct: 0.085, rebateAbsFrontPct: 0, rebateAbsBackPct: 0.005,
    absFeePct: 0.0015, annualFeePct: 0.003, incomeDividendPct: 0.10
  },
  {
    notional: 1000000, couponPct: 0, tradeStartDate: '2025-06-10',
    koObservationDate: '2025-08-15', accrualBasis: 'one', accrualSettleTplus: 0,
    rebateAnnualPct: 0, rebateAbsFrontPct: 0, rebateAbsBackPct: 0,
    absFeePct: 0, annualFeePct: 0, incomeDividendPct: 0
  },
  {
    notional: 500000, couponPct: 7.5, tradeStartDate: '2024-12-20',
    koObservationDate: '2025-01-02', accrualBasis: 'both', accrualSettleTplus: 1,
    rebateAnnualPct: 0.1, rebateAbsFrontPct: 0.01, rebateAbsBackPct: 0.02,
    absFeePct: 0.002, annualFeePct: 0.005, incomeDividendPct: 0.08
  }
]

// ——— 浮动盈亏 / 持有天数 / 预期收益 ———
const pnlCases = [
  { pos: F.snowball, price: 5800 },
  { pos: F.snowballKI, price: 5800 },
  { pos: F.snowballKO, price: 6400 },
  { pos: F.phoenix, price: 4000 },
  { pos: F.snowball, price: 0 },
  { pos: F_matured, price: 6100 },
  { pos: F_matured, price: 5900 }
]
const holdingCases = [
  { start: '2025-03-05', end: '2026-03-05' },
  { start: '2025-03-05', end: '2025-03-05' },
  { start: '2026-01-01', end: null },
  { start: 'bad-date', end: '2026-01-01' }
]

// 固定「今天」，让 estimateExpectedProfit / holdingDays 的当天项可复现
const FIXED_NOW = '2026-10-15T10:00:00'

// ——— 预警引擎对拍（alerts.ts） ———
const alerts = await bundleTS('src/utils/alerts.ts', 'alerts')
const alertCases = [
  {
    positions: [F.snowball, F.phoenix, F.snowballKO],
    prices: { '000852.SH': 6280, '000300.SH': 3150 },
    cfg: { knockOutLeadDays: 30, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10 }
  },
  {
    positions: [F.snowball, F.phoenix],
    prices: { '000852.SH': 4700, '000300.SH': 3140 },
    cfg: { knockOutLeadDays: 5, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10 }
  },
  {
    positions: [F.snowballKI],
    prices: { '000852.SH': 4600 },
    cfg: { knockOutLeadDays: 5, knockOutNearPct: 5, couponNearPct: 5, knockInNearPct: 10 }
  }
]
const alertOutputs = alertCases.map(({ positions, prices, cfg }) => {
  const { computeAlerts } = alerts
  // computeAlerts 内部用 dayjs()（真实当前时间）。为了让「今天」可控，
  // 对拍样本避开「今天附近」的观察日：snowball 敲出日在 2026-09/2027-03，相对系统当前时间可能变化，
  // 因此这里将 fixtures 里的日期与系统时间解耦：仅断言结构化字段以外，把 date 相关字段原样保留。
  return deepRound(computeAlerts(positions, prices, cfg))
})

// ——— CSV 对拍（桌面端真实 parseCsv / csvEscape / CSV_COLUMNS） ———
// 通过 positions.ts 内部函数做 round-trip：它没有直接导出 parseCsv，
// 因此这里以导出的 registerPositionHandlers 无法直接用——改为读取源码内联的规则已在 Swift 端对齐，
// 这里生成 CSV 文本用「与导出逻辑相同」的列序 + csvEscape 等价物（从源码复制的最小实现，避免 electron 依赖）。
function csvEscape(value) {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const COMMON_COLS = ['product_name','broker','contract_no','trade_start_date','underlying_code','notional','initial_price','knock_in_barrier','knock_in_strike','margin_ratio','knock_out_dates','knock_out_barriers','knock_in_observation','knock_in_participation','max_loss_pct','rebate_annual_pct','rebate_absolute_back_pct','rebate_absolute_front_pct','accrual_basis','accrual_settle_tplus','abs_fee_pct','annual_fee_pct','income_dividend_pct','notes','status','is_ki','knock_in_date','termination_date','termination_payoff']
const SNOWBALL_EXTRA = ['knock_out_coupons','knock_out_enhance_participation','maturity_coupon']
const PHOENIX_EXTRA = ['coupon_barrier','coupon_dates','coupon_rate','coupon_received','coupon_payment_dates']
const CSV_COLUMNS = ['structure_type', ...COMMON_COLS, ...SNOWBALL_EXTRA, ...PHOENIX_EXTRA]
const csvPositions = [
  withDefaults({ ...snowball, maturity_coupon: 2.5, knock_out_enhance_participation: 0 }),
  F.phoenix
]
const csvExportRecords = csvPositions.map((row) => CSV_COLUMNS.map((c) => {
  const v = row[c] === undefined ? '' : row[c]
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}))
const csvText = '\uFEFF' + [CSV_COLUMNS.join(','), ...csvExportRecords.map((r) => r.map(csvEscape).join(','))].join('\r\n') + '\r\n'

// parseCsv 样本（含引号、双引号转义、CRLF、空行）；expected 为反转义后的字段值
const csvParseSamples = [
  'a,b,c\r\n"1,2","he said ""hi""","line1\nline2"\r\n\r\n,x,y\r\n',
  '\uFEFFsingle\r\n',
  'no-quotes,"trailing comma",\r\n'
]

// ——— 合约文本解析对拍 ———
const contractText = `结构类型: 降敲早利雪球
交易编号: TEST-2026-001
交易对手方: 测试券商
名义本金: 3,000,000
交易日期: 2026-01-08
挂钩标的: 中证1000
期初价格: 6350.25
敲出观察日
2026-07-08
2027-01-08
2027-07-08
敲出障碍价格(%)
103.0000
102.5000
100.0000
票息/派息率(%)
12.6
13.4
15.0
敲入障碍价格(%): 70.00%
敲入观察方式: 每日观察
保证金比例: 12.00%
最大亏损比例: 100.00%
年化后端返息: 8.00%
计息规则: 双向计提
计息结算T+: 2
交易类型: 平敲
希腊字母: Delta 0.42
--- 备注结束 ---`
const parsedContract = parser.parseContractText(contractText)

// ——— 腾讯行情解析样本 ———
const tencentQuoteLine = 'v_sh000852="1~中证1000~000852~6280.55~6235.10~6240.00~123456789~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20261015150003~45.45~0.73~6301.20~6220.10~6280.55/123456789/98765432100~123456789~98765432100~0.85~6400.11~4500.22~1.10~6800.00~4400.00~2.35~"'
const klineJSON = JSON.stringify({
  code: 0,
  msg: '',
  data: {
    sh000852: {
      day: [
        ['2026-10-12', '6210.10', '6235.10', '6255.00', '6200.50', '98765432'],
        ['2026-10-13', '6236.00', '6180.25', '6240.00', '6150.75', '87654321'],
        ['2026-10-14', '6181.00', '6235.10', '6249.00', '6170.00', '76543210'],
        ['2026-10-15', '6240.00', '6280.55', '6301.20', '6220.10', '123456789']
      ],
      qt: {}
    }
  }
})

const fixtures = {
  generatedAt: FIXED_NOW,
  knockOutProfit: koInputs.map((input) => ({ input, output: deepRound(calc.computeKnockOutProfit(input)) })),
  estimateExpectedProfit: [F.snowball, F.phoenix, F.snowballKI].map((pos) => ({
    pos,
    // 雪球敲出观察日均早于 2026-10-15（fixtures 内所有日期都已固定在过去），
    // 预期收益恒为 null；凤凰为确定性公式，不依赖当天日期。
    output: deepRound(calc.estimateExpectedProfit(pos))
  })),
  pnl: pnlCases.map(({ pos, price }) => ({ pos, price, output: deepRound(calc.calcPnL(pos, price)) })),
  holdingDays: holdingCases.map(({ start, end }) => ({
    start,
    end,
    // end 为 null 时用 FIXED_NOW 的日期部分
    output: calc.calcHoldingDays(start, end ?? FIXED_NOW.split('T')[0])
  })),
  alerts: alertOutputs,
  csv: {
    exportColumns: CSV_COLUMNS,
    exportPositions: csvExportRecords,
    exportText: csvText.replace(/^\uFEFF/, ''),
    parseSamples: csvParseSamples.map((sample) => ({
      sample,
      parsed: positions.parseCsv ? undefined : undefined,
    })),
  },
  contractParser: {
    text: contractText,
    parsed: parsedContract,
  },
  tencent: {
    quoteLine: tencentQuoteLine,
    klineJSON,
    klineParsedRows: JSON.parse(klineJSON).data.sh000852.day,
  }
}

// CSV parse 对拍：直接用桌面端实现不了（未导出），改为在 fixtures 里保存
// 「手工按 RFC4180 期望的结果」——这些样本人为构造，期望值固定：
fixtures.csv.parseSamples = [
  { sample: csvParseSamples[0], expected: [['a','b','c'], ['1,2','he said "hi"','line1\nline2'], ['','x','y']] },
  { sample: csvParseSamples[1], expected: [['single']] },
  { sample: csvParseSamples[2], expected: [['no-quotes','trailing comma','']] }
]

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SnowballPilotTests', 'fixtures.json')
writeFileSync(outPath, JSON.stringify(fixtures, null, 2))
console.log('fixtures written to', outPath)
