import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // sql.js 是 UMD 模块，其内部会执行 `module.exports = initSqlJs`。若被打包进 bundle，
    // 该作用域内 `module` 为 undefined，会抛 "Cannot set properties of undefined (setting 'exports')"，
    // 导致 initDatabase 失败、窗口无法创建。因此必须把 sql.js 设为外部依赖（external），
    // 让真实的 require('sql.js') 在 Node 环境下正常加载（UMD 的 module.exports 可用）。
    // 运行时的 sql.js 通过 electron-builder 的 files 规则保留进 asar 的 node_modules。
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        },
        external: ['electron', 'electron/*', 'sql.js']
      },
      commonjsOptions: {
        // 确保 sql.js 等 CommonJS 依赖被正确打包
        include: [/node_modules/]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
})
