import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // 不整体外部化 node_modules：sql.js 需要在打包后随主进程 bundle 一起加载，
    // 否则会被 electron-builder 的 "!node_modules/**/*" 排除，导致运行时找不到模块。
    // 这里显式只外部化 electron 运行环境相关模块，其余依赖（含 sql.js）强制打进 bundle。
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        },
        external: ['electron', 'electron/*']
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
