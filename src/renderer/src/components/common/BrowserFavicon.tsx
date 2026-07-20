import { useEffect, useState } from 'react'
import { IconGlobe } from './Icons'

export function BrowserFavicon({
  src,
  size = 16,
}: {
  src?: string | null
  size?: number
}): React.ReactElement {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return <IconGlobe size={size} />
  }

  return (
    <img
      className="browser-favicon"
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
