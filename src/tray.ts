import { Tray, Menu, nativeImage, shell, app, Notification, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger'
import { SnowlumaManager, SnowlumaState } from './snowluma-manager'
import { SnowlumaUpdater } from './snowluma-updater'

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
  private snowlumaUpdater: SnowlumaUpdater
  private trayAppVersion = app.getVersion()
  private snowlumaUpdateAvailable = false
  private snowlumaUpdateVersion = ''
  private proxy: string | undefined

  constructor(snowlumaManager: SnowlumaManager) {
    this.snowlumaManager = snowlumaManager
    this.snowlumaUpdater = new SnowlumaUpdater(snowlumaManager)
    this.loadProxyConfig()
    this.setupSnowlumaUpdater()
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

    // 更新器状态变化
    this.snowlumaUpdater.on('stateChanged', () => {
      this.buildMenu()
    })

    this.snowlumaUpdater.on('updateComplete', (version: string) => {
      this.snowlumaUpdateAvailable = false
      this.buildMenu()
      this.notify('SnowLuma 更新完成', `已更新至 v${version}`)
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
    const updaterState = this.snowlumaUpdater.state

    const stateLabel: Record<SnowlumaState, string> = {
      stopped: '❌ 已停止',
      starting: '🔄 启动中...',
      running: '✅ 运行中',
      stopping: '⏳ 停止中...',
      error: '⚠️ 异常',
    }

    const updaterLabel: Record<string, string> = {
      idle: this.snowlumaUpdateAvailable ? `📥 下载更新 v${this.snowlumaUpdateVersion}` : '📥 检查更新',
      checking: '🔍 检查中...',
      downloading: '⬇️ 下载中...',
      extracting: '📦 解压中...',
      installing: '⚙️ 安装中...',
      error: '❌ 更新失败',
    }

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
      { label: `  托盘版本: v${this.trayAppVersion}`, enabled: false },
      { label: `  SnowLuma: v${snowlumaVer}`, enabled: false },
      ...(snowlumaDir ? [{ label: `  目录: ${snowlumaDir}`, enabled: false }] : []),

      // SnowLuma OTA 更新
      {
        label: updaterLabel[updaterState] || '📥 检查更新',
        enabled: updaterState === 'idle',
        click: () => this.checkSnowlumaUpdates(),
      },

      // 代理设置
      {
        label: this.proxy ? '🔧 设置代理 (当前: 已设置)' : '🔧 设置代理',
        click: () => this.showProxyDialog(),
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
  // SnowLuma 更新
  // ---------------------------------------------------------------------------

  private setupSnowlumaUpdater() {
    // 已在构造函数中创建
  }

  /** 检查 SnowLuma 更新 */
  async checkSnowlumaUpdates() {
    const result = await this.snowlumaUpdater.checkForUpdate()

    if (result.hasUpdate && result.downloadUrl) {
      this.snowlumaUpdateAvailable = true
      this.snowlumaUpdateVersion = result.latestVersion
      this.buildMenu()

      // 弹窗询问是否下载
      const choice = dialog.showMessageBoxSync(this.mainWindow!, {
        type: 'info',
        buttons: ['立即下载', '稍后提醒'],
        defaultId: 0,
        title: '发现新版本',
        message: `SnowLuma v${result.latestVersion} 可用`,
        detail: `当前版本: v${result.currentVersion}\n\n${result.releaseNotes?.split('\n').slice(0, 5).join('\n') || '查看完整更新日志请访问 GitHub'}`,
      })

      if (choice === 0) {
        // 用户选择下载
        this.notify('开始下载', `正在下载 SnowLuma v${result.latestVersion}...`)
        await this.snowlumaUpdater.downloadAndInstall(result.downloadUrl)
      }
    } else if (!result.hasUpdate) {
      this.notify('已是最新', `SnowLuma v${result.currentVersion} 无需更新`)
    } else {
      this.notify('检查失败', '无法获取更新信息，请检查网络连接')
    }
  }

  // ---------------------------------------------------------------------------
  // 代理设置
  // ---------------------------------------------------------------------------

  private showProxyDialog() {
    const currentProxy = this.proxy || ''

    // 使用简单的输入对话框（通过 Electron prompt 或自定义窗口）
    // 这里简化为设置固定代理 127.0.0.1:7890
    const choice = dialog.showMessageBoxSync(this.mainWindow!, {
      type: 'question',
      buttons: ['设置 127.0.0.1:7890', '清除代理', '取消'],
      defaultId: 0,
      title: '代理设置',
      message: '当前代理: ' + (currentProxy || '未设置'),
      detail: '设置代理以访问 GitHub（国内网络需要）',
    })

    if (choice === 0) {
      this.proxy = 'http://127.0.0.1:7890'
      this.snowlumaUpdater.setProxy(this.proxy)
      this.buildMenu()
      this.notify('代理已设置', '127.0.0.1:7890')
    } else if (choice === 1) {
      this.proxy = undefined
      this.snowlumaUpdater.setProxy(undefined)
      this.buildMenu()
      this.notify('代理已清除', '将使用直连')
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
