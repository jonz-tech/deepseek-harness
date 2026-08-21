import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { RequestGateResult } from '@deepseek-ai/dsh-host-webserver'
import { createRequestGate } from '../src/gate.ts'
import { signSession } from '../src/session.ts'

/** 构造一个带来源地址与头的假请求;remoteAddress 默认公网地址(不享受 lanBypass)。 */
function req(path: string, options?: {
  cookie?: string | undefined
  upgrade?: boolean | undefined
  remoteAddress?: string | undefined
  cfRay?: string | undefined
}): IncomingMessage {
  return {
    url: path,
    headers: {
      // 真实浏览器发送 `Cookie: dsh=<token>`,此处拼出完整 header 供 readCookie 解析。
      cookie: options?.cookie === undefined ? undefined : `dsh=${options.cookie}`,
      upgrade: options?.upgrade === true ? 'websocket' : '',
      'cf-ray': options?.cfRay,
    },
    socket: { remoteAddress: options?.remoteAddress ?? '203.0.113.7' },
  } as never
}

describe('request gate', () => {
  const secret = 'secret'
  const gate = createRequestGate({ secret, cookieName: 'dsh', now: () => 5000, isRevoked: () => false, lanBypass: false })
  const validCookie = signSession(secret, { sid: 's', tokenId: 't', issuedAt: 1000, expiresAt: 9999 })

  // 闸门在此是同步函数;把返回收窄为同步结果,便于断言(类型上 RequestGate 允许 Promise)。
  const run = (path: string, cookie?: string, upgrade?: boolean): RequestGateResult =>
    gate(req(path, { cookie, upgrade })) as RequestGateResult

  it('allows public paths and valid sessions', () => {
    expect(run('/auth/login').allowed).toBe(true)
    expect(run('/app', validCookie).allowed).toBe(true)
  })

  it('blocks anonymous requests with redirect for pages and 401 for api/upgrade', () => {
    expect(run('/app')).toEqual({ allowed: false, location: '/auth/login' })
    expect(run('/api/x')).toEqual({ allowed: false, status: 401 })
    expect(run('/ws', undefined, true)).toEqual({ allowed: false, status: 401 })
  })

  it('blocks expired sessions', () => {
    const expired = signSession(secret, { sid: 's', tokenId: 't', issuedAt: 1000, expiresAt: 2000 })
    expect(run('/app', expired)).toEqual({ allowed: false, location: '/auth/login' })
  })

  it('blocks a valid-signed, non-expired session whose token was revoked after issue', () => {
    const revokedGate = createRequestGate({ secret, cookieName: 'dsh', now: () => 5000, isRevoked: () => true, lanBypass: false })
    const revokedRun = (path: string, cookie?: string, upgrade?: boolean): RequestGateResult =>
      revokedGate(req(path, { cookie, upgrade })) as RequestGateResult
    expect(revokedRun('/app', validCookie)).toEqual({ allowed: false, location: '/auth/login' })
  })

  describe('lanBypass', () => {
    const lanGate = createRequestGate({ secret, cookieName: 'dsh', now: () => 5000, isRevoked: () => false, lanBypass: true })
    const lanRun = (r: IncomingMessage): RequestGateResult => lanGate(r) as RequestGateResult

    it('allows private-source requests without a session', () => {
      for (const address of ['127.0.0.1', '::1', '192.168.1.5', '10.0.0.8', '172.16.0.1', '::ffff:192.168.1.5']) {
        expect(lanRun(req('/app', { remoteAddress: address })).allowed).toBe(true)
      }
    })

    it('still requires auth for tunnel traffic despite a loopback source', () => {
      // cloudflared 回源自环回,但边缘注入的 cf-ray 头暴露其为公网流量。
      const viaTunnel = req('/app', { remoteAddress: '127.0.0.1', cfRay: '8f3c...' })
      expect(lanRun(viaTunnel)).toEqual({ allowed: false, location: '/auth/login' })
    })

    it('still requires auth for public-source requests', () => {
      expect(lanRun(req('/app'))).toEqual({ allowed: false, location: '/auth/login' })
      expect(lanRun(req('/app', { remoteAddress: '8.8.8.8' }))).toEqual({ allowed: false, location: '/auth/login' })
    })

    it('never bypasses when lanBypass is off', () => {
      expect(gate(req('/app', { remoteAddress: '192.168.1.5' }))).toEqual({ allowed: false, location: '/auth/login' })
    })
  })
})
