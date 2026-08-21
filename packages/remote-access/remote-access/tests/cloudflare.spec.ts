import { describe, expect, it, vi, afterEach } from 'vitest'
import { createTunnel } from '../src/cloudflare.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('cloudflare client', () => {
  it('resolves zone then creates tunnel and CNAME', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      const u = String(url)
      if (u.includes('/zones?')) return new Response(JSON.stringify({ result: [{ id: 'z1', name: 'home.example.com', account: { id: 'a1' } }] }), { status: 200 })
      if (u.includes('/cfd_tunnel')) return new Response(JSON.stringify({ result: { id: 't1', token: 'tok' } }), { status: 200 })
      if (u.includes('/dns_records')) return new Response(JSON.stringify({ result: {} }), { status: 200 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createTunnel('api-token', 'home.example.com')
    expect(result).toEqual({ tunnelId: 't1', tunnelToken: 'tok' })
    expect(calls.map(c => c.url)).toEqual([
      expect.stringContaining('/zones?name=home.example.com'),
      expect.stringContaining('/accounts/a1/cfd_tunnel'),
      expect.stringContaining('/zones/z1/dns_records'),
    ])
    expect(calls[0]!.init!.headers).toMatchObject({ Authorization: 'Bearer api-token' })
  })
})
