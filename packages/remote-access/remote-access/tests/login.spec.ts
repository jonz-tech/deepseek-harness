/**
 * REAL-composition coverage: a test-only cordis.yml booted through the vendored
 * Loader mounts the full dependency chain (storage hub + json backend + domain
 * form + local credentials + commands + webserver) and the remote-access
 * plugin. Every assertion observes the user-visible HTTP surface: unauthenticated
 * access redirects to the login form, a wrong token is rejected 401, and a
 * pre-seeded token signs a secure session cookie that unlocks the gate and
 * writes an access-log entry carrying the token's name.
 */

import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as remoteAccess from '../src/index.ts'
import { hashToken } from '../src/hash.ts'

/** 预置进存储的已知明文 token(插件不再自动铸造初始 token)。 */
const PRESEEDED_TOKEN = 'test-login-token'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Write a cordis.yml for the full chain, pre-seed one token record into the
 * json storage unit, boot everything through the real Loader, and return the
 * context.
 */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-remote-access-loader-'))
  const storageRoot = join(root, 'storage')
  // 预置 token:按 storage-json 的 on-disk 格式直接写 unit 文件。
  await mkdir(storageRoot, { recursive: true })
  await writeFile(join(storageRoot, 'remote_access.json'), JSON.stringify({
    unit: { name: 'remote_access', version: 0 },
    global: null,
    tables: {
      tokens: {
        '11111111-1111-4111-8111-111111111111': {
          name: 'pre-seeded',
          hash: hashToken(PRESEEDED_TOKEN),
          createdAt: 1000,
          lastUsedAt: null,
          revokedAt: null,
        },
      },
      access: {},
    },
  }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(storageRoot)}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-remote-access'",
    '  config:',
    '    sessionTtlMs: 3600000',
    '    cookieName: dsh_session',
    '    sessionSecretRef: REMOTE_ACCESS_SESSION_SECRET',
    "    domain: ''",
    '    enabled: true',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-credentials', CredentialProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-remote-access', remoteAccess],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>

  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const unloaded = [...context.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return context
}

/** Issue one HTTP request; returns status, full body, and headers (no redirect following). */
async function request(port: number, path: string, init?: RequestInit):
Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    ...init,
    redirect: 'manual' as RequestRedirect,
  })
  return { status: response.status, body: await response.text(), headers: response.headers }
}

describe('real Loader composition: remote-access login gate', () => {
  it('redirects, serves the login form, rejects a wrong token, and accepts the pre-seeded token', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port
    expect(port).toBeGreaterThan(0)

    // 1. 未登录访问非公开路径 -> 302 到 /auth/login。
    const gated = await request(port, '/')
    expect(gated.status).toBe(302)
    expect(gated.headers.get('location')).toBe('/auth/login')

    // 2. 登录页为公开路径 -> 200 + 表单 HTML。
    const loginPage = await request(port, '/auth/login')
    expect(loginPage.status).toBe(200)
    expect(loginPage.body).toContain('action="/auth/login"')

    // 3. 错误 token -> 401。
    const wrong = await request(port, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=definitely-wrong',
    })
    expect(wrong.status).toBe(401)

    // 4. 正确 token -> 302 + HttpOnly/Secure cookie + Location /。
    const login = await request(port, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(PRESEEDED_TOKEN)}`,
    })
    expect(login.status).toBe(302)
    expect(login.headers.get('location')).toBe('/')
    const setCookie = login.headers.get('set-cookie')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const cookieValue = setCookie?.split(';')[0] ?? ''

    // 5. 会话 cookie 通过闸门:携带 cookie 的请求不再被重定向(无路由路径返回 404 而非 302)。
    const authed = await request(port, '/no/such/route', { headers: { Cookie: cookieValue } })
    expect(authed.status).toBe(404)
    const stillGated = await request(port, '/no/such/route')
    expect(stillGated.status).toBe(302)

    // 6. 登录写入 access-log(异步落盘,短轮询等待),且记录携带 token 的 name。
    const accessFile = join(root!, 'storage', 'remote_access.json')
    let entries: Array<{ tokenId: string; name?: string }> = []
    for (let i = 0; i < 50 && entries.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const stored = JSON.parse(await readFile(accessFile, 'utf8')) as {
        tables: { access: Record<string, { tokenId: string; name?: string }> }
      }
      entries = Object.values(stored.tables.access)
    }
    expect(entries.length).toBe(1)
    expect(entries[0]!.name).toBe('pre-seeded')
  })
})
