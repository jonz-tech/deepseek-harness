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
  /** 服务端日志回写(明文 token 走这里,绝不进会话日志)。 */
  log: (message: string) => void
}

/** 注册 `/token` 命令。 */
export function registerTokenCommand(deps: TokenCommandDeps): CommandDefinition {
  const tokens = deps.domain.table('tokens')

  return {
    name: 'token',
    description: '管理远程访问 token(create / list / revoke)',
    // 声明 input 使 web 客户端按 leadingInput 认领带参数的调用;
    // 无此声明时带参行会被当作普通消息发给模型。
    input: { hint: 'create [名称] | list | revoke <id>' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const [verb, ...rest] = invocation.rawInput.trim().split(/\s+/)
      switch (verb) {
        case 'create': {
          // 剥离字面 `--name` 前缀(否则会作为名称文本残留)。
          const args = rest.filter(a => a !== '--name')
          const name = args.join(' ') || 'unnamed'
          const id = randomUUID() as TokenId
          const plain = generateToken()
          const record: TokenRecord = {
            name,
            hash: hashToken(plain),
            createdAt: deps.now(),
            lastUsedAt: null,
            revokedAt: null,
          }
          deps.log(`remote-access: 新 token(仅显示这一次): ${plain}`)
          // 同名覆盖:删除同名旧记录,旧明文随之作废。
          const staleIds = [...tokens.entries()]
            .filter(([, rec]) => rec.name === name)
            .map(([staleId]) => staleId)
          await Promise.all(staleIds.map(staleId => tokens.delete(staleId)))
          return tokens.put(id, record).then(() => ({
            kind: 'success' as const,
            text: `token 已创建(明文见服务端日志,仅显示一次)\nid: ${id}\n名称: ${name}${staleIds.length > 0 ? '\n(已覆盖同名的旧 token,旧明文作废)' : ''}`,
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
          if (tokens.get(id as TokenId) === undefined) return { kind: 'error', text: `未找到 token ${id}` }
          await tokens.update(id as TokenId, rec => ({ ...rec, revokedAt: deps.now() }))
          return { kind: 'success' as const, text: `已吊销 ${id}` }
        }
        default:
          return { kind: 'error', text: '用法: /token create --name X | /token list | /token revoke <id>' }
      }
    },
  }
}
