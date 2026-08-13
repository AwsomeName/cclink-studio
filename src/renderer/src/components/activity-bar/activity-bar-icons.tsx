import type { CSSProperties, ReactElement, ReactNode } from 'react'

interface ActivityIconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

function ActivityIcon(
  { size = 24, className, style }: ActivityIconProps,
  body: ReactNode,
): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height={size}
      style={{ ...style, flexShrink: 0 }}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65">
        {body}
      </g>
    </svg>
  )
}

export function ActivityProjectsIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="6" rx="1.4" width="7" x="3" y="4" />
      <rect height="6" rx="1.4" width="7" x="14" y="4" />
      <rect height="6" rx="1.4" width="7" x="3" y="14" />
      <rect height="6" rx="1.4" width="7" x="14" y="14" />
    </>,
  )
}

export function ActivitySessionsIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <path d="M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4.5 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
      <path d="M17 8.5h2a2 2 0 0 1 2 2V17l-3-2h-2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01" />
    </>,
  )
}

export function ActivityRolesIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <path d="M3 4.5c2.4-.8 4.8-.8 7 0v6c0 2.4-1.4 4.3-3.5 5.4C4.4 14.8 3 12.9 3 10.5v-6Z" />
      <path d="M5 8h.01M8 8h.01M5.1 11.4c.9.6 1.8.6 2.7 0" />
      <path d="M11.5 6.5c3-.8 5.8-.8 8.5 0v7c0 3-1.7 5.2-4.25 6.4-2.55-1.2-4.25-3.4-4.25-6.4v-7Z" />
      <path d="M14 11h.01M17.5 11h.01M13.9 15c1.2-.9 2.5-.9 3.7 0" />
    </>,
  )
}

export function ActivityFilesIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <path d="M3 6.5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z" />
      <path d="M8 10v6M8 12.5h4M12 12.5v3M12 15.5h3" />
      <path d="M8 10h.01M8 16h.01M15 15.5h.01" strokeWidth="2.4" />
    </>,
  )
}

export function ActivityRemoteIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <path d="M7.2 17.5H6a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 8.2a4.7 4.7 0 0 1 .3 9.3H17" />
      <path d="m8 14 2-2 2 2M10 12v7M16 17l-2 2-2-2M14 19v-7" />
    </>,
  )
}

export function ActivityBrowserIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="16" rx="2" width="19" x="2.5" y="4" />
      <path d="M2.5 8.5h19M6 6.25h.01M9 6.25h.01" />
      <circle cx="12" cy="14" r="3.4" />
      <path d="M8.6 14h6.8M12 10.6c1 1 1.5 2.1 1.5 3.4s-.5 2.4-1.5 3.4M12 10.6c-1 1-1.5 2.1-1.5 3.4s.5 2.4 1.5 3.4" />
    </>,
  )
}

export function ActivityDataSourcesIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <ellipse cx="10" cy="6" rx="6" ry="2.7" />
      <path d="M4 6v5c0 1.5 2.7 2.7 6 2.7s6-1.2 6-2.7V6M4 11v5c0 1.5 2.7 2.7 6 2.7 1.2 0 2.3-.2 3.2-.5" />
      <path d="M16 15.5h3.5M19.5 15.5v3M19.5 18.5H22" />
      <circle cx="15" cy="15.5" r="1" />
      <circle cx="22" cy="18.5" r="1" />
    </>,
  )
}

export function ActivityTerminalIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="16" rx="2" width="19" x="2.5" y="4" />
      <path d="M2.5 8h19M6.5 11.5 9 14l-2.5 2.5M11.5 16.5h5" />
    </>,
  )
}

export function ActivityWebAccountsIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="16" rx="2" width="19" x="2.5" y="4" />
      <path d="M2.5 8.5h19M6 6.25h.01M9 6.25h.01" />
      <circle cx="12" cy="12.4" r="2.2" />
      <path d="M7.8 18c.5-2.3 2-3.5 4.2-3.5s3.7 1.2 4.2 3.5" />
    </>,
  )
}

export function ActivityAffairsIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="13" cy="12" r="2" />
      <path d="M7 6h2a4 4 0 0 1 4 4M7 18h2a4 4 0 0 0 4-4M15 12h2.5" />
      <path d="m17.5 12 1.8 1.8 3.2-4" />
    </>,
  )
}

export function ActivityScheduledTasksIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="16" rx="2" width="15" x="3" y="4.5" />
      <path d="M7 2.5v4M14 2.5v4M3 9h15" />
      <circle cx="16.5" cy="16.5" r="4.5" />
      <path d="M16.5 14v2.7l1.8 1" />
    </>,
  )
}

export function ActivityProductionIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <rect height="8" rx="1" width="8" x="8" y="8" />
      <path d="M6 7V4M10 7V4M14 7V4M18 7V4M6 20v-3M10 20v-3M14 20v-3M18 20v-3M7 6H4M7 10H4M7 14H4M7 18H4M20 6h-3M20 10h-3M20 14h-3M20 18h-3" />
      <path d="m10.2 12 1.2 1.2 2.6-2.6" />
    </>,
  )
}

export function ActivitySettingsIcon(props: ActivityIconProps): ReactElement {
  return ActivityIcon(
    props,
    <>
      <path d="M9.7 3.2h4.6l.5 2a7.8 7.8 0 0 1 1.5.9l2-.6 2.3 4-1.5 1.4a7.4 7.4 0 0 1 0 2.2l1.5 1.4-2.3 4-2-.6a7.8 7.8 0 0 1-1.5.9l-.5 2H9.7l-.5-2a7.8 7.8 0 0 1-1.5-.9l-2 .6-2.3-4 1.5-1.4a7.4 7.4 0 0 1 0-2.2L3.4 9.5l2.3-4 2 .6a7.8 7.8 0 0 1 1.5-.9l.5-2Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  )
}
