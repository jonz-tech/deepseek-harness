/**
 * 隧道 provider(token):复用云端托管隧道(dashboard 已配 Public Hostname 路由),
 * 用 run token 连接,无需 Cloudflare API token,也不新建隧道/DNS。
 * @module @deepseek-ai/dsh-remote-access/src/tunnel/token-provider
 */

import { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { TunnelProvider, type TunnelContext, type TunnelHandle } from './provider.ts'
import { downloadCloudflared, runCloudflared } from '../cloudflared.ts'

/** `token` 隧道 provider。 */
export class TokenTunnelProvider extends TunnelProvider {
  constructor(ctx: Context, private readonly tunnelToken: string) {
    super(ctx, 'token')
  }

  /** 下载并启动 cloudflared,连接已有隧道;URL 由 dashboard 路由决定。 */
  async establish(context: TunnelContext): Promise<TunnelHandle> {
    const dataDir = join(resolveDshHome(), 'cloudflared')
    const binary = await downloadCloudflared(dataDir)
    const child = await runCloudflared(binary, this.tunnelToken)
    return { child, url: `https://${context.domain}` }
  }
}
