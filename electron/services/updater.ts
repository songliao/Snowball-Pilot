/**
 * 应用自动更新（electron-updater）
 *
 * 设计要点：
 * 1. 仅打包后的应用参与更新；dev 环境下所有入口直接返回 disabled，避免污染开发流程。
 * 2. 更新通道由环境变量决定（见 config.ts）：github 走 Releases API，generic 走静态服务器。
 * 3. autoDownload 开启：检测到新版本后后台静默下载，下载完成再提示「重启并安装」，
 *    接近热更新体验；安装时机完全由用户决定，不会突然重启。
 * 4. 启动后延迟 8s 静默检查一次（避开启动高峰），之后每 6 小时轮询一次，
 *    保证长时间不关闭的应用也能收到后续发布的新版本。
 * 5. 报错不直接透传：electron-updater 抛出的 HttpError 会带上完整响应体和 headers，
 *    界面展示前统一归一化成一句中文，原文只写进日志和「查看详情」。
 * 6. GitHub API（api.github.com）在国内常被拦截、且未认证时只有 60 次/小时配额，
 *    这类「通道不可用」的错误会自动降级到备用直链（不经过 API）。
 */

import { app, ipcMain, BrowserWindow, nativeImage, Notification } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'
import type { ProgressInfo, UpdateCheckResult, UpdateInfo } from 'electron-updater'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  UPDATER_PROVIDER,
  UPDATER_BASE_URL,
  UPDATER_FALLBACK_URL,
  UPDATER_GITHUB_OWNER,
  UPDATER_GITHUB_REPO,
  UPDATER_GITHUB_TOKEN
} from '../config'
import type { UpdaterEvent, UpdaterErrorCode } from './updater-types'

let mainWindowRef: BrowserWindow | null = null
let cancelToken: CancellationToken | null = null
let updateReady = false
let availableInfo: UpdateInfo | null = null
/** 本次会话是否已降级到备用通道（降级后不再反复尝试 API） */
let usingFallback = false

function emit(event: UpdaterEvent): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:event', event)
  }
}

/**
 * 更新日志写入 userData/updater.log。
 * 界面只显示归一化后的短文案，排查问题必须靠这份日志。
 */
function writeLog(line: string): void {
  try {
    const file = join(app.getPath('userData'), 'updater.log')
    if (existsSync(file) && statSync(file).size > 256 * 1024) writeFileSync(file, '')
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 写日志失败绝不能影响更新流程
  }
}

interface NormalizedError {
  message: string
  code: UpdaterErrorCode
  detail: string
}

/**
 * 把 electron-updater 的原始错误翻译成一句可直接展示的中文。
 * 原文（含响应体 / headers / 堆栈）放进 detail，只用于日志和「查看详情」。
 */
function normalizeError(e: unknown): NormalizedError {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const detailRaw = e instanceof Error ? e.stack || e.message : String(e)
  const detail = detailRaw.length > 1000 ? `${detailRaw.slice(0, 1000)}\n…（已截断）` : detailRaw
  const probe = message.toLowerCase()

  // 顺序有意义：403 是限流而不是「找不到」，校验失败优先于网络错误
  if (/sha512|checksum|digest|hash mismatch/.test(probe)) {
    return { message: '更新包校验失败，已终止安装', code: 'checksum', detail }
  }
  if (/403|rate limit|abuse detection|too many requests/.test(probe)) {
    return { message: '更新服务器拒绝请求（GitHub 访问限流），请稍后再试', code: 'rate-limit', detail }
  }
  if (/enetunreach|enotfound|eai_again|econnreset|econnrefused|etimedout|net::|socket hang up|getaddrinfo|network|timeout|ssl|certificate|unable to connect|premature close/.test(probe)) {
    return { message: '网络连接失败，请检查网络后重试', code: 'network', detail }
  }
  if (/404|not found|no such file|enoent|cannot find/.test(probe)) {
    return { message: '未找到更新信息，请稍后再试', code: 'not-found', detail }
  }
  if (/eacces|eperm|enospc|erofs|no space/.test(probe)) {
    return { message: '磁盘空间不足或没有写入权限', code: 'disk', detail }
  }
  return { message: '更新失败，请稍后重试', code: 'unknown', detail }
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
    writeLog(`通道: github ${UPDATER_GITHUB_OWNER}/${UPDATER_GITHUB_REPO}`)
  } else {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATER_BASE_URL })
    writeLog(`通道: generic ${UPDATER_BASE_URL}`)
  }
  return true
}

/** 降级到备用直链（不经过 GitHub API） */
function switchToFallback(): void {
  usingFallback = true
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATER_FALLBACK_URL })
  writeLog(`降级到备用通道: ${UPDATER_FALLBACK_URL}`)
}

/**
 * 检查更新；主通道报「通道不可用」类错误时自动降级重试一次。
 * 404 / 校验失败这类错误降级也没用，直接抛出。
 */
async function checkWithFallback(): Promise<UpdateCheckResult | null> {
  try {
    return await autoUpdater.checkForUpdates()
  } catch (e) {
    if (usingFallback || UPDATER_PROVIDER !== 'github') throw e
    const code = normalizeError(e).code
    if (code === 'network' || code === 'rate-limit' || code === 'not-found') {
      switchToFallback()
      return await autoUpdater.checkForUpdates()
    }
    throw e
  }
}

function notifyReleaseNotes(info: UpdateInfo): void {
  try {
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
  } catch {
    // 通知失败与更新本身无关，忽略
  }
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
    ipcMain.handle('updater:check', () => ({
      ok: false,
      reason: '开发模式不支持更新',
      code: 'dev-mode' as UpdaterErrorCode,
      detail: '应用未打包，自动更新未启用',
      updateAvailable: false,
      version: app.getVersion()
    }))
    ipcMain.handle('updater:download', () => ({
      ok: false,
      reason: '开发模式不支持更新',
      code: 'dev-mode' as UpdaterErrorCode,
      detail: '应用未打包，自动更新未启用'
    }))
    ipcMain.handle('updater:cancel', () => false)
    ipcMain.handle('updater:install', () => false)
    return
  }

  configureFeed()

  autoUpdater.on('error', (err: Error) => {
    const n = normalizeError(err)
    writeLog(`error [${n.code}] ${n.detail}`)
    emit({ type: 'error', message: n.message, code: n.code, detail: n.detail })
  })

  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    availableInfo = info
    writeLog(`available ${info.version}`)
    emit({
      type: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    })
  })

  autoUpdater.on('update-not-available', () => {
    writeLog(`not-available (current ${app.getVersion()})`)
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
    writeLog(`downloaded ${info.version}`)
    emit({ type: 'downloaded', version: info.version })
    notifyReleaseNotes(info)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await checkWithFallback()
      if (!result) return { ok: false, reason: '未返回更新信息', code: 'not-found' as UpdaterErrorCode, detail: 'checkForUpdates 返回空结果', updateAvailable: false, version: app.getVersion() }
      return {
        ok: true,
        updateAvailable: Boolean(result.updateInfo && result.updateInfo.version !== app.getVersion()),
        version: result.updateInfo?.version ?? app.getVersion()
      }
    } catch (e) {
      const n = normalizeError(e)
      writeLog(`check 失败 [${n.code}] ${n.detail}`)
      emit({ type: 'error', message: n.message, code: n.code, detail: n.detail })
      return {
        ok: false,
        reason: n.message,
        code: n.code,
        detail: n.detail,
        updateAvailable: false,
        version: app.getVersion()
      }
    }
  })

  ipcMain.handle('updater:download', async () => {
    if (updateReady) return { ok: true, alreadyReady: true }
    try {
      cancelToken = new CancellationToken()
      await autoUpdater.downloadUpdate(cancelToken)
      return { ok: true }
    } catch (e) {
      const n = normalizeError(e)
      writeLog(`download 失败 [${n.code}] ${n.detail}`)
      emit({ type: 'error', message: n.message, code: n.code, detail: n.detail })
      return { ok: false, reason: n.message, code: n.code, detail: n.detail }
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
    checkWithFallback().catch(() => undefined)
  }
  setTimeout(silentCheck, 8000)
  // 之后每 6 小时轮询一次，长时间挂着的应用也能收到新的发布
  setInterval(silentCheck, 6 * 60 * 60 * 1000)
}
