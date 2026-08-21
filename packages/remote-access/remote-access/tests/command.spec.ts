import { describe, expect, it } from 'vitest'
import { registerTokenCommand } from '../src/command.ts'
import { verifyToken } from '../src/hash.ts'
import type { TokenRecord } from '../src/domain.ts'

function fakeDeps() {
  const store = new Map<string, TokenRecord>()
  const domain = {
    table: () => ({
      put: async (k: string, v: TokenRecord) => { store.set(k, v) },
      get: (k: string) => store.get(k),
      entries: () => store.entries(),
      update: async (k: string, fn: (cur: TokenRecord) => TokenRecord) => {
        const cur = store.get(k)
        if (cur === undefined) throw new Error('missing')
        const next = fn(cur)
        store.set(k, next)
        return next
      },
    }),
  } as never
  return { domain, store }
}

describe('token command', () => {
  it('creates a hashed token and logs the plaintext once', async () => {
    const logged: string[] = []
    const { domain, store } = fakeDeps()
    const cmd = registerTokenCommand({ domain, now: () => 1000, log: m => logged.push(m) })
    const result = await cmd.handler({ rawInput: 'create --name 家里', commandId: 'c' as never, agent: {} as never, attachments: [], signal: new AbortController().signal })
    expect(result.kind).toBe('success')
    const [rec] = store.values()
    expect(rec).toBeDefined()
    expect(rec!.hash).not.toContain(logged[0]!)
    expect(verifyToken(logged[0]!.split(': ')[2]!, rec!.hash)).toBe(true)
    expect((result as { text: string }).text).not.toContain(logged[0]!)
  })

  it('revokes by id', async () => {
    const { domain, store } = fakeDeps()
    const cmd = registerTokenCommand({ domain, now: () => 1000, log: () => {} })
    await cmd.handler({ rawInput: 'create', commandId: 'c' as never, agent: {} as never, attachments: [], signal: new AbortController().signal })
    const id = [...store.keys()][0]!
    const result = await cmd.handler({ rawInput: `revoke ${id}`, commandId: 'c' as never, agent: {} as never, attachments: [], signal: new AbortController().signal })
    expect(result.kind).toBe('success')
    expect(store.get(id)!.revokedAt).toBe(1000)
  })
})
