import { describe, expect, it } from 'vitest'
import { cloudflaredDownloadUrl, cloudflaredBinaryPath } from '../src/cloudflared.ts'

describe('cloudflared', () => {
  it('maps platform/arch to release assets', () => {
    expect(cloudflaredDownloadUrl('darwin', 'arm64')).toContain('cloudflared-darwin-arm64')
    expect(cloudflaredDownloadUrl('linux', 'x64')).toContain('cloudflared-linux-amd64')
    expect(() => cloudflaredDownloadUrl('win32', 'x64')).toThrow(/unsupported platform/)
  })

  it('resolves the binary path under the data dir', () => {
    expect(cloudflaredBinaryPath('/data')).toBe('/data/cloudflared')
  })
})
