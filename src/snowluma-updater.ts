import https from 'node:https'
import http from 'node:http'
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
}

type UpdateState = 'idle' | 'checking' | 'downloading' | 'extracting' | 'installing' | 'error'

// ---------------------------------------------------------------------------
// HTTP 请求（支持代理）
// ---------------------------------------------------------------------------

function httpGet(url: string, proxy?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'

    // 如果有代理，通过代理发送请求
    if (proxy) {
      const proxyUrl = new URL(proxy)
      const proxyReq = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port || 7890,
        method: 'CONNECT',
        path: `${parsedUrl.hostname}:443`,
      })

      proxyReq.on('connect', (res, socket) => {
        if (res.statusCode === 200) {
          const tlsSocket = require('tls').connect({
            socket,
            servername: parsedUrl.hostname,
          }, () => {
            const req = `GET ${parsedUrl.pathname} HTTP/1.1\r\nHost: ${parsedUrl.hostname}\r\nConnection: close\r\n\r\n`
            tlsSocket.write(req)
          })

          let data = ''
          tlsSocket.on('data', (chunk: Buffer) => { data += chunk })
          tlsSocket.on('end', () => {
            // 解析 HTTP 响应，提取 body
            const bodyStart = data.indexOf('\r\n\r\n')
            if (bodyStart !== -1) {
              resolve(data.slice(bodyStart + 4))
            } else {
              reject(new Error('Invalid HTTP response'))
            }
          })
          tlsSocket.on('error', reject)
        } else {
          reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`))
        }
      })

      proxyReq.on('error', reject)
      proxyReq.end()
      return
    }

    // 无代理，直接请求
    const client = isHttps ? https : http
    const req = client.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// 文件下载（支持代理）
// ---------------------------------------------------------------------------

function downloadFile(url: string, destPath: string, proxy?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'

    if (proxy) {
      const proxyUrl = new URL(proxy)
      const proxyReq = http.request({
        host: proxyUrl.hostname,
        port: proxyUrl.port || 7890,
        method: 'CONNECT',
        path: `${parsedUrl.hostname}:443`,
      })

      proxyReq.on('connect', (res, socket) => {
        if (res.statusCode === 200) {
          const tlsSocket = require('tls').connect({
            socket,
            servername: parsedUrl.hostname,
          }, () => {
            const req = `GET ${parsedUrl.pathname} HTTP/1.1\r\nHost: ${parsedUrl.hostname}\r\nConnection: close\r\n\r\n`
            tlsSocket.write(req)
          })

          const file = fs.createWriteStream(destPath)
          let headersDone = false

          tlsSocket.on('data', (chunk: Buffer) => {
            if (!headersDone) {
              // 跳过 HTTP 头
              const data = chunk.toString()
              const headerEnd = data.indexOf('\r\n\r\n')
              if (headerEnd !== -1) {
                headersDone = true
                const body = chunk.slice(headerEnd + 4)
                file.write(body)
              }
            } else {
              file.write(chunk)
            }
          })

          tlsSocket.on('end', () => {
            file.end()
            resolve()
          })

          tlsSocket.on('error', (err: Error) => {
            file.destroy()
            fs.unlinkSync(destPath)
            reject(err)
          })
        } else {
          reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`))
        }
      })

      proxyReq.on('error', reject)
      proxyReq.end()
      return
    }

    // 无代理
    const client = isHttps ? https : http
    const file = fs.createWriteStream(destPath)
    const req = client.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // 跟随重定向
        file.close()
        fs.unlinkSync(destPath)
        downloadFile(res.headers.location!, destPath, proxy).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    })
    req.on('error', (err) => {
      file.destroy()
      fs.unlinkSync(destPath)
      reject(err)
    })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// SnowLuma 更新器
// ---------------------------------------------------------------------------

export class SnowlumaUpdater extends EventEmitter {
  private manager: SnowlumaManager
  private _state: UpdateState = 'idle'
  private proxy?: string
  private tempDir: string
  private currentVersion: string = '0.0.0'

  constructor(manager: SnowlumaManager) {
    super()
    this.manager = manager
    this.tempDir = path.join(app.getPath('temp'), 'snowluma-update')
    this.loadProxyConfig()
  }

  get state(): UpdateState {
    return this._state
  }

  // ---------------------------------------------------------------------------
  // 代理配置
  // ---------------------------------------------------------------------------

  private loadProxyConfig() {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        this.proxy = config.proxy
      }
    } catch { /* ignore */ }
  }

  setProxy(proxy: string | undefined) {
    this.proxy = proxy
    // 保存到配置
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      const config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        : {}
      config.proxy = proxy
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      logger.info(`代理配置已更新: ${proxy || '无'}`)
    } catch (e) {
      logger.error('保存代理配置失败:', e)
    }
  }

  // ---------------------------------------------------------------------------
  // 检查更新
  // ---------------------------------------------------------------------------

  async checkForUpdate(): Promise<UpdateCheckResult> {
    this._state = 'checking'
    this.emit('stateChanged', this._state)
    logger.info('正在检查 SnowLuma 更新...')

    const dir = this.manager.getCurrentDir()
    if (!dir) {
      this._state = 'error'
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: '未知', latestVersion: '未知' }
    }

    // 读取当前版本
    try {
      const pkgPath = path.join(dir, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      this.currentVersion = pkg.version || '0.0.0'
    } catch {
      this._state = 'error'
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: '未知', latestVersion: '未知' }
    }

    // 获取 GitHub 最新 Release
    try {
      const apiUrl = 'https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest'
      const jsonStr = await httpGet(apiUrl, this.proxy)
      const release: GitHubRelease = JSON.parse(jsonStr)

      const latestVersion = release.tag_name.replace(/^v/, '')

      // 找到 Windows x64 完整版 zip
      const asset = release.assets.find(a =>
        a.name.includes('win-x64') && !a.name.includes('lite') && a.name.endsWith('.zip')
      )

      const result: UpdateCheckResult = {
        hasUpdate: latestVersion !== this.currentVersion,
        currentVersion: this.currentVersion,
        latestVersion,
        downloadUrl: asset?.browser_download_url,
        releaseNotes: release.body,
      }

      logger.info(`检查完成: 当前 ${this.currentVersion}, 最新 ${latestVersion}, 有更新: ${result.hasUpdate}`)
      this._state = 'idle'
      this.emit('stateChanged', this._state)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('检查更新失败:', msg)
      this._state = 'error'
      this.emit('stateChanged', this._state)
      return { hasUpdate: false, currentVersion: this.currentVersion, latestVersion: '未知' }
    }
  }

  // ---------------------------------------------------------------------------
  // 下载并安装更新
  // ---------------------------------------------------------------------------

  async downloadAndInstall(downloadUrl: string): Promise<boolean> {
    const dir = this.manager.getCurrentDir()
    if (!dir) {
      logger.error('SnowLuma 目录未设置')
      return false
    }

    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }

    // 下载
    this._state = 'downloading'
    this.emit('stateChanged', this._state)
    logger.info(`正在下载: ${downloadUrl}`)

    const zipPath = path.join(this.tempDir, 'snowluma-update.zip')
    try {
      await downloadFile(downloadUrl, zipPath, this.proxy)
      logger.info(`下载完成: ${zipPath}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('下载失败:', msg)
      this._state = 'error'
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
      this.emit('stateChanged', this._state)
      return false
    }
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
