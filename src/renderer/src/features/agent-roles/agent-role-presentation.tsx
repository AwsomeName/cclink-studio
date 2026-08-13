import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { AgentRoleIcon as AgentRoleIconName } from '@shared/agent-role'

interface AgentRoleIconProps {
  icon: AgentRoleIconName
  size?: number
  className?: string
  style?: CSSProperties
}

function roleIconBody(icon: AgentRoleIconName): ReactNode {
  switch (icon) {
    case 'assistant':
      return (
        <>
          <path d="M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4.5 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
          <path d="m18.5 3 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
          <path d="M7 9.8h.01M10.5 9.8h.01M14 9.8h.01" />
        </>
      )
    case 'challenger':
      return (
        <>
          <path d="M4 7h11M7 4 4 7l3 3M20 17H9M17 14l3 3-3 3" />
          <path d="m13.5 8.5-3 3h3l-3 4" />
        </>
      )
    case 'fact-checker':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m7.7 10.6 1.8 1.8 3.8-4M15 15l5 5" />
        </>
      )
    case 'product':
      return (
        <>
          <circle cx="11" cy="12" r="8" />
          <circle cx="11" cy="12" r="4" />
          <circle cx="11" cy="12" r=".8" />
          <path d="M11 4V2M19 12h2M11 20v2M3 12H1" />
          <path d="m15.5 7.5 4-4M16.5 3.5h3v3" />
        </>
      )
    case 'architect':
      return (
        <>
          <rect height="5" rx="1" width="6" x="9" y="3" />
          <rect height="5" rx="1" width="6" x="3" y="16" />
          <rect height="5" rx="1" width="6" x="15" y="16" />
          <path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
        </>
      )
    case 'governance':
      return (
        <>
          <path d="m12 3 9 4H3l9-4ZM4 20h16M6 17h12M7 8v9M11 8v9M15 8v9M19 8v9" />
        </>
      )
    case 'rights':
      return (
        <>
          <path d="M12 2.5 19 5v5.6c0 4.2-2.5 7.6-7 10.2-4.5-2.6-7-6-7-10.2V5l7-2.5Z" />
          <circle cx="12" cy="9" r="2.2" />
          <path d="M8.5 15.5c.5-2.1 1.7-3.2 3.5-3.2s3 1.1 3.5 3.2" />
        </>
      )
  }
}

export function AgentRoleIcon({
  icon,
  size = 18,
  className,
  style,
}: AgentRoleIconProps): ReactElement {
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
        {roleIconBody(icon)}
      </g>
    </svg>
  )
}
