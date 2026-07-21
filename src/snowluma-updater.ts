import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { app, Notification } from 'electron'
import { logger } from './logger'
import { SnowlumaManager } from './snowluma-manager'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  assets: Array<{
    name: string
    browser_download_url: string
    content_type: string
    size: number
  }>
}

interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  downloadUrl?: string
  releaseNotes?: string
  error?: string
}

type UpdateState = 'idle' | 'checking' | 'downloading' | 'extracting' | 'installing' | 'error'

// ---------------------------------------------------------------------------
// 版本对比（简化版 semver）
// ---------------------------------------------------------------------------

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = ''] = v.replace(/^v/, '').split('-', 2)
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0)
    while (nums.length < 3) nums.push(0)
    return nums
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// ---------------------------------------------------------------------------
// SnowLuma 更新器
// ---------------------------------------------------------------------------

export class SnowlumaUpdater extends EventEmitter {
  private manager: SnowlumaManager
  private _state: UpdateState = 'idle'
  private tempDir: string
  private currentVersion: string = '0.0.0'
  private lastError?: string

  constructor(manager: SnowlumaManager) {
    super()
    this.manager = manager
    this.tempDir = path.join(app.getPath('temp'), 'snowluma-update')
  }

  get state(): UpdateState {
    return this._state
  }

  get error(): string | undefined {
    return this.lastError
  }

  // ---------------------------------------------------------------------------
  // 检查更新
  // ---------------------------------------------------------------------------

  async checkForUpdate(): Promise<UpdateCheckResult> {
    this._state = 'checking'
    this.lastError = undefined
    this.emit('stateChanged', this._state)
    logger.info('正在检查 SnowLuma 更新...')

    const dir = this.manager.getCurrentDir()
    if (!dir) {
      this._state = 'error'
      this.lastError = 'SnowLuma 目录未设置'
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: '未知', latestVersion: '未知', error: this.lastError }
    }

    // 读取当前版本
    try {
      const pkgPath = path.join(dir, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      this.currentVersion = pkg.version || '0.0.0'
      logger.info(`当前版本: ${this.currentVersion}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._state = 'error'
      this.lastError = `读取版本失败: ${msg}`
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: '未知', latestVersion: '未知', error: this.lastError }
    }

    // 获取 GitHub 最新 Release
    try {
      const apiUrl = 'https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest'
      const res = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'SnowLuma-Tray/1.1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        throw new Error(`GitHub API 错误: ${res.status} ${res.statusText}`)
      }

      const release: GitHubRelease = await res.json()
      const latestVersion = release.tag_name.replace(/^v/, '')

      // 找到 Windows x64 完整版 zip
      const asset = release.assets.find(a =>
        a.name.includes('win-x64') && !a.name.includes('lite') && a.name.endsWith('.zip')
      )

      const hasUpdate = compareVersions(latestVersion, this.currentVersion) > 0

      const result: UpdateCheckResult = {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        downloadUrl: asset?.browser_download_url,
        releaseNotes: release.body?.slice(0, 400),
        error: hasUpdate ? undefined : (latestVersion === this.currentVersion ? undefined : '当前版本较新')
      }

      logger.info(`检查完成: 当前 ${this.currentVersion}, 最新 ${latestVersion}, 有更新: ${hasUpdate}`)
      this._state = 'idle'
      this.emit('stateChanged', this._state)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('检查更新失败:', msg)
      this._state = 'error'
      this.lastError = `检查失败: ${msg}`
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: this.currentVersion, latestVersion: '未知', error: this.lastError }
    }
  }

  // ---------------------------------------------------------------------------
  // 下载并安装更新
  // ---------------------------------------------------------------------------

  async downloadAndInstall(downloadUrl: string): Promise<boolean> {
    const dir = this.manager.getCurrentDir()
    if (!dir) {
      logger.error('SnowLuma 目录未设置')
      this.lastError = 'SnowLuma 目录未设置'
      this._state = 'error'
      this.emit('stateChanged', this._state)
      return false
    }

    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }

    // 下载
    this._state = 'downloading'
    this.lastError = undefined
    this.emit('stateChanged', this._state)
    logger.info(`正在下载: ${downloadUrl}`)

    const zipPath = path.join(this.tempDir, 'snowluma-update.zip')
    try {
      const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(300000) }) // 5 分钟超时
      if (!res.ok) throw new Error(`下载失败: ${res.status} ${res.statusText}`)

      const buffer = await res.arrayBuffer()
      fs.writeFileSync(zipPath, Buffer.from(buffer))
      logger.info(`下载完成: ${zipPath} (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('下载失败:', msg)
      this._state = 'error'
      this.lastError = `下载失败: ${msg}`
      this.emit('stateChanged', this._state)
      return false
    }

    // 解压
    this._state = 'extracting'
    this.emit('stateChanged', this._state)
    logger.info('正在解压...')

    const extractDir = path.join(this.tempDir, 'extracted')
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true })
    }
    fs.mkdirSync(extractDir, { recursive: true })

    try {
      await this.extractZip(zipPath, extractDir)
      logger.info('解压完成')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('解压失败:', msg)
      this._state = 'error'
      this.lastError = `解压失败: ${msg}`
      this.emit('stateChanged', this._state)
      return false
    }

    // 安装（替换文件）
    this._state = 'installing'
    this.emit('stateChanged', this._state)
    logger.info('正在安装更新...')

    try {
      // 停止 SnowLuma
      if (this.manager.state === 'running') {
        logger.info('停止 SnowLuma 进程...')
        this.manager.stop()
        await new Promise(resolve => setTimeout(resolve, 2000)) // 等待进程完全停止
      }

      // 找到解压后的 SnowLuma 目录（通常在子目录中）
      const extractedSnowlumaDir = this.findSnowlumaDir(extractDir)
      if (!extractedSnowlumaDir) {
        throw new Error('解压后未找到 SnowLuma 目录')
      }

      // 替换核心文件（保留 config/data/logs）
      this.replaceFiles(extractedSnowlumaDir, dir)

      // 清理临时文件
      fs.rmSync(this.tempDir, { recursive: true })

      // 更新版本信息
      const newPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
      this.currentVersion = newPkg.version

      logger.info(`SnowLuma 已更新至 v${this.currentVersion}`)
      this._state = 'idle'
      this.lastError = undefined
      this.emit('stateChanged', this._state)
      this.emit('updateComplete', this.currentVersion)

      // 通知用户
      this.notify('SnowLuma 更新完成', `已更新至 v${this.currentVersion}`)

      // 重启 SnowLuma
      setTimeout(() => {
        logger.info('重启 SnowLuma...')
        this.manager.start()
      }, 1000)

      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('安装更新失败:', msg)
      this._state = 'error'
      this.lastError = `安装失败: ${msg}`
      this.emit('stateChanged', this._state)
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // 重置错误状态
  // ---------------------------------------------------------------------------

  reset() {
    this._state = 'idle'
    this.lastError = undefined
    this.emit('stateChanged', this._state)
  }

  // ---------------------------------------------------------------------------
  // 解压 ZIP（使用 PowerShell）
  // ---------------------------------------------------------------------------

  private extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('powershell', [
        '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ], { windowsHide: true })

      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`解压失败，退出码: ${code}`))
      })

      proc.on('error', reject)
    })
  }

  // ---------------------------------------------------------------------------
  // 查找解压后的 SnowLuma 目录
  // ---------------------------------------------------------------------------

  private findSnowlumaDir(extractDir: string): string | null {
    // 检查直接目录
    if (fs.existsSync(path.join(extractDir, 'index.mjs'))) {
      return extractDir
    }

    // 检查子目录（zip 可能包含顶层目录）
    const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(extractDir, entry.name)
        if (fs.existsSync(path.join(subDir, 'index.mjs'))) {
          return subDir
        }
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // 替换文件（保留用户数据）
  // ---------------------------------------------------------------------------

  private replaceFiles(srcDir: string, destDir: string) {
    const preserveDirs = ['config', 'data', 'logs', 'Tray']
    const preserveFiles = ['package-lock.json']

    // 删除旧文件（排除保留项）
    const entries = fs.readdirSync(destDir, { withFileTypes: true })
    for (const entry of entries) {
      const name = entry.name
      const destPath = path.join(destDir, name)

      if (preserveDirs.includes(name) || preserveFiles.includes(name)) {
        logger.info(`保留: ${name}`)
        continue
      }

      try {
        if (entry.isDirectory()) {
          fs.rmSync(destPath, { recursive: true })
        } else {
          fs.unlinkSync(destPath)
        }
      } catch (err) {
        logger.warn(`删除失败（跳过）: ${name}`)
      }
    }

    // 复制新文件
    const newEntries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of newEntries) {
      const srcPath = path.join(srcDir, entry.name)
      const destPath = path.join(destDir, entry.name)

      if (entry.isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true })
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }

    logger.info('文件替换完成')
  }

  // ---------------------------------------------------------------------------
  // 通知
  // ---------------------------------------------------------------------------

  private notify(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  }
}
