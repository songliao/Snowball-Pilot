/**
 * 渲染层热更新
 *
 * 与 electron-updater 全量更新互补：
 * - 全量更新（updater.ts）：覆盖整个应用，需要重启；主进程 / preload / 原生依赖变更必须走这条路。
 * - 热更新（本文件）：只替换渲染层（out/renderer 产物），下载解压到 userData，
 *   窗口重新 loadFile 即生效，不重装、不重启进程。
 *
 * 安全模型：
 * 1. app.asar 在 macOS 上有签名，原地改写会破坏签名，所以热更新包绝不写入安装目录，
 *    而是放到 userData/hot-update/ 下，主窗口启动时按 current.json 优先从这里加载。
 * 2. 清单条目的 appVersion 必须与当前主进程版本完全相等才采纳——preload 的 IPC 契约
 *    （window.api）由主进程决定，版本不等就说明渲染层可能与 preload 不兼容，宁可热更不上。
 * 3. 压缩包 sha512 校验通过才解压；解压到临时目录再原子改名；index.html 缺失视为损坏回滚。
 * 4. 加载入口解析时再验证一次文件存在性，任何异常都回退到内置渲染层，保证应用永远能打开。
 *
 * 发布方式：CI 在每个 Release 上附带平台无关的 renderer-<version>.zip 与 hot-update.json
 * （见 scripts/build-hotupdate.mjs）。客户端读取清单 URL（config.ts HOTUPDATE_MANIFEST_URL，
 * github 通道走 latest 资产直链，不经 API、无配额限制）。
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import extract from 'extract-zip'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { HOTUPDATE_MANIFEST_URL } from '../config'
import type { HotUpdateEntry, HotUpdateEvent, HotUpdateErrorCode, HotUpdateManifest } from './hot-update-types'

/** current.json 落盘内容：记录当前生效的热更新包 */
interface CurrentPack {
  appVersion: string
  hotIndex: number
  rendererVersion: string
  /** 解压后的渲染层目录（绝对路径），内含 index.html */
  dir: string
}

let mainWindowRef: BrowserWindow | null = null
/** 本次会话已应用/已就绪的最高 hotIndex，避免重复下载同一包 */
let appliedHotIndex = 0
/** 静默检查定时器句柄（注销时清理） */
let pollTimer: ReturnType<typeof setInterval> | null = null

function emit(event: HotUpdateEvent): void {
  // 广播给所有存活窗口（含窗口重建场景），避免事件发进已销毁的旧引用
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.webContents.getURL().startsWith('data:')) continue
    win.webContents.send('hotupdate:event', event)
  }
}

function writeLog(line: string): void {
  try {
    const file = join(app.getPath('userData'), 'updater.log')
    if (existsSync(file) && statSync(file).size > 256 * 1024) writeFileSync(file, '')
    appendFileSync(file, `[hotupdate] ${new Date().toISOString()} ${line}\n`)
  } catch {
    // 写日志失败不能影响热更新流程
  }
}

/** 与 updater.ts 同款归一化：界面只展示短文案，原文进日志 */
function normalizeError(e: unknown): { message: string; code: HotUpdateErrorCode; detail: string } {
  const raw = e instanceof Error ? (e.stack || e.message) : String(e)
  const detail = raw.length > 1000 ? `${raw.slice(0, 1000)}\n…（已截断）` : raw
  const probe = raw.toLowerCase()
  if (/sha512|checksum|digest|hash mismatch/.test(probe)) {
    return { message: '热更新包校验失败，已放弃本次更新', code: 'checksum', detail }
  }
  if (/enetunreach|enotfound|eai_again|econnreset|econnrefused|etimedout|net::|socket hang up|getaddrinfo|network|timeout|ssl|certificate|unable to connect|premature close/.test(probe)) {
    return { message: '网络连接失败，热更新稍后会自动重试', code: 'network', detail }
  }
  if (/404|not found|no such file|enoent|cannot find/.test(probe)) {
    return { message: '暂无可用热更新', code: 'not-found', detail }
  }
  if (/eacces|eperm|enospc|erofs|no space/.test(probe)) {
    return { message: '磁盘空间不足或没有写入权限', code: 'disk', detail }
  }
  return { message: '热更新失败，稍后会自动重试', code: 'unknown', detail }
}

// ——— 目录布局 ———
// userData/hot-update/packs/<rendererVersion>/  解压后的渲染层
// userData/hot-update/current.json             当前生效包的记录
// userData/hot-update/tmp/                     下载与解压的暂存区
function rootDir(): string {
  return join(app.getPath('userData'), 'hot-update')
}
function packsDir(): string {
  return join(rootDir(), 'packs')
}

/** 读取 current.json；版本不匹配、目录或 index.html 缺失都视为无效 */
function readCurrent(): CurrentPack | null {
  try {
    const file = join(rootDir(), 'current.json')
    if (!existsSync(file)) return null
    const cur = JSON.parse(readFileSync(file, 'utf-8')) as CurrentPack
    if (cur.appVersion !== app.getVersion()) return null
    if (!cur.dir || !existsSync(join(cur.dir, 'index.html'))) return null
    return cur
  } catch {
    return null
  }
}

/**
 * 解析主窗口应加载的渲染层入口。
 * 打包环境优先返回生效中的热更新包；dev 环境走 dev server，调用方不应使用本函数。
 * 必须永远有返回值：热更新任何环节损坏都回退到内置渲染层。
 */
export function resolveRendererEntry(): string {
  const builtin = join(__dirname, '../renderer/index.html')
  try {
    const cur = readCurrent()
    if (cur) {
      appliedHotIndex = Math.max(appliedHotIndex, cur.hotIndex)
      return join(cur.dir, 'index.html')
    }
  } catch {
    // 理论上 readCurrent 内部已兜底，这里再兜一层
  }
  return builtin
}

/** 拉取清单并解析；404 / 解析失败按 not-found 处理 */
async function fetchManifest(): Promise<HotUpdateManifest> {
  const res = await fetch(HOTUPDATE_MANIFEST_URL, { headers: { 'User-Agent': 'SnowballPilot' } })
  if (!res.ok) {
    const err = new Error(`manifest fetch failed: HTTP ${res.status}`)
    ;(err as Error & { statusCode?: number }).statusCode = res.status
    throw err
  }
  const body = (await res.json()) as HotUpdateManifest
  if (!body || !Array.isArray(body.entries)) {
    throw new Error('manifest format invalid: entries missing')
  }
  return body
}

/** 从清单中选出应下载的条目：适配当前主进程版本、且比已应用的新 */
function pickEntry(manifest: HotUpdateManifest): HotUpdateEntry | null {
  let best: HotUpdateEntry | null = null
  for (const entry of manifest.entries) {
    if (entry.appVersion !== app.getVersion()) continue
    if (entry.hotIndex <= appliedHotIndex) continue
    if (!entry.url || !entry.sha512) continue
    if (!best || entry.hotIndex > best.hotIndex) best = entry
  }
  return best
}

/** 下载压缩包（带进度事件），返回写入的临时文件路径 */
async function downloadPack(entry: HotUpdateEntry): Promise<string> {
  // 资源 URL 相对清单所在目录解析
  const base = HOTUPDATE_MANIFEST_URL.replace(/[^/]*$/, '')
  const url = /^https?:\/\//i.test(entry.url) ? entry.url : base + entry.url

  const res = await fetch(url, { headers: { 'User-Agent': 'SnowballPilot' } })
  if (!res.ok || !res.body) {
    throw new Error(`pack download failed: HTTP ${res.status}`)
  }

  const tmpDir = join(rootDir(), 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpFile = join(tmpDir, `pack-${entry.hotIndex}.zip`)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  const total = entry.size || Number(res.headers.get('content-length')) || 0
  let written = 0
  let lastEmit = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    written += value.byteLength
    // 进度事件限频到 ~200ms 一次，避免刷爆 IPC
    const now = Date.now()
    if (total && now - lastEmit > 200) {
      lastEmit = now
      emit({ type: 'progress', percent: Math.min(99, Math.round((written / total) * 100)), received: written, total })
    }
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  if (total && buf.length !== total) {
    throw new Error(`pack size mismatch: expect ${total}, got ${buf.length}`)
  }
  writeFileSync(tmpFile, buf)
  return tmpFile
}

/** 校验 sha512 并解压到 packs/<rendererVersion>，任何失败都清理现场后抛出 */
async function verifyAndInstall(entry: HotUpdateEntry, tmpFile: string): Promise<string> {
  const buf = readFileSync(tmpFile)
  const digest = createHash('sha512').update(buf).digest('hex')
  if (entry.sha512 && digest !== entry.sha512.toLowerCase()) {
    throw new Error(`sha512 mismatch: expect ${entry.sha512}, got ${digest}`)
  }
  if (entry.size && buf.length !== entry.size) {
    throw new Error(`size mismatch: expect ${entry.size}, got ${buf.length}`)
  }

  const targetDir = join(packsDir(), entry.rendererVersion)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(packsDir(), { recursive: true })

  // 先解压到暂存目录，校验 index.html 存在后再原子改名，避免半包状态被 current.json 引用
  const staging = join(rootDir(), 'tmp', `extract-${entry.hotIndex}`)
  rmSync(staging, { recursive: true, force: true })
  try {
    await extract(tmpFile, { dir: staging })
    if (!existsSync(join(staging, 'index.html'))) {
      throw new Error('extracted pack has no index.html')
    }
    renameSync(staging, targetDir)
  } catch (e) {
    rmSync(staging, { recursive: true, force: true })
    throw e
  } finally {
    rmSync(tmpFile, { force: true })
  }
  return targetDir
}

/** 清理当前包以外的所有残留（跨版本遗留、损坏包等） */
function cleanupOthers(keepDir?: string): void {
  try {
    rmSync(join(rootDir(), 'tmp'), { recursive: true, force: true })
    if (!existsSync(packsDir())) return
    for (const name of readdirSync(packsDir())) {
      const dir = join(packsDir(), name)
      if (dir !== keepDir) rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // 清理失败不影响主流程
  }
}

/** 应用一个已下载校验过的包：写 current.json、记录状态、通知渲染层 */
function applyEntry(entry: HotUpdateEntry, dir: string): void {
  const current: CurrentPack = {
    appVersion: app.getVersion(),
    hotIndex: entry.hotIndex,
    rendererVersion: entry.rendererVersion,
    dir
  }
  // 原子写入：先写临时文件再改名，避免断电留下半截 current.json
  const file = join(rootDir(), 'current.json')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(current, null, 2))
  renameSync(tmp, file)

  appliedHotIndex = Math.max(appliedHotIndex, entry.hotIndex)
  cleanupOthers(dir)
  writeLog(`applied ${entry.rendererVersion} (${entry.size} bytes)`)

  emit({ type: 'applied', rendererVersion: entry.rendererVersion, notes: entry.notes })
}

/** 完整流程：拉清单 → 选包 → 下载 → 校验解压 → 应用。返回是否有可用更新 */
async function runOnce(): Promise<'applied' | 'up-to-date' | 'no-compatible'> {
  const manifest = await fetchManifest()
  const entry = pickEntry(manifest)
  if (!entry) return 'no-compatible'
  emit({ type: 'progress', percent: 0, received: 0, total: entry.size })
  const tmpFile = await downloadPack(entry)
  const dir = await verifyAndInstall(entry, tmpFile)
  applyEntry(entry, dir)
  return 'applied'
}

/** 重新加载主窗口（渲染层热更新生效的唯一动作，进程不重启） */
function reloadRenderer(): boolean {
  const entry = resolveRendererEntry()
  let reloaded = false
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    // 关于窗口加载的是 data: URL，不属于渲染层，只重载主窗口
    if (win.webContents.getURL().startsWith('data:')) continue
    void win.webContents.loadFile(entry)
    reloaded = true
  }
  return reloaded
}

/**
 * 注册热更新 IPC 与静默检查调度。
 * 开发模式不注册任何逻辑（渲染层不会收到事件，UI 自然不出现）。
 */
export function registerHotUpdateHandlers(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow

  if (!app.isPackaged) {
    console.log('[hotupdate] 开发模式，热更新未启用')
    ipcMain.handle('hotupdate:reload', () => false)
    return
  }

  ipcMain.handle('hotupdate:reload', () => reloadRenderer())

  // 启动 20s 后静默检查一次（错开 8s 时的全量更新检查高峰），之后每 30 分钟轮询。
  // 清单只有几 KB，轮询成本可忽略；发现新包自动下载应用，应用时机由用户点击「立即刷新」决定。
  const silentCheck = (): void => {
    runOnce()
      .then((r) => {
        if (r !== 'no-compatible') writeLog(`check → ${r}`)
      })
      .catch((e) => {
        const n = normalizeError(e)
        // not-found = latest release 还没有热更新清单，属正常状态，不记错误
        if (n.code !== 'not-found') {
          writeLog(`check 失败 [${n.code}] ${n.detail}`)
          emit({ type: 'error', message: n.message, code: n.code, detail: n.detail })
        }
      })
  }
  setTimeout(silentCheck, 20000)
  pollTimer = setInterval(silentCheck, 30 * 60 * 1000)
}

/** 测试/注销用：停掉轮询 */
export function stopHotUpdatePolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
