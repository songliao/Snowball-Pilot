/**
 * 应用自动更新（electron-updater）
 *
 * 设计要点：
 * 1. 仅打包后的应用参与更新；dev 环境下所有入口直接返回 disabled，避免污染开发流程。
 * 2. 更新通道由环境变量决定（见 config.ts）：generic 走自有静态服务器，github 走 Releases。
 * 3. autoDownload 开启：检测到新版本后后台静默下载，下载完成再提示「重启并安装」，
 *    接近热更新体验；安装时机完全由用户决定，不会突然重启。
 * 4. 启动后延迟 8s 静默检查一次（避开启动高峰），之后每 4 小时轮询一次，
 *    保证长时间不关闭的应用也能收到后续发布的新版本。
 */

import { app, ipcMain, BrowserWindow, nativeImage, Notification } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import {
  UPDATER_PROVIDER,
  UPDATER_BASE_URL,
  UPDATER_GITHUB_OWNER,
  UPDATER_GITHUB_REPO,
  UPDATER_GITHUB_TOKEN
} from '../config'
import type { UpdaterEvent } from './updater-types'

let mainWindowRef: BrowserWindow | null = null
let cancelToken: CancellationToken | null = null
let updateReady = false
let availableInfo: UpdateInfo | null = null

function emit(event: UpdaterEvent): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:event', event)
  }
}

/** 配置更新源；返回 false 表示未启用更新 */
function configureFeed(): boolean {
  autoUpdater.logger = null
  // 后台静默下载，下载完成后由界面提示用户重启安装
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.disableDifferentialDownload = false

  if (UPDATER_PROVIDER === 'github') {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATER_GITHUB_OWNER,
      repo: UPDATER_GITHUB_REPO,
      private: Boolean(UPDATER_GITHUB_TOKEN),
      token: UPDATER_GITHUB_TOKEN || undefined
    })
  } else {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATER_BASE_URL })
  }
  return true
}

function notifyReleaseNotes(info: UpdateInfo): void {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((n) => n.note).join('\n')
    : typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : ''

  const notification = new Notification({
    title: `Snowball Pilot ${info.version} 已就绪`,
    body: notes ? notes.slice(0, 200) : '重启应用即可完成升级',
    icon: nativeImage.createEmpty()
  })
  notification.show()
}

/**
 * 注册更新相关的 IPC 与主进程事件转发。
 * 开发模式下不注册任何处理函数（渲染层会因 disabled 分支自行降级）。
 */
export function registerUpdateHandlers(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow

  // 开发模式：仍需注册同名 handler，否则渲染层调用会因「无 handler」直接抛错，
  // 这里统一返回 disabled，让 UI 自行隐藏更新入口。
  if (!app.isPackaged) {
    console.log('[updater] 开发模式，自动更新未启用')
    ipcMain.handle('updater:check', () => ({ ok: false, reason: 'dev-mode' }))
    ipcMain.handle('updater:download', () => ({ ok: false, reason: 'dev-mode' }))
    ipcMain.handle('updater:cancel', () => false)
    ipcMain.handle('updater:install', () => false)
    return
  }

  configureFeed()

  autoUpdater.on('error', (err: Error) => {
    // 常见情况：服务器 404 latest.yml、release 尚未上传、网络不可用
    emit({ type: 'error', message: err?.message || '未知错误' })
  })

  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    availableInfo = info
    emit({
      type: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    })
  })

  autoUpdater.on('update-not-available', () => {
    emit({ type: 'not-available', version: app.getVersion() })
  })

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    emit({
      type: 'progress',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateReady = true
    emit({ type: 'downloaded', version: info.version })
    notifyReleaseNotes(info)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) return { ok: false, reason: 'no-result' }
      return {
        ok: true,
        updateAvailable: Boolean(result.updateInfo && result.updateInfo.version !== app.getVersion()),
        version: result.updateInfo?.version ?? app.getVersion()
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'error', message })
      return { ok: false, reason: message }
    }
  })

  ipcMain.handle('updater:download', async () => {
    if (updateReady) return { ok: true, alreadyReady: true }
    try {
      cancelToken = new CancellationToken()
      await autoUpdater.downloadUpdate(cancelToken)
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      emit({ type: 'error', message })
      return { ok: false, reason: message }
    }
  })

  ipcMain.handle('updater:cancel', () => {
    cancelToken?.cancel()
    cancelToken = null
    return true
  })

  ipcMain.handle('updater:install', () => {
    if (!updateReady) return false
    // isSilent=false / isForceRunAfter=true：安装后立即拉起新版应用
    autoUpdater.quitAndInstall(false, true)
    return true
  })

  // 启动 8s 后静默检查一次；命中新版本会后台下载，完成后界面提示重启安装
  const silentCheck = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }
  setTimeout(silentCheck, 8000)
  // 之后每 4 小时轮询一次，长时间挂着的应用也能收到新的发布
  setInterval(silentCheck, 4 * 60 * 60 * 1000)
}
