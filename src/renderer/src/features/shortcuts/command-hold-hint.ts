export const COMMAND_HOLD_HINT_DELAY_MS = 700

/** One press owns one timer; using a chord cancels the hint until Command is released. */
export function createCommandHoldHint(options: {
  canShow: () => boolean
  show: () => void
  hide: () => void
}) {
  let held = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    options.hide()
  }
  return {
    press(): void {
      if (held) return
      held = true
      if (!options.canShow()) return
      timer = setTimeout(() => {
        timer = undefined
        if (held && options.canShow()) options.show()
      }, COMMAND_HOLD_HINT_DELAY_MS)
    },
    cancel,
    release(): void {
      held = false
      cancel()
    },
  }
}
