/**
 * 登录页 + 登录/登出路由。
 * @module @deepseek-ai/dsh-remote-access/src/login
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { signSession } from './session.ts'
import { verifyToken } from './hash.ts'
import { remoteAccessDomain, type TokenRecord, type AccessRecord, type TokenId } from './domain.ts'

export const LOGIN_PAGE_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>登录</title></head>
<body><form method="post" action="/auth/login"><label>访问 token <input name="token" type="password" autofocus></label>
<button type="submit">登录</button></form></body></html>`

export interface LoginDeps {
  domain: Domain<typeof remoteAccessDomain>
  secret: string
  cookieName: string
  sessionTtlMs: number
  now: () => number
  /** 异步写失败的告警回写(不阻塞登录响应,但不静默丢弃)。 */
  warn: (message: string) => void
}

/** 从请求体读取 URL 编码的 `token` 字段。 */
async function readBody(req: IncomingMessage): Promise<string> {
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  return new URLSearchParams(raw).get('token') ?? ''
}

/** 客户端 IP,取 `x-forwarded-for` 首个或 socket 地址。 */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) {
    const first = fwd.split(',')[0]
    if (first !== undefined && first.trim().length > 0) return first.trim()
  }
  return req.socket.remoteAddress ?? ''
}

/** 注册 /auth/login(GET/POST)与 /auth/logout(POST)路由。 */
export function registerLoginRoutes(webServer: WebServer, deps: LoginDeps): () => void {
  const tokens = deps.domain.table('tokens')
  const access = deps.domain.table('access')

  const unregisterLogin = webServer.register({
    kind: 'exact',
    path: '/auth/login',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(LOGIN_PAGE_HTML)
        return
      }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      const plain = await readBody(req)
      // 逐个校验非吊销 token。
      let matched: { id: TokenId; record: TokenRecord } | undefined
      for (const [id, record] of tokens.entries()) {
        if (record.revokedAt !== null) continue
        if (verifyToken(plain, record.hash)) { matched = { id, record }; break }
      }
      if (matched === undefined) { res.writeHead(401); res.end('unauthorized'); return }
      const now = deps.now()
      const session = { sid: randomUUID(), issuedAt: now, expiresAt: now + deps.sessionTtlMs }
      const cookie = signSession(deps.secret, session)
      res.writeHead(302, {
        'Set-Cookie': `${deps.cookieName}=${cookie}; HttpOnly; Secure; Path=/; Max-Age=${Math.floor(deps.sessionTtlMs / 1000)}`,
        Location: '/',
      })
      res.end()
      // 访问日志 + 最后使用时间(异步落地,不阻塞响应)。
      tokens.update(matched.id, rec => ({ ...rec, lastUsedAt: now }))
        .catch((error: unknown) => deps.warn(`remote-access: 更新 lastUsedAt 失败: ${String(error)}`))
      access.put(randomUUID(), {
        tokenId: matched.id, at: now, ip: clientIp(req), userAgent: req.headers['user-agent'] ?? '',
      } satisfies AccessRecord).catch((error: unknown) => deps.warn(`remote-access: 写 access-log 失败: ${String(error)}`))
    },
  })

  const unregisterLogout = webServer.register({
    kind: 'exact',
    path: '/auth/logout',
    handler: (_req, res) => {
      res.writeHead(302, {
        'Set-Cookie': `${deps.cookieName}=; HttpOnly; Secure; Path=/; Max-Age=0`,
        Location: '/auth/login',
      })
      res.end()
    },
  })

  return () => { unregisterLogout(); unregisterLogin() }
}
