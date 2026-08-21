/**
 * 请求闸门策略:除公开路径外,校验会话 cookie。
 * @module @deepseek-ai/dsh-remote-access/src/gate
 */

import type { IncomingMessage } from 'node:http'
import type { RequestGate } from '@deepseek-ai/dsh-host-webserver'
import { readCookie, verifySession, sessionExpired } from './session.ts'

/** 无需鉴权的公开路径。 */
export const PUBLIC_PATHS = ['/auth/login', '/auth/logout']

/** Cloudflare 边缘注入的代理头;存在即视为经隧道的公网流量(攻击者无法在边缘伪造或删除)。 */
const TUNNEL_HEADERS = ['cf-ray', 'cf-ipcountry', 'cf-connecting-ip']

/**
 * 判断来源地址是否为可信本机/私网地址(环回、链路本地、唯一本地、RFC1918)。
 * @param address - `socket.remoteAddress`(可能是 IPv6 映射的 IPv4)。
 */
function isPrivateAddress(address: string): boolean {
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  if (ipv4 === '::1' || ipv4.startsWith('fe80:') || ipv4.startsWith('fc') || ipv4.startsWith('fd')) return true
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ipv4)
  if (match === null) return false
  const a = Number(match[1])
  const b = Number(match[2])
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/**
 * 判断请求是否来自可信局域网直连:来源为私网地址且不携带 Cloudflare
 * 隧道特征头。隧道流量虽经本机 cloudflared 回源(remoteAddress 为环回),
 * 但边缘注入的 `cf-*` 头使其仍被强制鉴权。
 * @param req - 入站请求。
 */
export function isTrustedLanRequest(req: IncomingMessage): boolean {
  for (const header of TUNNEL_HEADERS) {
    if (req.headers[header] !== undefined) return false
  }
  return isPrivateAddress(req.socket.remoteAddress ?? '')
}

export interface GateDeps {
  secret: string
  cookieName: string
  now: () => number
  /** 判断某 token 是否在会话签发后被吊销(返回 true 则拒绝会话)。 */
  isRevoked: (tokenId: string, issuedAt: number) => boolean
  /** 局域网直连免鉴权(私网地址且无 Cloudflare 隧道头时放行)。 */
  lanBypass: boolean
}

/** 从请求 cookie 里解析会话;有效则放行。 */
export function createRequestGate(deps: GateDeps): RequestGate {
  return (req: IncomingMessage) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (PUBLIC_PATHS.includes(path)) return { allowed: true }
    if (deps.lanBypass && isTrustedLanRequest(req)) return { allowed: true }
    const cookie = readCookie(req, deps.cookieName)
    const session = cookie === undefined ? undefined : verifySession(deps.secret, cookie)
    if (session !== undefined && !sessionExpired(session, deps.now()) && !deps.isRevoked(session.tokenId, session.issuedAt)) {
      return { allowed: true }
    }
    const isUpgrade = (req.headers.upgrade ?? '').length > 0
    if (path.startsWith('/api/') || isUpgrade) {
      // 诊断:API/upgrade 被拦,记是否有 cookie。
      console.log(`remote-access: 拦截 API/WS path=${path} hasCookie=${cookie !== undefined} ip=${req.socket.remoteAddress}`)
      return { allowed: false, status: 401 }
    }
    console.log(`remote-access: 拦截页面 path=${path} hasCookie=${cookie !== undefined} ip=${req.socket.remoteAddress}`)
    return { allowed: false, location: '/auth/login' }
  }
}
