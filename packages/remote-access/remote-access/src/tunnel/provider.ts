/**
 * 隧道能力缝:Service 定义 + 按名注册的 provider 注册表。
 * @module @deepseek-ai/dsh-remote-access/src/tunnel/provider
 */

import { Service } from '@deepseek-ai/cordis'
import type { ChildProcess } from 'node:child_process'

/** 建立隧道所需的上下文(公网域名与本地回源端口)。 */
export interface TunnelContext {
  domain: string
  localPort: number
}

/** 建立隧道后的句柄:已启动的 cloudflared 子进程与公网 URL。 */
export interface TunnelHandle {
  child: ChildProcess
  url: string
}

/**
 * 隧道 provider:把本机 dsh 通过一条 Cloudflare 隧道暴露到公网。
 * 实现决定隧道如何建立/认证(token 复用 vs API 自动创建),消费方只认这个接口。
 */
export abstract class TunnelProvider extends Service {
  /** 建立隧道并返回子进程句柄与公网 URL。 */
  abstract establish(context: TunnelContext): Promise<TunnelHandle>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tunnel: TunnelRegistry
  }
}

/** 隧道 provider 注册表:按名注册与解析,供配置按后端名选择。 */
export class TunnelRegistry {
  private readonly providers = new Map<string, TunnelProvider>()

  /**
   * 注册一个 provider;重名抛错(组合级契约)。
   * @param name - provider 名(`token` / `api`)。
   * @param provider - 实现。
   * @returns 移除该注册的 disposer。
   */
  register(name: string, provider: TunnelProvider): () => void {
    if (this.providers.has(name)) {
      throw new Error(`tunnel: provider "${name}" already registered`)
    }
    this.providers.set(name, provider)
    return () => { this.providers.delete(name) }
  }

  /**
   * 按名解析 provider。
   * @param name - provider 名。
   * @returns provider,未注册时为 `undefined`。
   */
  get(name: string): TunnelProvider | undefined {
    return this.providers.get(name)
  }
}
