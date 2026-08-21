/**
 * 包级 invariant companion(`@deepseek-ai/dsh-remote-access/invariant`)。
 * @module @deepseek-ai/dsh-remote-access/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-remote-access'

/** Cordis companion plugin 名。 */
export const name = 'remote-access-invariant'
/** 保留包所有权前所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant:本包无独立事件流或可比较的公开可变关系;鉴权状态
 * 由 storage-domain 与 credentials 承载,归属各自的 invariant。
 */
const install: InvariantInstaller = () => {}

/**
 * 注册本包的 invariant companion。
 * @param ctx - 携带 invariant 服务的 Cordis 上下文。
 * @returns 安装成功后注册的 disposer。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
