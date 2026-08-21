/**
 * token 的生成与 scrypt 哈希。只存哈希,不存明文。
 * @module @deepseek-ai/dsh-remote-access/src/hash
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** 生成一个 URL-safe 的随机 token。 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 生成 token 的自包含 scrypt 哈希,格式 `salt:hash`(base64)。 */
export function hashToken(token: string): string {
  const salt = randomBytes(16).toString('base64')
  const hash = scryptSync(token, salt, 32).toString('base64')
  return `${salt}:${hash}`
}

/** 校验 token 是否匹配存储的哈希;格式非法返回 false。 */
export function verifyToken(token: string, stored: string): boolean {
  const sep = stored.indexOf(':')
  if (sep === -1) return false
  const salt = stored.slice(0, sep)
  const hash = stored.slice(sep + 1)
  const candidate = scryptSync(token, salt, 32)
  const expected = Buffer.from(hash, 'base64')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
