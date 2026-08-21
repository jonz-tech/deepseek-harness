/**
 * 隧道 provider(api):走 Cloudflare REST API 自动建隧道 + 绑 DNS,
 * 需要 `CLOUDFLARE_API_TOKEN`;隧道由本地 ingress 配置驱动。
 * @module @deepseek-ai/dsh-remote-access/src/tunnel/api-provider
 */

import { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { TunnelProvider, type TunnelContext, type TunnelHandle } from './provider.ts'
import { downloadCloudflared, runCloudflared } from '../cloudflared.ts'
import { createTunnel } from '../cloudflare.ts'

/** `api` 隧道 provider。 */
export class ApiTunnelProvider extends TunnelProvider {
  constructor(ctx: Context, private readonly apiToken: string) {
    super(ctx, 'api')
  }

  /** 通过 API 建隧道并绑 DNS,写本地 ingress 配置后启动 cloudflared。 */
  async establish(context: TunnelContext): Promise<TunnelHandle> {
    const dataDir = join(resolveDshHome(), 'cloudflared')
    const { tunnelToken } = await createTunnel(this.apiToken, context.domain)
    const binary = await downloadCloudflared(dataDir)
    const child = await runCloudflared(binary, tunnelToken, {
      domain: context.domain,
      localPort: context.localPort,
      configDir: dataDir,
    })
    return { child, url: `https://${context.domain}` }
  }
}
