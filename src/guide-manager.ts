import { BrowserWindow, ipcMain, dialog, app, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { logger } from './logger'
import { SnowlumaManager } from './snowluma-manager'
import { githubApiGet } from './github-mirror'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface GitHubRelease {
  tag_name: string
  name?: string
  body?: string
  html_url?: string
  assets: Array<{
    name: string
    browser_download_url: string
    size?: number
  }>
}

// ---------------------------------------------------------------------------
// 引导管理器
// ---------------------------------------------------------------------------

export class GuideManager {
  private window: BrowserWindow | null = null
  private snowlumaManager: SnowlumaManager
  private onComplete: ((dir: string) => void) | null = null

  constructor(snowlumaManager: SnowlumaManager) {
    this.snowlumaManager = snowlumaManager
    this.registerIpcHandlers()
  }

  // ---------------------------------------------------------------------------
  // 注册 IPC 处理器
  // ---------------------------------------------------------------------------

  private registerIpcHandlers() {
    // 获取托盘版本
    ipcMain.handle('guide:getTrayVersion', () => {
      return app.getVersion()
    })

    // 选择目录
    ipcMain.handle('guide:selectDirectory', async () => {
      const result = await dialog.showOpenDialog(this.window!, {
        title: '选择 SnowLuma 目录',
        properties: ['openDirectory'],
        defaultPath: 'D:\\',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false }
      }

      const selectedPath = result.filePaths[0]
      return { success: true, path: selectedPath }
    })

    // 获取最新版本
    ipcMain.handle('guide:getLatestSnowluma', async () => {
      try {
        const data = await githubApiGet<GitHubRelease>('/repos/SnowLuma/SnowLuma/releases/latest')
        const version = data.tag_name.replace(/^v/, '')

        // 查找 Windows zip 资源
        const zipAsset = data.assets.find(a =>
          a.name.endsWith('-win-x64.zip') || a.name.includes('windows') || a.name.includes('win')
        )

        if (!zipAsset) {
          throw new Error('未找到 Windows 版本下载链接')
        }

        return {
          version,
          downloadUrl: zipAsset.browser_download_url,
          releaseNotes: data.body?.slice(0, 500),
        }
      } catch (err) {
        logger.error('获取最新版本失败:', err)
        throw err
      }
    })

    // 下载 SnowLuma
    ipcMain.handle('guide:downloadSnowluma', async (event, url: string) => {
      const tmpDir = path.join(app.getPath('temp'), 'snowluma-download')
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }
      const tmpFile = path.join(tmpDir, 'snowluma.zip')

      try {
        await this.downloadFile(url, tmpFile, (pct) => {
          event.sender.send('guide:downloadProgress', pct)
        })
        return tmpFile
      } catch (err) {
        // 清理临时文件
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile)
        }
        throw err
      }
    })

    // 解压
    ipcMain.handle('guide:extractSnowluma', async (_event, zipPath?: string) => {
      // 如果没有指定 zipPath，查找最新的
      if (!zipPath) {
        const tmpDir = path.join(app.getPath('temp'), 'snowluma-download')
        zipPath = path.join(tmpDir, 'snowluma.zip')
      }

      if (!fs.existsSync(zipPath)) {
        throw new Error('下载的文件不存在')
      }

      // 解压到临时目录
      const tmpExtractDir = path.join(app.getPath('temp'), 'snowluma-extract')
      if (fs.existsSync(tmpExtractDir)) {
        fs.rmSync(tmpExtractDir, { recursive: true })
      }
      fs.mkdirSync(tmpExtractDir, { recursive: true })

      logger.info('开始解压 SnowLuma...')

      // 使用 PowerShell 解压（跨平台兼容性好）
      const { execSync } = await import('node:child_process')
      const extractDir = path.join(tmpExtractDir, 'snowluma')
      fs.mkdirSync(extractDir, { recursive: true })

      try {
        // Windows: 使用 PowerShell Expand-Archive
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, {
          stdio: 'pipe',
        })
      } catch (err) {
        logger.error('解压失败:', err)
        throw new Error('解压失败，请手动下载安装')
      }

      // 查找解压后的目录结构
      const entries = fs.readdirSync(extractDir)
      logger.info('解压后内容:', entries)

      // 移动内容到最终目录
      const installDir = 'D:\\snowluma'

      // 如果目录已存在，备份 data 和 config
      const backupDir = fs.existsSync(installDir) ? path.join(app.getPath('temp'), 'snowluma-backup-' + Date.now()) : null
      if (backupDir) {
        const dataDir = path.join(installDir, 'data')
        const logsDir = path.join(installDir, 'logs')
        if (fs.existsSync(dataDir)) {
          fs.cpSync(dataDir, path.join(backupDir, 'data'), { recursive: true })
        }
        if (fs.existsSync(logsDir)) {
          fs.cpSync(logsDir, path.join(backupDir, 'logs'), { recursive: true })
        }
        logger.info('已备份 data 和 logs 到:', backupDir)
      }

      // 创建安装目录
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }

      // 如果解压后是单个目录（SnowLuma-v1.12.7-win-x64/），取其内容
      const srcDir = entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
        ? path.join(extractDir, entries[0])
        : extractDir

      // 复制文件
      for (const entry of fs.readdirSync(srcDir)) {
        if (entry === 'data' || entry === 'logs') continue // 跳过 data 和 logs
        const src = path.join(srcDir, entry)
        const dst = path.join(installDir, entry)
        if (fs.existsSync(dst)) {
          if (fs.statSync(src).isDirectory()) {
            fs.rmSync(dst, { recursive: true })
          } else {
            fs.unlinkSync(dst)
          }
        }
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true })
        } else {
          fs.copyFileSync(src, dst)
        }
      }

      // 恢复 data 和 logs
      if (backupDir && fs.existsSync(backupDir)) {
        const dataDir = path.join(backupDir, 'data')
        const logsDir = path.join(backupDir, 'logs')
        if (fs.existsSync(dataDir)) {
          const targetData = path.join(installDir, 'data')
          if (fs.existsSync(targetData)) {
            fs.rmSync(targetData, { recursive: true })
          }
          fs.cpSync(dataDir, targetData, { recursive: true })
        }
        if (fs.existsSync(logsDir)) {
          const targetLogs = path.join(installDir, 'logs')
          if (fs.existsSync(targetLogs)) {
            fs.rmSync(targetLogs, { recursive: true })
          }
          fs.cpSync(logsDir, targetLogs, { recursive: true })
        }
        fs.rmSync(backupDir, { recursive: true })
      }

      // 清理临时文件
      fs.rmSync(tmpExtractDir, { recursive: true })
      fs.unlinkSync(zipPath)

      logger.info('安装完成:', installDir)
      return installDir
    })

    // 设置目录并验证
    ipcMain.handle('guide:setSnowlumaDir', async (_event, dir: string) => {
      const markerFiles = ['index.mjs', 'node.exe']
      for (const file of markerFiles) {
        if (!fs.existsSync(path.join(dir, file))) {
          return { success: false, error: `目录缺少必要文件: ${file}` }
        }
      }
      return { success: true }
    })

    // 启动 SnowLuma
    ipcMain.handle('guide:startSnowluma', async (_event, dir: string) => {
      this.snowlumaManager.setDir(dir)
      await this.snowlumaManager.detectAndStart()

      // 关闭窗口
      this.window?.close()
      this.window = null
    })
  }

  // ---------------------------------------------------------------------------
  // 下载文件（带进度）
  // ---------------------------------------------------------------------------

  private async downloadFile(url: string, destPath: string, onProgress: (pct: number) => void): Promise<void> {
    logger.info('开始下载:', url)

    // 尝试直连 + 镜像竞速，取第一个成功的
    const DOWNLOAD_MIRRORS: string[] = [
      '',  // 直连
      'https://ghproxy.net',
      'https://mirror.ghproxy.com',
      'https://gh-proxy.com',
      'https://ghfast.top',
    ]

    // 每个请求独立 controller，避免赢家被输家 abort
    const controllers = DOWNLOAD_MIRRORS.map(() => new AbortController())
    const timeout = setTimeout(() => {
      controllers.forEach(c => c.abort())
    }, 300000) // 5 分钟

    const urls = DOWNLOAD_MIRRORS.map((prefix) => prefix ? `${prefix}/${url}` : url)

    const tasks = urls.map(async (mirrorUrl, i) => {
      const res = await fetch(mirrorUrl, {
        headers: { 'User-Agent': 'SnowLumaTray' },
        signal: controllers[i].signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} @ ${mirrorUrl}`)
      return { res, mirrorUrl, index: i }
    })

    try {
      const { res, mirrorUrl, index } = await Promise.any(tasks)
      logger.info(`下载连接成功 via ${mirrorUrl}`)

      // abort 输家，保留赢家
      controllers.forEach((c, i) => {
        if (i !== index) c.abort()
      })

      const totalSize = parseInt(res.headers.get('content-length') || '0', 10)
      let downloadedSize = 0

      // 流式写入
      const { Readable } = await import('node:stream')
      const { createWriteStream } = await import('node:fs')
      const file = createWriteStream(destPath)
      const stream = Readable.fromWeb(res.body as any)

      stream.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          onProgress((downloadedSize / totalSize) * 100)
        }
      })

      await pipeline(stream, file)
      logger.info('下载完成:', destPath)
    } catch (aggregate) {
      const errors = (aggregate as AggregateError)?.errors?.map((e: Error) => e.message) ?? [String(aggregate)]
      throw new Error(`下载失败（全部镜像）: ${errors.join(' | ')}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  // ---------------------------------------------------------------------------
  // 显示引导窗口
  // ---------------------------------------------------------------------------

  show(onComplete: (dir: string) => void) {
    this.onComplete = onComplete

    this.window = new BrowserWindow({
      width: 550,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'SnowLuma 托盘 - 首次设置',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      autoHideMenuBar: true,
    })

    // 加载引导页面
    // __dirname 指向 dist/ 目录，guide.html 在 src/ 目录
    const htmlPath = path.join(__dirname, '..', 'guide.html')
    logger.info('加载引导页面:', htmlPath)
    this.window.loadFile(htmlPath)

    // 窗口关闭时退出应用
    this.window.on('closed', () => {
      this.window = null
    })

    this.window.once('ready-to-show', () => {
      this.window?.show()
    })
  }

  // ---------------------------------------------------------------------------
  // 关闭引导窗口
  // ---------------------------------------------------------------------------

  close() {
    if (this.window) {
      this.window.close()
      this.window = null
    }
  }
}
