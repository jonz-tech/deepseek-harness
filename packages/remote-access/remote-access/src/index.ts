/**
 * 远程访问与账号登录插件:可管理的多 token 登录鉴权 + Cloudflare Tunnel 内网穿透。
 * @module @deepseek-ai/dsh-remote-access
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

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
export function apply(_ctx: Context, _config: Config): Promise<void> {
  // 鉴权/隧道装配在 Task 9 填充;此处为骨架。
  return Promise.resolve()
}
