/**
 * 更新相关弹窗的按钮主题：不使用全局默认的半透明磨砂按钮，
 * 改为不透明实底（跟随明暗主题），与弹窗面板对比清晰。
 * 用法：<ConfigProvider theme={solidButtonTheme(isDark)}><Modal …/></ConfigProvider>
 */
import type { ThemeConfig } from 'antd'

export function solidButtonTheme(isDark: boolean): ThemeConfig {
  return {
    components: {
      Button: {
        defaultBg: isDark ? '#3f3f46' : '#ffffff',
        defaultBorderColor: isDark ? '#52525b' : 'rgba(0, 0, 0, 0.15)',
        defaultColor: isDark ? '#e4e4e7' : '#1e1e22',
        defaultHoverBg: isDark ? '#52525b' : '#f4f4f5',
        defaultHoverBorderColor: isDark ? '#71717a' : 'rgba(0, 0, 0, 0.2)',
        defaultHoverColor: isDark ? '#f4f4f5' : '#0f172a',
        defaultActiveBg: isDark ? '#27272a' : '#e4e4e7',
        defaultActiveBorderColor: isDark ? '#52525b' : 'rgba(0, 0, 0, 0.15)',
        defaultActiveColor: isDark ? '#e4e4e7' : '#1e1e22'
      }
    }
  }
}
