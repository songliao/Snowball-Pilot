import type { CSSProperties } from 'react'

interface SnowflakeIconProps {
  style?: CSSProperties
  className?: string
}

// 轻量自定义雪花图标（与 antd Outlined 风格一致，stroke 继承 currentColor）
export function SnowflakeIcon({ style, className }: SnowflakeIconProps) {
  const arms = [0, 60, 120, 180, 240, 300]
  return (
    <svg
      viewBox="0 0 1024 1024"
      width="1em"
      height="1em"
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.125em', ...style }}
      stroke="currentColor"
      strokeWidth={36}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {arms.map((a) => (
        <g key={a} transform={`rotate(${a} 512 512)`}>
          <line x1="512" y1="512" x2="512" y2="118" />
          <polyline points="512,238 454,184" />
          <polyline points="512,238 570,184" />
          <polyline points="512,372 470,332" />
          <polyline points="512,372 554,332" />
        </g>
      ))}
    </svg>
  )
}
