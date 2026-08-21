/**
 * 远程访问领域:token 表与访问日志表。
 * @module @deepseek-ai/dsh-remote-access/src/domain
 */

import z from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** 品牌化的 token id。 */
export type TokenId = Branded<'RemoteAccessToken'>

/** token 表记录:哈希、元数据、吊销标记。 */
export const tokenSchema = z.object({
  name: z.string().min(1),
  hash: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
  revokedAt: z.number().int().nonnegative().nullable(),
})

/** 访问日志记录:哪个 token、何时、哪台设备。`name` 为可选以兼容历史记录(带 name 前)。 */
export const accessSchema = z.object({
  tokenId: z.string().min(1),
  at: z.number().int().nonnegative(),
  ip: z.string(),
  userAgent: z.string(),
  name: z.string().optional(),
})

export type TokenRecord = z.infer<typeof tokenSchema>
export type AccessRecord = z.infer<typeof accessSchema>

export const remoteAccessDomain = defineDomain({
  name: 'remote_access',
  version: 0,
  tables: {
    tokens: domainTable<TokenId, TokenRecord>(tokenSchema),
    access: domainTable<string, AccessRecord>(accessSchema),
  },
})
