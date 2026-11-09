import { describe, expect, it } from 'vitest'
import { normalizeBrowserAddress } from './browser-address'

describe('browser address input', () => {
  it.each([
    '192.168.31.1',
    '192.168.31.1/cgi-bin/luci/web',
    '10.0.0.1:8080/admin?next=%2F#login',
    '172.16.0.1',
    '172.31.255.254',
    '127.0.0.1:5173',
    '169.254.10.1',
    'localhost:3000',
    'dev.localhost:8080',
    'router.local',
    'ROUTER.LOCAL.',
    '[::1]:3000',
    '[fd12:3456::1]:8080',
    '[fc00::1]',
    '[fe80::1]',
    '[febf::1]',
  ])('defaults an explicit local address to HTTP: %s', (address) => {
    expect(normalizeBrowserAddress(`  ${address}  `)).toBe(`http://${address}`)
  })

  it.each([
    'example.com',
    'example.com/path/192.168.31.1',
    '192.168.31.1.example.com',
    'router.local.example.com',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '8.8.8.8',
    '[2001:db8::1]',
    '[fec0::1]',
    '192.168.31.1@example.com',
    'user:password@192.168.31.1',
  ])('keeps HTTPS for other addresses: %s', (address) => {
    expect(normalizeBrowserAddress(address)).toBe(`https://${address}`)
  })

  it.each(['https://192.168.31.1/', 'HTTPS://router.local', 'http://example.com/', ''])(
    'preserves an explicit protocol or empty input: %s',
    (address) => expect(normalizeBrowserAddress(` ${address} `)).toBe(address),
  )
})
