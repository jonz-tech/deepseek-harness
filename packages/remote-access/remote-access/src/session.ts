/**
 * 会话:HMAC 签名 cookie 的签发与校验。
 * @module @deepseek-ai/dsh-remote-access/src/session
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** 会话载荷。 */
export interface Session {
  sid: string
  issuedAt: number
  expiresAt: number
}

/** 签发:base64url(payload) + '.' + HMAC-SHA256 签名。 */
export function signSession(secret: string, session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** 校验:签名不匹配或载荷损坏返回 undefined。 */
export function verifySession(secret: string, cookie: string): Session | undefined {
  const dot = cookie.lastIndexOf('.')
  if (dot === -1) return undefined
  const payload = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session
  } catch {
    return undefined
  }
}

/** 会话是否已过期(或恰好到期)。 */
export function sessionExpired(session: Session, now: number): boolean {
  return session.expiresAt <= now
}

/** 从 `Cookie` 头解析指定名字的 cookie 值;不存在返回 undefined。 */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    if (key === name) return pair.slice(eq + 1).trim()
  }
  return undefined
}
