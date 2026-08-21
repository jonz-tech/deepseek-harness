import { describe, expect, it } from 'vitest'
import { registerTokenCommand } from '../src/command.ts'
import { verifyToken } from '../src/hash.ts'
import type { TokenRecord } from '../src/domain.ts'

function fakeDeps() {
  const store = new Map<string, TokenRecord>()
  const domain = {
    table: () => ({
      put: async (k: string, v: TokenRecord) => { store.set(k, v) },
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
  it('creates a hashed token and prints the plaintext once', async () => {
    const { domain, store } = fakeDeps()
    const cmd = registerTokenCommand({ domain, now: () => 1000 })
    const result = await cmd.handler({ rawInput: 'create --name 家里', commandId: 'c' as never, agent: {} as never, signal: new AbortController().signal })
    expect(result.kind).toBe('success')
    const plain = (result as { text: string }).text.split('\n')[1]
    const [rec] = store.values()
    expect(rec.hash).not.toContain(plain)
    expect(verifyToken(plain, rec.hash)).toBe(true)
  })

  it('revokes by id', async () => {
    const { domain, store } = fakeDeps()
    const cmd = registerTokenCommand({ domain, now: () => 1000 })
    await cmd.handler({ rawInput: 'create', commandId: 'c' as never, agent: {} as never, signal: new AbortController().signal })
    const id = [...store.keys()][0]!
    const result = await cmd.handler({ rawInput: `revoke ${id}`, commandId: 'c' as never, agent: {} as never, signal: new AbortController().signal })
    expect(result.kind).toBe('success')
    expect(store.get(id)!.revokedAt).toBe(1000)
  })
})
