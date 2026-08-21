/**
 * cloudflared 二进制的定位/下载与子进程托管。
 * @module @deepseek-ai/dsh-remote-access/src/cloudflared
 */

import { access, chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** GitHub release 资产名映射。darwin 资产是 `.tgz`,linux 资产为裸二进制。 */
const RELEASE_ASSET: Record<string, Record<string, string>> = {
  darwin: { arm64: 'cloudflared-darwin-arm64.tgz', x64: 'cloudflared-darwin-amd64.tgz' },
  linux: { arm64: 'cloudflared-linux-arm64', x64: 'cloudflared-linux-amd64' },
}

/** 以系统 `tar` 解包 .tgz,提取 `./cloudflared` 到数据目录。 */
const extractTgz = promisify(execFile)

/** 平台 + 架构 → 下载 URL。 */
export function cloudflaredDownloadUrl(platform: string, arch: string): string {
  const asset = RELEASE_ASSET[platform]?.[arch]
  if (asset === undefined) throw new Error(`cloudflared: unsupported platform ${platform}/${arch}`)
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`
}

/** 数据目录下的二进制路径。 */
export function cloudflaredBinaryPath(dataDir: string): string {
  return join(dataDir, 'cloudflared')
}

/**
 * 下载 cloudflared 到数据目录并置为可执行;已存在则跳过。
 *
 * darwin 资产是 `.tgz`,落到临时文件后用系统 `tar` 解出 `./cloudflared`;
 * linux 资产为裸二进制,字节直写。两者随后 `chmod 0o755`。
 * @param dataDir - 存放二进制的数据目录(已存在的二进制视为已下载)。
 * @param platform - 目标平台,默认当前 `process.platform`。
 * @param arch - 目标架构,默认当前 `process.arch`。
 * @returns 二进制绝对路径。
 */
export async function downloadCloudflared(
  dataDir: string,
  platform = process.platform,
  arch = process.arch,
): Promise<string> {
  const binary = cloudflaredBinaryPath(dataDir)
  await mkdir(dataDir, { recursive: true })
  // 已存在则视为已下载(不做校验和,pre-release 立场)。
  // TODO: 校验二进制可执行,失败时删除重下。
  if (await fileExists(binary)) return binary
  const url = cloudflaredDownloadUrl(platform, arch)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`cloudflared: download ${url} → ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (platform === 'darwin') {
    const tgzPath = join(dataDir, 'cloudflared.tgz')
    await writeFile(tgzPath, bytes)
    await extractTgz('tar', ['-xzf', tgzPath, '-C', dataDir])
    await rm(tgzPath, { force: true })
  } else if (platform === 'linux') {
    await writeFile(binary, bytes)
  } else {
    throw new Error(`cloudflared: unsupported platform ${platform}/${arch}`)
  }
  await chmod(binary, 0o755)
  return binary
}

/** 判断文件是否存在。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    // 仅 ENOENT 表示"不存在";其余错误(如 EACCES)需向上抛,不能静默当不存在。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * 生成 ingress 配置并启动 cloudflared 子进程。
 * @param binary - cloudflared 二进制路径。
 * @param tunnelToken - Cloudflare 隧道连接 token。
 * @param domain - 回源公网域名。
 * @param localPort - 本地回源端口。
 * @param configDir - 存放生成配置的目录。
 * @returns 已启动的 cloudflared 子进程。
 */
export async function runCloudflared(
  binary: string,
  tunnelToken: string,
  domain: string,
  localPort: number,
  configDir: string,
): Promise<ChildProcess> {
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, 'config.yml')
  await writeFile(configPath, [
    'ingress:',
    `  - hostname: ${domain}`,
    `    service: http://127.0.0.1:${String(localPort)}`,
    '  - service: http_status:404',
    '',
  ].join('\n'))
  const child = spawn(binary, ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken, '--config', configPath], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return child
}
