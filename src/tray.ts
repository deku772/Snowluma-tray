import { Tray, Menu, nativeImage, shell, app, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { logger } from './logger'
import { SnowlumaManager, SnowlumaState } from './snowluma-manager'

// ---------------------------------------------------------------------------
// 图标路径
// ---------------------------------------------------------------------------

const getIconPath = () => path.join(__dirname, '..', 'assets', 'icon.png')

// ---------------------------------------------------------------------------
// 托盘管理器
// ---------------------------------------------------------------------------

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: Electron.BrowserWindow | null = null
  private snowlumaManager: SnowlumaManager
  private trayAppVersion = app.getVersion()
  private updateAvailable = false
  private updateVersion = ''

  constructor(snowlumaManager: SnowlumaManager) {
    this.snowlumaManager = snowlumaManager
    this.setupAutoUpdater()
  }

  // ---------------------------------------------------------------------------
  // 创建托盘
  // ---------------------------------------------------------------------------

  create(mainWindow: Electron.BrowserWindow) {
    this.mainWindow = mainWindow

    // 加载图标
    let icon: Electron.NativeImage
    try {
      icon = nativeImage.createFromPath(getIconPath())
      if (icon.isEmpty()) {
        icon = nativeImage.createEmpty()
        logger.warn('托盘图标不存在或为空')
      }
    } catch (e) {
      icon = nativeImage.createEmpty()
      logger.warn('托盘图标加载失败')
    }

    this.tray = new Tray(icon)
    this.updateTooltip()
    this.buildMenu()

    // 双击：打开 WebUI
    this.tray.on('double-click', () => {
      this.openWebUI()
    })

    // 状态变化时刷新 tooltip 和菜单
    this.snowlumaManager.on('stateChanged', () => {
      this.updateTooltip()
      this.buildMenu()
    })

    logger.info('托盘图标已创建')
  }

  // ---------------------------------------------------------------------------
  // 菜单构建
  // ---------------------------------------------------------------------------

  private buildMenu() {
    if (!this.tray) return

    const state = this.snowlumaManager.state
    const lm = this.snowlumaManager
    const snowlumaVer = lm.snowlumaVersion
    const snowlumaDir = lm.getCurrentDir() ?? ''

    const stateLabel: Record<SnowlumaState, string> = {
      stopped: '❌ 已停止',
      starting: '🔄 启动中...',
      running: '✅ 运行中',
      stopping: '⏳ 停止中...',
      error: '⚠️ 异常',
    }

    const versionSection: Electron.MenuItemConstructorOptions[] = [
      { label: `  托盘版本: v${this.trayAppVersion}`, enabled: false },
      { label: `  SnowLuma: v${snowlumaVer}`, enabled: false },
      ...(snowlumaDir ? [{ label: `  目录: ${snowlumaDir}`, enabled: false }] : []),
    ]

    const updateLabel = this.updateAvailable
      ? `📥 下载更新 v${this.updateVersion}`
      : '📥 检查更新'

    const contextMenu = Menu.buildFromTemplate([
      // 标题行：版本 + 状态
      { label: `🆔 SnowLuma  v${snowlumaVer}  ${stateLabel[state]}`, enabled: false },
      { type: 'separator' },

      // 操作区
      {
        label: '🌐 打开 WebUI',
        click: () => this.openWebUI(),
      },

      {
        label: '🔄 重启 SnowLuma',
        enabled: state === 'running' || state === 'error',
        click: () => {
          logger.info('用户点击：重启 SnowLuma')
          lm.restart()
        },
      },

      {
        label: '▶️ 启动 SnowLuma',
        enabled: state === 'stopped',
        click: () => {
          logger.info('用户点击：启动 SnowLuma')
          lm.start()
        },
      },

      {
        label: '⏹️ 停止 SnowLuma',
        enabled: state === 'running',
        click: () => {
          logger.info('用户点击：停止 SnowLuma')
          lm.stop()
        },
      },

      { type: 'separator' },

      // 版本信息（不可点击）
      ...versionSection,

      // OTA 更新
      {
        label: updateLabel,
        click: () => this.checkForUpdates(),
      },

      { type: 'separator' },

      {
        label: '📁 打开 SnowLuma 目录',
        click: () => {
          if (snowlumaDir) shell.openPath(snowlumaDir).catch(() => { /* ignore */ })
        },
      },

      {
        label: '📁 打开日志目录',
        click: () => {
          if (snowlumaDir) {
            shell.openPath(path.join(snowlumaDir, 'logs')).catch(() => {
              shell.openPath(snowlumaDir).catch(() => { /* ignore */ })
            })
          }
        },
      },

      { type: 'separator' },

      {
        label: this.mainWindow?.isVisible() ? '🙈 隐藏窗口' : '👁️ 显示窗口',
        click: () => this.toggleWindow(),
      },

      {
        label: '❌ 退出',
        click: () => this.quit(),
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  // ---------------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------------

  private updateTooltip() {
    if (!this.tray) return
    const state = this.snowlumaManager.state
    const ver = this.snowlumaManager.snowlumaVersion
    const stateText: Record<SnowlumaState, string> = {
      stopped: '已停止',
      starting: '启动中...',
      running: '运行中',
      stopping: '停止中...',
      error: '异常',
    }
    this.tray.setToolTip(
      `SnowLuma v${ver}\n状态: ${stateText[state]}\n双击打开 WebUI`
    )
  }

  // ---------------------------------------------------------------------------
  // 操作
  // ---------------------------------------------------------------------------

  private openWebUI() {
    logger.info('打开 WebUI')
    shell.openExternal('http://localhost:5099').catch(() => {
      this.notify('WebUI 启动中', '请稍后访问 http://localhost:5099')
    })
  }

  private toggleWindow() {
    if (!this.mainWindow) return
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide()
    } else {
      this.mainWindow.show()
      this.mainWindow.focus()
    }
    this.buildMenu()
  }

  private notify(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  }

  // ---------------------------------------------------------------------------
  // OTA 更新
  // ---------------------------------------------------------------------------

  private setupAutoUpdater() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      logger.info('正在检查更新...')
    })

    autoUpdater.on('update-available', (info) => {
      logger.info(`发现新版本: v${info.version}`)
      this.updateAvailable = true
      this.updateVersion = info.version
      this.buildMenu()
      this.notify('发现新版本', `v${info.version} 可用，点击「下载更新」安装`)
    })

    autoUpdater.on('update-not-available', () => {
      logger.info('当前已是最新版本')
      this.updateAvailable = false
      this.buildMenu()
    })

    autoUpdater.on('download-progress', (progress) => {
      logger.info(`下载进度: ${progress.percent.toFixed(1)}%`)
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`更新已下载: v${info.version}，退出后将自动安装`)
      this.notify('更新已就绪', `v${info.version} 下载完成，退出后自动安装`)
      this.buildMenu()
    })

    autoUpdater.on('error', (err) => {
      // 未发布版本：缺少 app-update.yml，无需上报
      const raw = String(err ?? '')
      if (raw.includes('app-update.yml')) return
      logger.error('OTA 更新错误:', raw)
    })
  }

  /** 菜单触发检查更新 */
  async checkForUpdates() {
    try {
      logger.info('用户点击：检查更新')
      const result = await autoUpdater.checkForUpdates()
      if (!result) {
        this.notify('已是最新', `当前 v${app.getVersion()} 无需更新`)
      }
    } catch (err: unknown) {
      const raw = String(err ?? '')
      if (raw.includes('app-update.yml')) {
        this.notify('未配置更新', `发布后可在此检查更新`)
        return
      }
      logger.error('检查更新失败:', raw)
      this.notify('检查失败', '无法连接更新服务器')
    }
  }

  // ---------------------------------------------------------------------------
  // 退出
  // ---------------------------------------------------------------------------

  quit() {
    logger.info('用户点击：退出托盘')
    this.snowlumaManager.stop()
    setTimeout(() => app.quit(), 1500)
  }

  destroy() {
    this.tray?.destroy()
    this.tray = null
  }
}
