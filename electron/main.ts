import { app, BrowserWindow, ipcMain, shell, net, Menu, nativeTheme, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { API_BASE_URL } from './config'
import { initDatabase, openUserDatabase, closeDatabase, getCurrentUser, flushSave } from './database'
import { registerPositionHandlers } from './database/positions'
import { registerPriceHandlers } from './database/prices'
import { registerEventHandlers } from './database/events'
import { fetchMarketPrice, fetchIndexQuote, fetchKline } from './services/market-data'
import { saveDailyClose, backfillHistory, backfillSingleCode, ensureHistoryBackfilled, getIndexHistory, refreshToToday } from './services/index-history'
import { checkAndNotify } from './services/notification'

let mainWindow: BrowserWindow | null = null

// 构建应用菜单：自定义「关于」弹窗以展示应用自有 logo（避免 macOS 原生关于面板回退到 Electron 默认图标）
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'

  // 仅 macOS 保留应用菜单（应用名 + 关于）。Windows/Linux 不设置自定义菜单，
  // 避免显示「编辑 / 视图 / 窗口」等默认菜单项；关于入口改由侧边栏「设置」提供。
  if (!isMac) {
    Menu.setApplicationMenu(null as unknown as Electron.Menu)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        {
          label: '关于 Snowball Pilot',
          click: () => showAboutWindow()
        },
        { type: 'separator' },
        { role: 'services' as const },
        { type: 'separator' },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' },
        { role: 'quit' as const }
      ]
    },
    {
      // 标准编辑菜单：用 role 注册 ⌘Z/⌘⇧Z/⌘X/⌘C/⌘V/⌘A，
      // 使这些快捷键正确路由到 webview 中聚焦的输入框（macOS 必须依赖它）。
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 自定义「关于」窗口：logo 居中显示在文字上方，解决原生弹窗图标偏左不居中的问题
function showAboutWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')

  let logoDataUri = ''
  try {
    const b64 = readFileSync(iconPath).toString('base64')
    logoDataUri = `data:image/png;base64,${b64}`
  } catch {
    logoDataUri = ''
  }

  // 英文花体文案：用图片保证各平台显示一致（系统字体差异会导致花体失效）
  const aboutEnPath = app.isPackaged
    ? join(process.resourcesPath, 'about', 'about-en-light.png')
    : join(__dirname, '../../resources/about/about-en-light.png')
  const aboutEnDarkPath = app.isPackaged
    ? join(process.resourcesPath, 'about', 'about-en-dark.png')
    : join(__dirname, '../../resources/about/about-en-dark.png')

  const toDataUri = (p: string): string => {
    try {
      return `data:image/png;base64,${readFileSync(p).toString('base64')}`
    } catch {
      return ''
    }
  }
  const aboutEnLightUri = toDataUri(aboutEnPath)
  const aboutEnDarkUri = toDataUri(aboutEnDarkPath)

  // 读取主窗口实际生效的主题（data-theme），与 App 显示保持一致；不可用时回退到系统暗黑判断
  const resolveDark = (): Promise<boolean> => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.webContents
        .executeJavaScript(`document.documentElement.getAttribute('data-theme')`)
        .then((attr: unknown) => {
          if (attr === 'dark') return true
          if (attr === 'light') return false
          return nativeTheme.shouldUseDarkColors
        })
        .catch(() => nativeTheme.shouldUseDarkColors)
    }
    return Promise.resolve(nativeTheme.shouldUseDarkColors)
  }

  resolveDark().then((dark) => {
    const bg = dark ? '#09090b' : '#f5f5f4'
    const fg = dark ? 'rgba(244,244,245,0.88)' : '#1e1e22'
    // 英文花体文案图片：深底用浅色墨，浅底用深色墨
    const enUri = dark ? aboutEnDarkUri : aboutEnLightUri

    const aboutWin = new BrowserWindow({
      width: 320,
      height: 250,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      center: true,
      frame: false,
      // 禁用全屏能力：父窗口（主窗口）处于原生全屏时，子窗口会被系统带入同一
      // 全屏 Space 并被拉伸为全屏，设置 fullscreenable:false 可让其保持固定尺寸叠加显示
      fullscreenable: false,
      show: false,
      backgroundColor: bg,
      parent: mainWindow ?? undefined,
      // 不要 modal：modal 下 Windows 点击主窗口时关于窗口不会可靠失焦，导致 blur 关闭失效；
      // 改为普通置顶窗口，点击别处即可触发 blur 关闭
      modal: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: ${bg};
    color: ${fg};
  }
  img { width: 76px; height: 76px; border-radius: 16px; object-fit: contain; }
  h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
  .ver { font-size: 12px; opacity: 0.5; }
  .desc { font-size: 13px; line-height: 1.7; opacity: 0.7; max-width: 260px; }
  .desc-en { margin-top: 6px; height: 10px; }
  .desc-en img { width: auto; height: 100%; border-radius: 0; image-rendering: auto; }
</style>
</head>
<body>
  <img src="${logoDataUri}" alt="logo" />
  <h1>Snowball Pilot</h1>
  <div class="ver">版本 ${app.getVersion()}</div>
  <div class="desc">
    场外衍生品投资持仓管理工具
    <div class="desc-en"><img src="${enUri}" alt="For My Perpetual &amp; Resonant Love" /></div>
  </div>
</body>
</html>`

    aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    aboutWin.once('ready-to-show', () => {
      aboutWin.show()
      // 延迟绑定 blur，避免 show 过程中窗口自身先 focus 再被父窗口抢占焦点
      // 而误触发立即关闭
      setTimeout(() => {
        aboutWin.on('blur', closeAbout)
      }, 150)
    })

    let closed = false
    const closeAbout = () => {
      if (closed) return
      closed = true
      aboutWin.close()
    }

    // Esc 关闭
    aboutWin.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'Escape') closeAbout()
    })
  })
}

function createWindow(): void {
  // 开发模式下显式指定图标，避免 Windows/macOS 回退到 Electron 默认图标
  const appIcon = app.isPackaged
    ? undefined
    : join(__dirname, '../../resources/icon.png')

  // macOS 使用无边框 + 内嵌红绿灯；
  // Windows 使用隐藏标题栏 + 原生窗口控制按钮（支持 Win11 Snap Layouts）
  const isMac = process.platform === 'darwin'
  const useDark = nativeTheme.shouldUseDarkColors

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Snowball Pilot',
    icon: appIcon,
    frame: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows 使用原生标题栏覆盖层：只有系统原生最大化按钮才支持 Win11 贴靠布局（Snap Layouts）。
    // 此前「抽屉打开按钮区变灰」的根因是 Drawer 半透明遮罩压暗周边区域，已通过透明遮罩修复。
    titleBarOverlay: isMac ? undefined : {
      color: useDark ? '#09090b' : '#f5f5f4',
      symbolColor: useDark ? '#e4e4e7' : '#333333',
      height: 36
    },
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    backgroundColor: useDark ? '#09090b' : '#f5f5f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 窗口创建时即设置应用菜单（应用名菜单 + 标准「编辑」菜单，
  // 由 role 提供 ⌘Z/⌘X/⌘C/⌘V/⌘A 等编辑快捷键）。
  buildAppMenu()

  // 监听系统主题变化，自动同步窗口控制按钮颜色
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !isMac) {
      const dark = nativeTheme.shouldUseDarkColors
      try {
        mainWindow.setTitleBarOverlay({
          color: dark ? '#09090b' : '#f5f5f4',
          symbolColor: dark ? '#e4e4e7' : '#333333'
        })
      } catch { /* ignore */ }
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // ESC 退出全屏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
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
  // 设置 Dock 图标（打包后自动使用 .icns）
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  // 显式设置应用名，确保 macOS 菜单栏第一项显示「Snowball Pilot」而非默认的 Electron
  app.setName('Snowball Pilot')

  // 设置应用菜单（自定义「关于」弹窗使用应用自有 logo）
  buildAppMenu()

  // 初始化数据库（异步）
  await initDatabase()

  // 注册 IPC handlers
  registerPositionHandlers()
  registerPriceHandlers()
  registerEventHandlers()

  // ——— 安全存储：使用 OS 级加密保护凭据（macOS Keychain / Windows DPAPI）———
  // 加密后以 base64 文本存回 localStorage；解密仅在主进程完成，渲染进程永不见明文。
  const encAvail = safeStorage.isEncryptionAvailable()
  if (!encAvail) {
    console.warn('[secureStore] OS 级加密不可用，凭据将回退到明文存储。')
  }

  ipcMain.handle('secure-store:set', (_event, key: string, value: string) => {
    if (!encAvail) return false
    try {
      const encrypted = safeStorage.encryptString(value)
      return encrypted.toString('base64')
    } catch (e) {
      console.error('[secureStore] 加密失败：', e)
      return false
    }
  })

  ipcMain.handle('secure-store:get', (_event, key: string, encryptedB64: string) => {
    if (!encAvail) return null
    try {
      const buf = Buffer.from(encryptedB64, 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  })

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

  // 关于窗口（侧边栏「设置 → 关于」入口调用，跨平台统一）
  ipcMain.handle('app:about', async () => {
    showAboutWindow()
    return true
  })

  // 窗口控制操作（保留以兼容旧代码）
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })
  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false
  })

  // 更新标题栏覆盖层颜色（应用内主题切换时调用）
  ipcMain.handle('app:update-titlebar-overlay', (_event, color: string, symbolColor: string) => {
    if (mainWindow && !mainWindow.isDestroyed() && process.platform !== 'darwin') {
      try {
        mainWindow.setTitleBarOverlay({ color, symbolColor })
      } catch { /* ignore */ }
    }
    return true
  })

  // 指数历史数据
  ipcMain.handle('index-history:backfill', async (_event, days?: number, clean?: boolean) => {
    return await backfillHistory(days || 730, clean)
  })
  // 新增单个标的并补足历史
  ipcMain.handle('index-history:backfill-code', async (_event, code: string, days?: number) => {
    if (!code) return { code, saved: 0 }
    return await backfillSingleCode(code, days || 730)
  })
  // 刷新：补足各标的缺失的至今天的收盘数据
  ipcMain.handle('index-history:refresh', async () => {
    return await refreshToToday()
  })

  ipcMain.handle('index-history:get', (_event, code: string, limit?: number) => {
    return getIndexHistory(code, limit)
  })

  // 登录验证（主进程发起请求，绕过 CORS）
  ipcMain.handle('auth:login', async (_event, username: string, password: string) => {
    const result: { ok: boolean; status: number; data: any; error?: string } = await new Promise((resolve) => {
      const request = net.request({
        method: 'POST',
        url: `${API_BASE_URL}/api/v1/auth/login/`
      })
      request.setHeader('Content-Type', 'application/json')

      let body = ''
      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString() })
        response.on('end', () => {
          try {
            const data = JSON.parse(body)
            resolve({ ok: response.statusCode === 200, status: response.statusCode, data })
          } catch {
            resolve({ ok: false, status: response.statusCode, data: null })
          }
        })
      })
      request.on('error', (err) => {
        resolve({ ok: false, status: 0, data: null, error: err.message })
      })
      request.write(JSON.stringify({ username, password }))
      request.end()
    })

    // 登录成功后切换到该用户的独立数据库，并补足行情历史
    if (result.ok) {
      try {
        await openUserDatabase(username)
        ensureHistoryBackfilled().catch((e) => console.error('Backfill failed:', e))
      } catch (e) {
        console.error('打开用户数据库失败：', e)
        result.dbError = e instanceof Error ? e.message : String(e)
      }
    }
    return result
  })

  // 恢复会话：应用启动时若本地已保存登录态，前端据此打开对应账号的数据库
  ipcMain.handle('auth:resume', async (_event, username: string) => {
    try {
      await openUserDatabase(username)
      ensureHistoryBackfilled().catch((e) => console.error('Backfill failed:', e))
    } catch (e) {
      console.error('恢复用户数据库失败：', e)
      return false
    }
    return true
  })

  // 登出：关闭当前用户数据库（落盘），主进程回到「无用户」状态
  ipcMain.handle('auth:logout', async () => {
    closeDatabase()
    return true
  })

  // 服务健康检查
  ipcMain.handle('auth:ping', async () => {
    return new Promise((resolve) => {
      const request = net.request({
        method: 'GET',
        url: `${API_BASE_URL}/api/v1/auth/login/`
      })
      request.on('response', (response) => {
        response.on('data', () => {})
        response.on('end', () => resolve(true))
      })
      request.on('error', () => resolve(false))
      request.end()
    })
  })

  // K 线（蜡烛图）数据
  ipcMain.handle('market:fetch-kline', async (_event, code: string, days?: number) =>
    fetchKline(code, days || 365)
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 定时检查提醒（每5分钟）；仅在已登录用户时执行
  setInterval(() => {
    if (getCurrentUser()) checkAndNotify(mainWindow)
  }, 5 * 60 * 1000)

  // 每日收盘后自动保存指数收盘价（15:05 检查）；仅在已登录用户时执行
  const scheduleDailySave = () => {
    const now = new Date()
    const target = new Date()
    target.setHours(15, 5, 0, 0)
    let delay = target.getTime() - now.getTime()
    if (delay <= 0) delay += 24 * 60 * 60 * 1000 // 已过则明天

    setTimeout(() => {
      if (getCurrentUser()) saveDailyClose()
      // 之后每24小时执行一次
      setInterval(() => {
        if (getCurrentUser()) saveDailyClose()
      }, 24 * 60 * 60 * 1000)
    }, delay)
  }
  scheduleDailySave()

  // 历史数据补足改为「登录成功后」按需执行（见 auth:login / auth:resume 处理），
  // 启动阶段尚未确定用户，不在此处无条件触发，避免访问未打开的数据库。
})

// 退出前确保所有待处理的延迟写盘已落盘，避免数据丢失
app.on('before-quit', () => {
  flushSave()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
