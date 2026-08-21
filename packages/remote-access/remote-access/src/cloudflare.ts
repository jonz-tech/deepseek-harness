/**
 * Cloudflare REST 客户端:建隧道 + 绑 DNS。
 * @module @deepseek-ai/dsh-remote-access/src/cloudflare
 */

import { randomBytes } from 'node:crypto'

const API_BASE = 'https://api.cloudflare.com/client/v4'

/**
 * Cloudflare API 错误:携带请求与响应上下文,便于失败时响亮诊断。
 */
export class CloudflareError extends Error {
  /**
   * @param message - 含请求方法与路径、状态码和响应体的说明。
   * @param status - HTTP 状态码。
   * @param body - 原始响应体文本。
   */
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
  }
}

/**
 * 一个带 Bearer token 的最小 fetch 封装;非 2xx 抛 {@link CloudflareError}。
 * @param token - Cloudflare API token。
 * @param path - API 路径(以 `/` 开头,相对 {@link API_BASE})。
 * @param init - 追加到 fetch 的请求选项;header 会合并到 Authorization/Content-Type。
 * @returns 解析后的 JSON 响应体;空响应体返回 undefined。
 */
async function cfFetch(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new CloudflareError(`Cloudflare ${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`, res.status, text)
  }
  return text.length > 0 ? JSON.parse(text) as unknown : undefined
}

/**
 * 带重试的调用;每次重试前告警,耗尽后抛最后一次错误。
 * @param token - Cloudflare API token。
 * @param path - API 路径。
 * @param init - 请求选项。
 * @param retries - 初试之外的重试次数,默认 2。
 * @returns 与 {@link cfFetch} 相同。
 */
async function cfWithRetry(token: string, path: string, init: RequestInit = {}, retries = 2): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await cfFetch(token, path, init)
    } catch (error) {
      if (attempt >= retries) throw error
      console.warn(`Cloudflare 请求重试(${attempt + 1}/${retries})`, { path, method: init.method ?? 'GET', error })
    }
  }
}

interface ZoneResult { result: Array<{ id: string; name: string; account: { id: string } }> }
interface TunnelResult { result: { id: string; token: string } }

/**
 * 通过域名反查 zone 与 account id;未命中抛错。
 * @param token - Cloudflare API token。
 * @param domain - 公网域名。
 * @returns zone 与 account 的 id。
 */
async function resolveZone(token: string, domain: string): Promise<{ zoneId: string; accountId: string }> {
  const body = await cfWithRetry(token, `/zones?name=${encodeURIComponent(domain)}`) as ZoneResult
  const zone = body.result[0]
  if (zone === undefined) throw new Error(`Cloudflare zone not found for '${domain}'`)
  return { zoneId: zone.id, accountId: zone.account.id }
}

/**
 * 建隧道并绑 DNS;返回 tunnel id 与 token。
 * @param token - Cloudflare API token。
 * @param domain - 公网域名。
 * @returns 新建隧道的 id 与连接 token。
 */
export async function createTunnel(token: string, domain: string): Promise<{ tunnelId: string; tunnelToken: string }> {
  const { zoneId, accountId } = await resolveZone(token, domain)
  const tunnel = await cfWithRetry(token, `/accounts/${accountId}/cfd_tunnel`, {
    method: 'POST',
    body: JSON.stringify({ name: 'dsh-remote-access', tunnel_secret: randomBytes(32).toString('base64') }),
  }) as TunnelResult
  await cfWithRetry(token, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name: domain.split('.')[0],
      content: `${tunnel.result.id}.cfargotunnel.com`,
      proxied: true,
    }),
  })
  return { tunnelId: tunnel.result.id, tunnelToken: tunnel.result.token }
}
