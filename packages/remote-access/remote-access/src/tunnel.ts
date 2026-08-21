/**
 * 隧道编排:建隧道 → 下载/启动 cloudflared → 返回公网 URL。
 * @module @deepseek-ai/dsh-remote-access/src/tunnel
 */

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createTunnel } from './cloudflare.ts'
import { downloadCloudflared, runCloudflared } from './cloudflared.ts'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

export interface TunnelDeps {
  apiToken: string
  domain: string
  localPort: number
  now: () => number
}

/** 建立隧道;返回公网 URL 与子进程句柄。 */
export async function establishTunnel(deps: TunnelDeps): Promise<{ url: string; child: ChildProcess }> {
  const dataDir = join(resolveDshHome(), 'cloudflared')
  const { tunnelToken } = await createTunnel(deps.apiToken, deps.domain)
  const binary = await downloadCloudflared(dataDir)
  const child = await runCloudflared(binary, tunnelToken, deps.domain, deps.localPort, dataDir)
  return { url: `https://${deps.domain}`, child }
}
