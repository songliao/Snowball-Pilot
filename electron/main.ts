import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase } from './database'
import { registerPositionHandlers } from './database/positions'
import { registerPriceHandlers } from './database/prices'
import { registerEventHandlers } from './database/events'
import { fetchMarketPrice, fetchIndexQuote } from './services/market-data'
import { saveDailyClose, backfillHistory, getIndexHistory } from './services/index-history'
import { checkAndNotify } from './services/notification'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: '雪球持仓管理',
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // 初始化数据库（异步）
  await initDatabase()

  // 注册 IPC handlers
  registerPositionHandlers()
  registerPriceHandlers()
  registerEventHandlers()

  // 行情拉取
  ipcMain.handle('market:fetch-price', async (_event, code: string) => {
    return await fetchMarketPrice(code)
  })

  // 指数完整行情
  ipcMain.handle('market:fetch-index-quote', async (_event, code: string) => {
    return await fetchIndexQuote(code)
  })

  // 通知检查
  ipcMain.handle('notification:check', async () => {
    return await checkAndNotify(mainWindow)
  })

  // 指数历史数据
  ipcMain.handle('index-history:backfill', async (_event, days?: number) => {
    return await backfillHistory(days || 365)
  })

  ipcMain.handle('index-history:get', (_event, code: string, limit?: number) => {
    return getIndexHistory(code, limit)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 定时检查提醒（每5分钟）
  setInterval(() => {
    checkAndNotify(mainWindow)
  }, 5 * 60 * 1000)

  // 每日收盘后自动保存指数收盘价（15:05 检查）
  const scheduleDailySave = () => {
    const now = new Date()
    const target = new Date()
    target.setHours(15, 5, 0, 0)
    let delay = target.getTime() - now.getTime()
    if (delay <= 0) delay += 24 * 60 * 60 * 1000 // 已过则明天

    setTimeout(() => {
      saveDailyClose()
      // 之后每24小时执行一次
      setInterval(saveDailyClose, 24 * 60 * 60 * 1000)
    }, delay)
  }
  scheduleDailySave()

  // 启动时自动补足历史数据（仅首次或数据缺失时）
  backfillHistory(365).catch((e) => console.error('Backfill failed:', e))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
