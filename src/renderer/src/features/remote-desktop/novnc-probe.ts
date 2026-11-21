import type RFB from '@novnc/novnc'

// Read-only counters around noVNC 1.7.0 internals so the Framework Log can show
// whether slowness comes from input, network volume or frame decoding, and what
// cursor shapes the server sends. Returns a stop function, or undefined when the
// internals are missing.

interface Internals {
  _framebufferUpdate?: () => boolean
  _handleRect?: () => boolean
  _updateCursor?: (rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number) => void
  _FBU?: { encoding: number | null; width: number; height: number }
}

const ENCODING_NAMES: Record<number, string> = {
  0: 'raw',
  1: 'copyrect',
  2: 'rre',
  5: 'hextile',
  6: 'zlib',
  7: 'tight',
  16: 'zrle',
  21: 'jpeg',
  [-239]: 'cursor',
  [-240]: 'xcursor',
  [-223]: 'desktopsize',
  [-308]: 'extdesktopsize',
  [-224]: 'lastrect',
  [0x574d5664]: 'vmwcursor',
}

export interface ProbeSink {
  log(...values: unknown[]): void
  takeWheelSteps(): number
}

export function installNoVncProbe(
  rfb: RFB,
  sink: ProbeSink,
  windowMs = 2000,
  maxLines = 90,
): (() => void) | undefined {
  const r = rfb as unknown as Internals
  const fbu = r._framebufferUpdate
  const rect = r._handleRect
  const cursor = r._updateCursor
  if (typeof fbu !== 'function' || typeof rect !== 'function' || typeof cursor !== 'function') {
    return undefined
  }
  let frames = 0
  let emptyUpdates = 0
  let frameHasData = false
  let pixels = 0
  const encodings: Record<string, number> = {}
  let lines = 0
  let cursorLines = 0

  r._framebufferUpdate = function (this: Internals) {
    const done = fbu.call(this)
    if (done) {
      if (frameHasData) frames++
      else emptyUpdates++
      frameHasData = false
    }
    return done
  }
  r._handleRect = function (this: Internals) {
    const encoding = this._FBU?.encoding ?? null
    const width = this._FBU?.width ?? 0
    const height = this._FBU?.height ?? 0
    const done = rect.call(this)
    if (done && encoding !== null) {
      const name = ENCODING_NAMES[encoding] ?? String(encoding)
      encodings[name] = (encodings[name] ?? 0) + 1
      if (encoding >= 0) {
        pixels += width * height
        frameHasData = true
      }
    }
    return done
  }
  r._updateCursor = function (this: Internals, rgba, hotx, hoty, w, h) {
    if (cursorLines++ < 20) {
      let visible = false
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i]) {
          visible = true
          break
        }
      }
      sink.log(`cursor shape ${w}x${h} hot=${hotx},${hoty} ${visible ? 'visible' : 'TRANSPARENT'}`)
    }
    cursor.call(this, rgba, hotx, hoty, w, h)
  }

  const timer = window.setInterval(() => {
    const wheel = sink.takeWheelSteps()
    if (!frames && !wheel) {
      emptyUpdates = 0
      return
    }
    if (lines++ >= maxLines) return
    const megapixels = (pixels / 1e6).toFixed(2)
    sink.log(
      `perf ${windowMs / 1000}s frames=${frames} empty=${emptyUpdates} updatedMP=${megapixels} wheel=${wheel}`,
      JSON.stringify(encodings),
    )
    frames = 0
    emptyUpdates = 0
    pixels = 0
    for (const key of Object.keys(encodings)) delete encodings[key]
  }, windowMs)

  return () => {
    window.clearInterval(timer)
    r._framebufferUpdate = fbu
    r._handleRect = rect
    r._updateCursor = cursor
  }
}
