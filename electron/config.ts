/**
 * 应用运行时配置（主进程）
 *
 * 优先级：环境变量 > 默认值
 * 开发模式下可在 .env 文件中设置（项目根目录），
 * 打包时通过构建脚本 source .env 注入环境变量。
 */

// 鉴权服务 API 基地址（不含尾部斜杠）
export const API_BASE_URL: string =
  process.env.API_BASE_URL || 'http://8.159.158.153:6001'

// ——— 自动更新（electron-updater）———
// 更新通道类型：github（GitHub Releases，默认，仓库已公开无需 token）| generic（自有静态服务器）
export const UPDATER_PROVIDER: 'generic' | 'github' =
  (process.env.UPDATER_PROVIDER as 'generic' | 'github') || 'github'

// generic 通道：存放 latest.yml / 安装包 / 增量包的根目录 URL（不带尾部斜杠）
export const UPDATER_BASE_URL: string =
  process.env.UPDATER_BASE_URL || 'http://8.159.158.153:6001/releases'

// github 通道：仓库归属与目标仓库名
export const UPDATER_GITHUB_OWNER: string =
  process.env.UPDATER_GITHUB_OWNER || 'songliao'
export const UPDATER_GITHUB_REPO: string =
  process.env.UPDATER_GITHUB_REPO || 'Snowball-Pilot'
// 私有仓库拉取 release 资源所需；公开仓库留空即可
export const UPDATER_GITHUB_TOKEN: string =
  process.env.UPDATER_GITHUB_TOKEN || ''
