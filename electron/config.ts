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
