/**
 * 渲染层热更新的共享类型定义
 *
 * 与 updater-types.ts 同理：preload 需要引用这些类型给渲染层用，
 * 但不能引入 hot-update.ts（会拖进 ipcMain 等 electron 主进程模块）。
 * 本文件不引入任何模块，可安全地在 preload 与主进程之间共享。
 */

/** 错误分类：界面据此选择文案，避免把原始错误直接刷给用户 */
export type HotUpdateErrorCode =
  | 'network' // 网络不可达 / 连接中断
  | 'not-found' // 清单或热更新包不存在
  | 'checksum' // 下载内容校验失败
  | 'disk' // 解压 / 写入失败
  | 'dev-mode' // 开发环境未启用
  | 'unknown'

/**
 * 清单里的一条热更新记录。
 * appVersion 必须与客户端主进程版本完全一致才会被采纳——
 * 主进程 / preload 变更只能走全量更新，热更新包永远只含渲染层。
 */
export interface HotUpdateEntry {
  /** 适配的主进程版本（package.json version），必须完全相等 */
  appVersion: string
  /** 热更新序号：0 表示随该版本发布的基础包（客户端会跳过），≥1 才是真正的热修复 */
  hotIndex: number
  /** 展示用版本号，如 1.0.11-hot.1 */
  rendererVersion: string
  /** 压缩包文件名，相对清单所在目录解析 */
  url: string
  /** 压缩包 sha512（hex） */
  sha512: string
  /** 压缩包字节数 */
  size: number
  /** 更新说明（展示给用户） */
  notes?: string
  /** 发布时间（ISO 字符串，仅展示用） */
  publishedAt?: string
}

export interface HotUpdateManifest {
  entries: HotUpdateEntry[]
}

/** 主进程 → 渲染层的事件 */
export type HotUpdateEvent =
  | { type: 'checking' }
  | { type: 'progress'; percent: number; received: number; total: number }
  | { type: 'applied'; rendererVersion: string; notes?: string }
  | { type: 'error'; message: string; code: HotUpdateErrorCode; detail: string }
