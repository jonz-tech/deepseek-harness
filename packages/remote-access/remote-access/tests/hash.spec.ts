import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, verifyToken } from '../src/hash.ts'

describe('token hashing', () => {
  it('hashes and verifies a token without storing plaintext', () => {
    const token = generateToken()
    const stored = hashToken(token)
    expect(stored).not.toContain(token)
    expect(verifyToken(token, stored)).toBe(true)
  })

  it('rejects a wrong token and malformed hashes', () => {
    const stored = hashToken(generateToken())
    expect(verifyToken('wrong', stored)).toBe(false)
    expect(verifyToken('x', 'not-a-hash')).toBe(false)
  })

  it('mints distinct tokens', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})
