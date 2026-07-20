import { Tray, Menu, nativeImage, shell, app, Notification } from 'electron'
import path from 'node:path'
import { logger } from './logger'
import { SnowlumaManager, SnowlumaState } from './snowluma-manager'

// 图标路径：__dirname = dist/，assets/ 在 Tray/assets/
const getIconPath = () => {
  const base = path.dirname(__dirname)  // src/
  return path.join(base, 'assets', 'icon.png')
}

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: Electron.BrowserWindow | null = null
  private snowlumaManager: SnowlumaManager

  constructor(snowlumaManager: SnowlumaManager) {
    this.snowlumaManager = snowlumaManager
  }

  create(mainWindow: Electron.BrowserWindow) {
    this.mainWindow = mainWindow

    const iconPath = getIconPath()
    let icon: Electron.NativeImage

    try {
      icon = nativeImage.createFromPath(iconPath)
      if (icon.isEmpty()) {
        icon = nativeImage.createEmpty()
        logger.warn(`托盘图标不存在: ${iconPath}`)
      }
    } catch (e) {
      icon = nativeImage.createEmpty()
      logger.warn('托盘图标加载失败，使用空白图标')
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('SnowLuma 托盘 - 初始化中...')

    this.buildMenu()

    // 双击托盘：切换窗口显示
    this.tray.on('double-click', () => {
      this.toggleWindow()
    })

    // 监听 SnowLuma 状态变化，更新托盘菜单
    this.snowlumaManager.on('stateChanged', () => {
      this.buildMenu()
      this.updateTooltip()
    })

    logger.info('托盘图标已创建')
  }

  private buildMenu() {
    if (!this.tray) return

    const state = this.snowlumaManager.state
    const stateLabel: Record<SnowlumaState, string> = {
      stopped: '❌ 已停止',
      starting: '🔄 启动中...',
      running: '✅ 运行中',
      stopping: '⏳ 停止中...',
      error: '⚠️ 异常',
    }

    const contextMenu = Menu.buildFromTemplate([
      // 第一行：标题 + 状态
      { label: `SnowLuma  ${stateLabel[state]}`, enabled: false },
      { type: 'separator' },

      // 打开 WebUI
      {
        label: '🌐 打开 WebUI',
        click: () => {
          shell.openExternal('http://localhost:5099')
        },
      },

      // 重启 SnowLuma
      {
        label: '🔄 重启 SnowLuma',
        enabled: state === 'running' || state === 'error',
        click: () => {
          logger.info('用户点击：重启 SnowLuma')
          this.snowlumaManager.restart()
        },
      },

      // 启动 SnowLuma
      {
        label: '▶️ 启动 SnowLuma',
        enabled: state === 'stopped',
        click: () => {
          logger.info('用户点击：启动 SnowLuma')
          this.snowlumaManager.start()
        },
      },

      // 停止 SnowLuma
      {
        label: '⏹️ 停止 SnowLuma',
        enabled: state === 'running',
        click: () => {
          logger.info('用户点击：停止 SnowLuma')
          this.snowlumaManager.stop()
        },
      },

      { type: 'separator' },

      // 检查更新
      {
        label: '📥 检查更新',
        click: () => {
          logger.info('用户点击：检查更新')
          this.notify('提示', '检查更新功能开发中...')
        },
      },

      // 打开日志目录
      {
        label: '📁 打开日志目录',
        click: () => {
          const logsDir = path.join(this.snowlumaManager.getCurrentDir() ?? '', 'logs')
          shell.openPath(logsDir).catch(() => {
            // SnowLuma 日志目录不存在时，打开其目录
            const snowlumaDir = this.snowlumaManager.getCurrentDir()
            if (snowlumaDir) shell.openPath(snowlumaDir)
          })
        },
      },

      { type: 'separator' },

      // 隐藏/显示窗口
      {
        label: this.mainWindow?.isVisible() ? '🙈 隐藏窗口' : '👁️ 显示窗口',
        click: () => this.toggleWindow(),
      },

      // 退出
      {
        label: '❌ 退出',
        click: () => {
          logger.info('用户点击：退出托盘')
          this.quit()
        },
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  private updateTooltip() {
    if (!this.tray) return
    const state = this.snowlumaManager.state
    const stateText: Record<SnowlumaState, string> = {
      stopped: '已停止',
      starting: '启动中...',
      running: '运行中',
      stopping: '停止中...',
      error: '异常退出',
    }
    const dir = this.snowlumaManager.getCurrentDir()
    const dirText = dir ? `\n目录: ${dir}` : ''
    this.tray.setToolTip(`SnowLuma 托盘 - ${stateText[state]}${dirText}`)
  }

  private toggleWindow() {
    if (!this.mainWindow) return
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide()
    } else {
      this.mainWindow.show()
      this.mainWindow.focus()
    }
    // 刷新菜单（更新显示/隐藏标签）
    this.buildMenu()
  }

  private notify(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  }

  quit() {
    // 先停止 SnowLuma
    this.snowlumaManager.stop()
    // 延迟退出，等待子进程终止
    setTimeout(() => {
      app.quit()
    }, 1500)
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
