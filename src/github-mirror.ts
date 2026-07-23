/**
 * GitHub 镜像加速模块
 *
 * 国内访问 github.com / api.github.com 经常超时。
 * 本模块维护一组镜像站，对所有请求做"竞速择优"：
 *   - 同时向多个镜像发起请求，第一个成功的结果即采用，其余自动 abort。
 *   - API 请求和文件下载分别处理。
 *
 * 镜像站说明：
 *   - ghproxy / mirror.ghproxy  → 代理 github.com 下载链接
 *   - kkgithub → GitHub API 代理
 *   - gh-proxy → 通用代理
 *
 * 注意：镜像站可能随时变动，MIRRORS 列表可按需增删。
 */

import { logger } from './logger'

// ---------------------------------------------------------------------------
// 镜像配置
// ---------------------------------------------------------------------------

/** GitHub API 镜像（替换 https://api.github.com） */
const API_MIRRORS: string[] = [
  'https://api.github.com',           // 官方直连（优先尝试）
  'https://kkgithub.com/api',         // kkgithub API 代理
  'https://gh.api.99988866.xyz/https://api.github.com', // 99988866 代理
]

/** GitHub 下载镜像（替换 https://github.com 的下载链接前缀） */
const DOWNLOAD_MIRRORS: string[] = [
  '',  // 空字符串 = 官方直连（优先尝试）
  'https://ghproxy.net',
  'https://mirror.ghproxy.com',
  'https://gh-proxy.com',
  'https://ghfast.top',
]

// ---------------------------------------------------------------------------
// 竞速 fetch
// ---------------------------------------------------------------------------

/**
 * 对同一个 URL 用多个镜像前缀同时发起请求，取第一个成功的。
 * 每个请求使用独立的 AbortController，赢家不会被输家的 abort 影响。
 * 返回 { response, mirror, abortOthers } —— 调用方在 body 读取完成后调用 abortOthers()。
 * 或在全部失败时 throw。
 */
async function raceFetch(
  urls: string[],
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<{ response: Response; mirror: string; abortOthers: () => void }> {
  // 每个请求一个独立 controller
  const controllers = urls.map(() => new AbortController())

  // 全局超时：到时间全部 abort
  const timeout = setTimeout(() => {
    controllers.forEach(c => c.abort())
  }, timeoutMs)

  const tasks = urls.map(async (url, i) => {
    const res = await fetch(url, { ...init, signal: controllers[i].signal })
    if (!res.ok) throw new Error(`${label} HTTP ${res.status} ${res.statusText} @ ${url}`)
    return { response: res, mirror: url, index: i }
  })

  try {
    const winner = await Promise.any(tasks)
    logger.info(`[github-mirror] ${label} 成功 via ${winner.mirror}`)

    // 返回赢家，同时提供 abortOthers 来中断输家
    const abortOthers = () => {
      controllers.forEach((c, i) => {
        if (i !== winner.index) c.abort()
      })
    }

    return { response: winner.response, mirror: winner.mirror, abortOthers }
  } catch (aggregate) {
    const errors = (aggregate as AggregateError)?.errors?.map((e: Error) => e.message) ?? []
    throw new Error(`${label} 全部镜像失败: ${errors.join(' | ')}`)
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/**
 * 调用 GitHub API（自动尝试镜像）。
 * @param apiPath 例如 "/repos/SnowLuma/SnowLuma/releases/latest"
 * @returns parsed JSON
 */
export async function githubApiGet<T>(apiPath: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<T> {
  const urls = API_MIRRORS.map((base) => `${base}${apiPath}`)
  const init: RequestInit = {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'SnowLuma-Tray/1.2.0',
      ...headers,
    },
  }
  const { response, mirror, abortOthers } = await raceFetch(urls, init, timeoutMs, `API ${apiPath}`)

  // 先 abort 输家，再读取 body
  abortOthers()
  try {
    const json = await response.json() as T
    logger.info(`[github-mirror] API 请求成功 via ${mirror}`)
    return json
  } catch (err) {
    // 如果 body 读取失败（比如赢家也被超时 abort 了），尝试重新走一次
    throw err
  }
}

/**
 * 下载文件（自动尝试镜像）。
 * @param originalUrl 原始 GitHub 下载链接（如 https://github.com/xxx/releases/download/yyy/zzz.zip）
 * @param destPath 保存路径（流式写入，不占用内存）
 * @param onProgress 进度回调 (0-100)
 * @param timeoutMs 超时（默认 5 分钟）
 * @returns { mirror: string, size: number }
 */
export async function githubDownload(
  originalUrl: string,
  destPath: string,
  onProgress?: (pct: number) => void,
  timeoutMs = 300000,
): Promise<{ mirror: string; size: number }> {
  // 构造各镜像 URL
  const urls = DOWNLOAD_MIRRORS.map((prefix) => {
    if (!prefix) return originalUrl // 直连
    // 代理站格式：https://ghproxy.net/https://github.com/...
    return `${prefix}/${originalUrl}`
  })

  const init: RequestInit = { method: 'GET' }
  const { response, mirror, abortOthers } = await raceFetch(urls, init, timeoutMs, `下载 ${originalUrl}`)

  // abort 输家
  abortOthers()

  // 流式写入文件
  const fs = await import('node:fs')
  const { Readable } = await import('node:stream')
  const { pipeline } = await import('node:stream/promises')

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10)
  let downloadedSize = 0

  const file = fs.createWriteStream(destPath)
  const stream = Readable.fromWeb(response.body as any)

  stream.on('data', (chunk: Buffer) => {
    downloadedSize += chunk.length
    if (onProgress && totalSize > 0) {
      onProgress((downloadedSize / totalSize) * 100)
    }
  })

  await pipeline(stream, file)

  const size = fs.statSync(destPath).size
  logger.info(`[github-mirror] 下载完成 via ${mirror} (${(size / 1024 / 1024).toFixed(2)} MB)`)
  return { mirror, size }
}
