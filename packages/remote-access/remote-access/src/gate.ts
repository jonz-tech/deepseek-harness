/**
 * 请求闸门策略:除公开路径外,校验会话 cookie。
 * @module @deepseek-ai/dsh-remote-access/src/gate
 */

import type { IncomingMessage } from 'node:http'
import type { RequestGate } from '@deepseek-ai/dsh-host-webserver'
import { readCookie, verifySession, sessionExpired } from './session.ts'

/** 无需鉴权的公开路径。 */
export const PUBLIC_PATHS = ['/auth/login', '/auth/logout']

export interface GateDeps {
  secret: string
  cookieName: string
  now: () => number
  /** 判断某 token 是否在会话签发后被吊销(返回 true 则拒绝会话)。 */
  isRevoked: (tokenId: string, issuedAt: number) => boolean
}

/** 从请求 cookie 里解析会话;有效则放行。 */
export function createRequestGate(deps: GateDeps): RequestGate {
  return (req: IncomingMessage) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (PUBLIC_PATHS.includes(path)) return { allowed: true }
    const cookie = readCookie(req, deps.cookieName)
    const session = cookie === undefined ? undefined : verifySession(deps.secret, cookie)
    if (session !== undefined && !sessionExpired(session, deps.now()) && !deps.isRevoked(session.tokenId, session.issuedAt)) {
      return { allowed: true }
    }
    const isUpgrade = (req.headers.upgrade ?? '').length > 0
    if (path.startsWith('/api/') || isUpgrade) return { allowed: false, status: 401 }
    return { allowed: false, location: '/auth/login' }
  }
}
