/**
 * 更新状态事件的共享类型定义
 *
 * 单独成文件的原因：preload 需要引用该类型给渲染层用，但不能引入 updater.ts，
 * 否则会把 electron 主进程模块（ipcMain / autoUpdater）拖进 preload 侧的类型图。
 * 本文件不引入任何模块，可安全地在 preload 与 master 之间共享。
 */

/** 错误分类：界面据此选择文案，避免把原始错误直接刷给用户 */
export type UpdaterErrorCode =
  | 'network' // 网络不可达 / 连接中断
  | 'rate-limit' // GitHub API 限流（403）
  | 'not-found' // 找不到更新清单或安装包
  | 'checksum' // 下载内容校验失败
  | 'disk' // 写入缓存目录失败
  | 'dev-mode' // 开发环境未启用更新
  | 'unknown'

export type UpdaterEvent =
  /** message 为可直接展示的简短中文；detail 仅用于「查看详情」，可能很长 */
  | { type: 'error'; message: string; code: UpdaterErrorCode; detail: string }
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
