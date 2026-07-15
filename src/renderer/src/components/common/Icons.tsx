/**
 * CCLink Studio SVG 图标库
 *
 * 灵感来自 VSCode Codicons，统一 16x16 视口，stroke-based 风格。
 * 用法：<IconFiles size={20} />
 */

import React from 'react'

interface IconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

const defaults: IconProps = { size: 16 }

function I({ size = 16, className, style }: IconProps, path: React.ReactNode): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ ...style, flexShrink: 0 }}
    >
      {path}
    </svg>
  )
}

/* ====== Activity Bar 图标 ====== */

/** 文件浏览器 */
export function IconFiles(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M4 1.5h5.5L13 5v8.5A1.5 1.5 0 0 1 11.5 15H4A1.5 1.5 0 0 1 2.5 13.5V3A1.5 1.5 0 0 1 4 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d="M5 6.5h5.5M5 9h6M5 11.5h4.5"
        stroke="currentColor"
        strokeWidth="1.0"
        strokeLinecap="round"
        opacity="0.72"
      />
    </>,
  )
}

/** 项目 / 工作空间集合 */
export function IconProjects(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="2" y="2.5" width="5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.15" />
      <rect x="9" y="2.5" width="5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.15" />
      <rect x="2" y="9" width="5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.15" />
      <rect x="9" y="9" width="5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.15" />
    </>,
  )
}

/** 搜索 */
export function IconSearch(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 9.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>,
  )
}

/** 浏览器 / 地球 */
export function IconGlobe(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" strokeWidth="1.0" />
      <path
        d="M2.5 8h11M3 5.5h10M3 10.5h10"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.6"
      />
    </>,
  )
}

/** 数据源 / 数据库 */
export function IconDatabase(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <ellipse cx="8" cy="3.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1.15" />
      <path d="M3 3.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" stroke="currentColor" strokeWidth="1.15" />
      <path d="M3 7.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" stroke="currentColor" strokeWidth="1.15" />
      <path d="M3 7.5c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.15" />
    </>,
  )
}

/** 设置 / 齿轮 */
export function IconSettings(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>,
  )
}

export function IconPanelLeft(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.2" />
    </>,
  )
}

export function IconPanelRight(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 3v10" stroke="currentColor" strokeWidth="1.2" />
    </>,
  )
}

/** 用户 / 账户 */
export function IconUser(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="5.2" r="2.7" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M3.2 14c.5-2.8 2.3-4.2 4.8-4.2s4.3 1.4 4.8 4.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>,
  )
}

/* ====== 文件/文件夹图标 ====== */

export function IconFolder(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3l1.5 1.5h6.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8.5z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />,
  )
}

export function IconFile(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />,
  )
}

export function IconClipboard(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="4" y="3.5" width="9" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M6.2 3.5v-1A1.2 1.2 0 0 1 7.4 1.3h2.2a1.2 1.2 0 0 1 1.2 1.2v1"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M6.5 7h4M6.5 9.5h4M6.5 12h2.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path d="M3 5.5H2.5A1.2 1.2 0 0 0 1.3 6.7v5.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>,
  )
}

export function IconChevronRight(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M6 3l5 5-5 5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

export function IconChevronDown(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M3 6l5 5 5-5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

/* ====== 浏览器导航 ====== */

export function IconArrowLeft(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M10 3L5 8l5 5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

export function IconArrowRight(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M6 3l5 5-5 5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

export function IconRefresh(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 2.5v3h-3"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

/** 桌面显示器 */
export function IconMonitor(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>,
  )
}

/** 手机 / 移动端 */
export function IconMobile(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="4" y="1.5" width="8" height="13" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 12.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>,
  )
}

/** 放大（放大镜 +） */
export function IconZoomIn(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9.5 9.5L14 14M4.5 6.5h4M6.5 4.5v4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>,
  )
}

/** 缩小（放大镜 −） */
export function IconZoomOut(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9.5 9.5L14 14M4.5 6.5h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>,
  )
}

/** 适应宽度（双向箭头） */
export function IconFitWidth(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 3v10M14 3v10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </>,
  )
}

/* ====== Agent / 状态 ====== */

/** 状态圆点 */
export function IconCircle({
  filled,
  color,
  ...p
}: IconProps & { filled?: boolean; color?: string }): React.ReactElement {
  const s = p.size ?? 16
  const r = filled ? 5 : 5
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      className={p.className}
      style={p.style}
    >
      <circle
        cx="8"
        cy="8"
        r={r}
        fill={filled ? (color ?? 'currentColor') : 'none'}
        stroke={color ?? 'currentColor'}
        strokeWidth="1.2"
      />
    </svg>
  )
}

/** 发送 / 箭头上 */
export function IconSend(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M8 2v12M4 6l4-4 4 4"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

/** 停止 */
export function IconStop(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />,
  )
}

/* ====== 通用 ====== */

/** 链接 */
export function IconLink(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M6.5 9.5l3-3M9 11l1.5-1.5a3 3 0 0 0-4.24-4.24L5 6.5M7 5L5.5 6.5a3 3 0 0 0 4.24 4.24L11 8.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>,
  )
}

/** 机器人 */
export function IconRobot(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="3" y="5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="6" cy="9" r="1" fill="currentColor" />
      <circle cx="10" cy="9" r="1" fill="currentColor" />
      <path
        d="M8 2v3M5 3l1.5 2M11 3l-1.5 2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>,
  )
}

/** 费用/美元 */
export function IconDollar(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path d="M8 1v14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M11.5 4.5H6.75a2.25 2.25 0 0 0 0 4.5h2.5a2.25 2.25 0 0 1 0 4.5H4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 书签 */
export function IconBookmark(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v12L8 11l-5 3.5v-12z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />,
  )
}

/** 历史/时钟 */
export function IconHistory(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 4.5V8l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 画笔/外观 */
export function IconPaintbrush(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M12 2L6.5 7.5M12 2l2 2-5.5 5.5M12 2L10 4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 7.5C4 9 3 12 3 13c1 0 4-1 5.5-2.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 终端/命令行 */
export function IconTerminal(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M4 6l2.5 2L4 10M8 10h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 键盘 */
export function IconKeyboard(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M4 7h1M7 7h1M10 7h1M4 10h8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>,
  )
}

/** 关闭 (X) */
export function IconClose(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />,
  )
}

/** 加号 (+) */
export function IconPlus(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />,
  )
}

/** Sparkle / AI 魔法 */
export function IconSparkle(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M8 1l1.5 5.5L15 8l-5.5 1.5L8 15l-1.5-5.5L1 8l5.5-1.5L8 1z"
        stroke="currentColor"
        strokeWidth="1.0"
        strokeLinejoin="round"
        fill="none"
      />
    </>,
  )
}

/** 思考/脑 */
export function IconThinking(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5.5 11.5c0 1 1 2.5 2.5 2.5s2.5-1.5 2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.0"
        strokeLinecap="round"
      />
      <circle cx="6.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="9.5" cy="6.5" r="0.5" fill="currentColor" />
    </>,
  )
}

/** 工具/扳手 */
export function IconTool(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M13.5 4.5l-2 2-2-2 2-2a3.5 3.5 0 0 0-4 4.5L3 9.5a1.5 1.5 0 0 0 2 2L9.5 7a3.5 3.5 0 0 0 4-2.5z"
        stroke="currentColor"
        strokeWidth="1.0"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 成功/勾 */
export function IconCheck(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M3.5 8.5l3 3 6-7"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  )
}

/** 错误 */
export function IconError(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>,
  )
}

/** 云（云存储） */
export function IconCloud(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M4.5 11.5a3 3 0 0 1-.27-5.98A4.5 4.5 0 0 1 12 6.5a2.5 2.5 0 0 1 .5 4.95V11.5H4.5z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />,
  )
}

/** 同步（循环箭头） */
export function IconSync(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M2.5 8A5.5 5.5 0 0 1 12 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M13.5 8A5.5 5.5 0 0 1 4 12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M12 1.5V4h2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 14.5V12H1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 云 + 勾（已同步） */
export function IconCloudCheck(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <>
      <path
        d="M4.5 11.5a3 3 0 0 1-.27-5.98A4.5 4.5 0 0 1 12 6.5a2.5 2.5 0 0 1 .5 4.95V11.5H4.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6 9l1.5 1.5L10 7.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  )
}

/** 皇冠（Pro 标识） */
export function IconCrown(p: IconProps = defaults): React.ReactElement {
  return I(
    p,
    <path
      d="M2 11L3.5 4.5L6 7L8 3L10 7L12.5 4.5L14 11H2z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
    />,
  )
}
