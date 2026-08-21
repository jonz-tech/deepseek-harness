/**
 * REAL-composition coverage: a test-only cordis.yml booted through the vendored
 * Loader mounts the full dependency chain (storage hub + json backend + domain
 * form + local credentials + commands + webserver) and the remote-access
 * plugin. Every assertion observes the user-visible HTTP surface: unauthenticated
 * access redirects to the login form, a wrong token is rejected 401, and the
 * minted initial token signs a secure session cookie that unlocks the gate.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

/** Token the plugin mints on first boot and emits via the logger. */
let mintedToken: string | undefined

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  mintedToken = undefined
})

/**
 * Intercept the plugin's initial-token log line before the composition
 * activates, capturing the minted plaintext token for the login assertion.
 */
function captureInitialToken(ctx: Context): void {
  const info = ctx.logger.info.bind(ctx.logger)
  ;(ctx.logger as unknown as { info: (...args: unknown[]) => unknown }).info = ((...args: unknown[]) => {
    if (typeof args[0] === 'string' && (args[0] as string).includes('初始访问 token')) {
      mintedToken = String(args[1])
    }
    return info(...args)
  })
}

/** Write a cordis.yml for the full chain, boot it through the real Loader, and return the context. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-remote-access-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
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

  captureInitialToken(context)
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
  it('redirects, serves the login form, rejects a wrong token, and accepts the minted token', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    expect(mintedToken).toBeDefined()
    const port = (loaded.webServer as WebServer).port
    expect(port).toBeGreaterThan(0)

    // 1. 未登录访问非公开路径 → 302 到 /auth/login。
    const gated = await request(port, '/')
    expect(gated.status).toBe(302)
    expect(gated.headers.get('location')).toBe('/auth/login')

    // 2. 登录页为公开路径 → 200 + 表单 HTML。
    const loginPage = await request(port, '/auth/login')
    expect(loginPage.status).toBe(200)
    expect(loginPage.body).toContain('action="/auth/login"')

    // 3. 错误 token → 401。
    const wrong = await request(port, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=definitely-wrong',
    })
    expect(wrong.status).toBe(401)

    // 4. 正确 token → 302 + HttpOnly/Secure cookie + Location /。
    const login = await request(port, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(mintedToken as string)}`,
    })
    expect(login.status).toBe(302)
    expect(login.headers.get('location')).toBe('/')
    const setCookie = login.headers.get('set-cookie')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    const cookieValue = setCookie?.split(';')[0] ?? ''

    // 5. 会话 cookie 通过闸门:携带 cookie 的请求不再被重定向(无路由路径返回 404 而非 302)。
    const authed = await request(port, '/no/such/route', { headers: { Cookie: cookieValue } })
    expect(authed.status).toBe(404)
    const stillGated = await request(port, '/no/such/route')
    expect(stillGated.status).toBe(302)
  })
})
