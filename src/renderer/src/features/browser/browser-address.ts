/** Address-bar convenience only; navigation authorization stays in the main process. */
export function normalizeBrowserAddress(input: string): string {
  const value = input.trim()
  if (!value || /^https?:\/\//i.test(value)) return value

  try {
    const parsed = new URL(`https://${value}`)
    // Never infer plaintext transport for an address containing credentials.
    if (!parsed.username && !parsed.password && isLocalHostname(parsed.hostname)) {
      return `http://${value}`
    }
  } catch {
    // Keep malformed input on the existing validation/failure path.
  }
  return `https://${value}`
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '[::1]' || /^\[(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host)) return true

  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const [first, second] = host.split('.').map(Number)
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}
