/**
 * `/token` 命令:token 的生成、列出、吊销。
 * @module @deepseek-ai/dsh-remote-access/src/command
 */

import { randomUUID } from 'node:crypto'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { remoteAccessDomain } from './domain.ts'
import type { TokenId, TokenRecord } from './domain.ts'
import { generateToken, hashToken } from './hash.ts'

/** 命令所需的外部句柄。 */
export interface TokenCommandDeps {
  domain: Domain<typeof remoteAccessDomain>
  now: () => number
}

/** 注册 `/token` 命令。 */
export function registerTokenCommand(deps: TokenCommandDeps): CommandDefinition {
  const tokens = deps.domain.table('tokens')

  return {
    name: 'token',
    description: '管理远程访问 token(create / list / revoke)',
    recordInput: false,
    handler: (invocation): CommandResult | Promise<CommandResult> => {
      const [verb, ...rest] = invocation.rawInput.trim().split(/\s+/)
      switch (verb) {
        case 'create': {
          const name = rest.join(' ') || 'unnamed'
          const id = randomUUID() as TokenId
          const plain = generateToken()
          const record: TokenRecord = {
            name,
            hash: hashToken(plain),
            createdAt: deps.now(),
            lastUsedAt: null,
            revokedAt: null,
          }
          return tokens.put(id, record).then(() => ({
            kind: 'success' as const,
            text: `token 已创建(仅显示这一次):\n${plain}\nid: ${id}\n名称: ${name}`,
          }))
        }
        case 'list': {
          const rows = [...tokens.entries()].map(([id, rec]) =>
            `${rec.revokedAt !== null ? '(已吊销) ' : ''}${id}  ${rec.name}  最后使用: ${rec.lastUsedAt ?? '-'}`)
          return { kind: 'success', text: rows.length > 0 ? rows.join('\n') : '(无 token)' }
        }
        case 'revoke': {
          const id = rest[0]
          if (id === undefined) return { kind: 'error', text: '用法: /token revoke <id>' }
          return tokens.update(id as TokenId, rec => ({ ...rec, revokedAt: deps.now() }))
            .then(() => ({ kind: 'success' as const, text: `已吊销 ${id}` }))
            .catch(() => ({ kind: 'error' as const, text: `未找到 token ${id}` }))
        }
        default:
          return { kind: 'error', text: '用法: /token create --name X | /token list | /token revoke <id>' }
      }
    },
  }
}
