/**
 * 更新状态事件的共享类型定义
 *
 * 单独成文件的原因：preload 需要引用该类型给渲染层用，但不能引入 updater.ts，
 * 否则会把 electron 主进程模块（ipcMain / autoUpdater）拖进 preload 侧的类型图。
 * 本文件不引入任何模块，可安全地在 preload 与 master 之间共享。
 */
export type UpdaterEvent =
  | { type: 'error'; message: string }
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
