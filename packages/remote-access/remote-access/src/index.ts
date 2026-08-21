/**
 * 远程访问与账号登录插件:可管理的多 token 登录鉴权 + Cloudflare Tunnel 内网穿透。
 * @module @deepseek-ai/dsh-remote-access
 */

import { randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { remoteAccessDomain, type TokenId } from './domain.ts'
import { createRequestGate } from './gate.ts'
import { registerLoginRoutes } from './login.ts'
import { registerTokenCommand } from './command.ts'
import { TunnelRegistry } from './tunnel/provider.ts'
import { TokenTunnelProvider } from './tunnel/token-provider.ts'
import { ApiTunnelProvider } from './tunnel/api-provider.ts'

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
  /** `api` 模式:Cloudflare API token 在 credentials 中的引用名。 */
  cloudflareApiTokenRef: string
  /** `token` 模式:云端托管隧道的 run token 在 credentials 中的引用名。 */
  tunnelTokenRef: string
  /** 隧道 provider 名:`token`(复用已有隧道)或 `api`(API 自动建隧道)。 */
  tunnelProvider: 'token' | 'api'
  /** 总开关;false 时不注册任何路由/闸门/命令。 */
  enabled: boolean
  /** 局域网直连免鉴权(私网来源且无 Cloudflare 隧道头时放行;隧道流量始终鉴权)。 */
  lanBypass: boolean
}

export const Config: z<Config> = z.object({
  sessionTtlMs: z.natural().required(),
  cookieName: z.string().required(),
  sessionSecretRef: z.string().required(),
  domain: z.string().default(''),
  localPort: z.natural().max(65535).default(3080),
  cloudflareApiTokenRef: z.string().default('CLOUDFLARE_API_TOKEN'),
  tunnelTokenRef: z.string().default('CLOUDFLARE_TUNNEL_TOKEN'),
  tunnelProvider: z.union([z.const('token'), z.const('api')]).default('token'),
  enabled: z.boolean().default(true),
  lanBypass: z.boolean().default(false),
})

/**
 * 组装鉴权与隧道;鉴权始终启用,隧道在 domain 非空时启用。
 * @param ctx - Cordis 上下文。
 * @param config - 已验证配置。
 * @returns 装配完成(领域打开、路由/闸门/命令注册、隧道启动)后 resolve。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.enabled) return
  const webServer = ctx.webServer

  // 1. 打开领域;释放时关闭(失败记录,不留 unhandled rejection)。
  const domain = await ctx.storageDomain.open(remoteAccessDomain)
  ctx.effect(() => () => { domain.close().catch((error: unknown) => { ctx.logger.warn('remote-access: 关闭领域失败: %s', String(error)) }) })

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

  // 3. token 不再自动铸造:局域网(lanBypass)下用 `/token create` 按需创建;
  //    若无任何 token 且 lanBypass 关闭,登录将不可用,须在可信环境先建 token。
  const tokens = domain.table('tokens')

  // 4. 注册闸门 + 登录路由 + /token 命令。
  ctx.effect(() => webServer.setRequestGate(createRequestGate({
    secret, cookieName: config.cookieName, now: Date.now, lanBypass: config.lanBypass,
    isRevoked: (tokenId, issuedAt) => {
      const rec = tokens.get(tokenId as TokenId)
      return rec !== undefined && rec.revokedAt !== null && rec.revokedAt > issuedAt
    },
  })))
  ctx.effect(() => registerLoginRoutes(webServer, {
    domain, secret, cookieName: config.cookieName, sessionTtlMs: config.sessionTtlMs, now: Date.now,
    warn: (message) => { ctx.logger.warn('%s', message) },
  }))
  ctx.effect(() => ctx.commands.register(registerTokenCommand({
    domain, now: Date.now, log: (message) => { console.log(message) },
  })))

  // 5. 隧道(可选):domain 非空时按所选 provider 启动,释放时结束子进程。
  if (config.domain !== '') {
    // 按配置解析所选 provider 需要的凭证。
    const ref = config.tunnelProvider === 'token'
      ? config.tunnelTokenRef
      : config.cloudflareApiTokenRef
    const credential = await ctx.credentials.resolve(credentialRef(ref))
    if (credential === undefined) {
      ctx.logger.warn('remote-access: 未配置 %s,跳过隧道', ref)
      return
    }
    // 构造对应 provider,注册进注册表,并以其建立隧道。
    const registry = new TunnelRegistry()
    ctx.provide('tunnel', registry)
    const provider = config.tunnelProvider === 'token'
      ? new TokenTunnelProvider(ctx, credential.value)
      : new ApiTunnelProvider(ctx, credential.value)
    ctx.effect(() => registry.register(config.tunnelProvider, provider))
    const running = provider.establish({ domain: config.domain, localPort: config.localPort })
    ctx.effect(() => {
      running
        .then(({ url }) => { console.log(`remote-access: 公网地址 ${url}`) })
        .catch((error: unknown) => { ctx.logger.warn('remote-access: 隧道建立失败: %s', String(error)) })
      return () => { void running.then(({ child }) => child.kill(), () => {}) }
    })
  }
}
