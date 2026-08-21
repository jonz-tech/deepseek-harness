import { describe, expect, it } from 'vitest'
import type { RequestGateResult } from '@deepseek-ai/dsh-host-webserver'
import { createRequestGate } from '../src/gate.ts'
import { signSession } from '../src/session.ts'

function req(path: string, cookie?: string, upgrade = false): Parameters<ReturnType<typeof createRequestGate>>[0] {
  return {
    url: path,
    // 真实浏览器发送 `Cookie: dsh=<token>`,此处拼出完整 header 供 readCookie 解析。
    headers: { cookie: cookie === undefined ? undefined : `dsh=${cookie}`, upgrade: upgrade ? 'websocket' : '' },
  } as never
}

describe('request gate', () => {
  const secret = 'secret'
  const gate = createRequestGate({ secret, cookieName: 'dsh', now: () => 5000, isRevoked: () => false })
  const validCookie = signSession(secret, { sid: 's', tokenId: 't', issuedAt: 1000, expiresAt: 9999 })

  // 闸门在此是同步函数;把返回收窄为同步结果,便于断言(类型上 RequestGate 允许 Promise)。
  const run = (path: string, cookie?: string, upgrade?: boolean): RequestGateResult =>
    gate(req(path, cookie, upgrade)) as RequestGateResult

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
    const revokedGate = createRequestGate({ secret, cookieName: 'dsh', now: () => 5000, isRevoked: () => true })
    const revokedRun = (path: string, cookie?: string, upgrade?: boolean): RequestGateResult =>
      revokedGate(req(path, cookie, upgrade)) as RequestGateResult
    expect(revokedRun('/app', validCookie)).toEqual({ allowed: false, location: '/auth/login' })
  })
})
