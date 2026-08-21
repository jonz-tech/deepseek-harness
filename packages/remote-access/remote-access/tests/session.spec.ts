import { describe, expect, it } from 'vitest'
import { signSession, verifySession, sessionExpired } from '../src/session.ts'

const secret = 'test-secret'

describe('session signing', () => {
  it('round-trips a signed session', () => {
    const session = { sid: 's1', issuedAt: 1000, expiresAt: 2000 }
    const cookie = signSession(secret, session)
    expect(verifySession(secret, cookie)).toEqual(session)
  })

  it('rejects a tampered cookie or wrong secret', () => {
    const cookie = signSession(secret, { sid: 's1', issuedAt: 1000, expiresAt: 2000 })
    expect(verifySession('other-secret', cookie)).toBeUndefined()
    expect(verifySession(secret, cookie + 'x')).toBeUndefined()
    expect(verifySession(secret, 'garbage')).toBeUndefined()
  })

  it('flags expired sessions', () => {
    const session = { sid: 's1', issuedAt: 1000, expiresAt: 2000 }
    expect(sessionExpired(session, 1999)).toBe(false)
    expect(sessionExpired(session, 2000)).toBe(true)
  })
})
