/**
 * 远程访问与账号登录插件:可管理的多 token 登录鉴权 + Cloudflare Tunnel 内网穿透。
 * @module @deepseek-ai/dsh-remote-access
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { remoteAccessDomain, type TokenId } from './domain.ts'
import { createRequestGate } from './gate.ts'
import { registerLoginRoutes } from './login.ts'
import { registerTokenCommand } from './command.ts'
import { establishTunnel } from './tunnel.ts'
import { generateToken, hashToken } from './hash.ts'

export const name = 'remote-access'

export const inject = ['webServer', 'storageDomain', 'credentials', 'commands'] as const

/** 远程访问插件配置。domain 为空则禁用隧道;鉴权始终启用。 */
export interface Config {
  /** 会话 cookie 有效期(毫秒)。 */
  sessionTtlMs: number
  /** 会话 cookie 名。 */
  cookieName: string
  /** 会话 HMAC 密钥在 credentials 中的引用名。 */
  sessionSecretRef: string
  /** 公网域名(如 `home.example.com`);空字符串禁用隧道。 */
  domain: string
  /** 本地 dsh 端口(隧道回源目标)。 */
  localPort: number
  /** Cloudflare API token 在 credentials 中的引用名。 */
  cloudflareApiTokenRef: string
  /** 总开关;false 时不注册任何路由/闸门/命令。 */
  enabled: boolean
}

export const Config: z<Config> = z.object({
  sessionTtlMs: z.natural().required(),
  cookieName: z.string().required(),
  sessionSecretRef: z.string().required(),
  domain: z.string().default(''),
  localPort: z.natural().max(65535).default(3080),
  cloudflareApiTokenRef: z.string().default('CLOUDFLARE_API_TOKEN'),
  enabled: z.boolean().default(true),
})

/**
 * 组装鉴权与隧道;鉴权始终启用,隧道在 domain 非空时启用。
 * @param ctx - Cordis 上下文。
 * @param config - 已验证配置。
 * @returns 装配完成(领域打开、路由/闸门/命令注册、隧道启动)后 resolve。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.enabled) return
  const webServer = ctx.webServer as WebServer

  // 1. 打开领域;释放时关闭。
  const domain = await ctx.storageDomain.open(remoteAccessDomain)
  ctx.effect(() => () => { void domain.close() })

  // 2. 解析/生成会话密钥;缺失则生成并落盘。
  const secretRef = credentialRef(config.sessionSecretRef)
  const resolved = await ctx.credentials.resolve(secretRef)
  let secret: string
  if (resolved !== undefined) {
    secret = resolved.value
  } else {
    secret = randomBytes(32).toString('base64')
    await ctx.credentials.set(secretRef, secret)
  }

  // 3. 首次启动生成初始 token(仅经服务端日志显示一次)。
  const tokens = domain.table('tokens')
  if (tokens.size === 0) {
    const initial = generateToken()
    const id = randomUUID() as TokenId
    await tokens.put(id, {
      name: 'initial',
      hash: hashToken(initial),
      createdAt: Date.now(),
      lastUsedAt: null,
      revokedAt: null,
    })
    ctx.logger.info('remote-access: 初始访问 token(仅显示一次): %s', initial)
  }

  // 4. 注册闸门 + 登录路由 + /token 命令。
  ctx.effect(() => webServer.setRequestGate(createRequestGate({
    secret, cookieName: config.cookieName, now: Date.now,
  })))
  ctx.effect(() => registerLoginRoutes(webServer, {
    domain, secret, cookieName: config.cookieName, sessionTtlMs: config.sessionTtlMs, now: Date.now,
    warn: (message) => { ctx.logger.warn('%s', message) },
  }))
  ctx.effect(() => ctx.commands.register(registerTokenCommand({
    domain, now: Date.now, log: (message) => { ctx.logger.info('%s', message) },
  })))

  // 5. 隧道(可选):domain 非空且凭证存在时启动,释放时结束子进程。
  if (config.domain !== '') {
    const apiToken = await ctx.credentials.resolve(credentialRef(config.cloudflareApiTokenRef))
    if (apiToken === undefined) {
      ctx.logger.warn('remote-access: 未配置 %s,跳过隧道', config.cloudflareApiTokenRef)
      return
    }
    ctx.effect(() => {
      const running = establishTunnel({
        apiToken: apiToken.value, domain: config.domain, localPort: config.localPort, now: Date.now,
      })
      running
        .then(({ url }) => { ctx.logger.info('remote-access: 公网地址 %s', url) })
        .catch((error: unknown) => { ctx.logger.warn('remote-access: 隧道建立失败: %s', String(error)) })
      return () => { void running.then(({ child }) => child.kill(), () => {}) }
    })
  }
}
