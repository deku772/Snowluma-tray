import { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import path from 'node:path'
import { SnowlumaManager } from './snowluma-manager'
import { TrayManager } from './tray'
import { GuideManager } from './guide-manager'
import { logger } from './logger'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

let isQuitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logger.info('已有实例运行，退出')
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let snowlumaManager: SnowlumaManager
let trayManager: TrayManager
let guideManager: GuideManager

// 检测是否已配置（有 config.json 且有目录）
function isConfigured(): boolean {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.snowlumaDir && fs.existsSync(path.join(config.snowlumaDir, 'index.mjs'))) {
        return true
      }
    }
  } catch { /* ignore */ }
  return false
}

// 检测是否有可用的默认目录（用于自动填充）
function detectDefaultDir(): string | null {
  const defaultDirs = ['D:\\snowluma', 'D:\\SnowLuma']
  for (const dir of defaultDirs) {
    if (fs.existsSync(path.join(dir, 'index.mjs')) && fs.existsSync(path.join(dir, 'node.exe'))) {
      return dir
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 窗口创建
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    show: false,         // 启动时隐藏
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 加载内嵌简单页面（显示托盘管理界面）
  mainWindow.loadURL('data:text/html,<html><head><meta charset="utf-8"><style>body{font-family:system-ui;background:%23111;color:%23eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}div{font-size:18px;opacity:0.7}</style></head><body><div>🪟 SnowLuma 托盘管理器</div><div style="font-size:13px;opacity:0.4">在系统托盘查看状态与操作菜单</div></body></html>')

  // 窗口关闭时隐藏而非退出（托盘程序）
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  logger.info('主窗口已创建（隐藏模式）')
}

// ---------------------------------------------------------------------------
// IPC 处理器
// ---------------------------------------------------------------------------

function setupIPC() {
  ipcMain.handle('snowluma:getState', () => snowlumaManager.state)
  ipcMain.handle('snowluma:start', () => snowlumaManager.start())
  ipcMain.handle('snowluma:stop', () => snowlumaManager.stop())
  ipcMain.handle('snowluma:restart', () => snowlumaManager.restart())
  ipcMain.handle('snowluma:getDir', () => snowlumaManager.getCurrentDir())

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // 状态变化广播到渲染进程
  snowlumaManager.on('stateChanged', (state) => {
    mainWindow?.webContents.send('snowluma:stateChanged', state)
  })

  logger.info('IPC 处理器已注册')
}

// ---------------------------------------------------------------------------
// 全局快捷键
// ---------------------------------------------------------------------------

function registerShortcuts() {
  const ret = globalShortcut.register('CommandOrControl+Shift+S', () => {
    logger.info('快捷键 Ctrl+Shift+S 触发')
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  if (!ret) {
    logger.warn('全局快捷键注册失败')
  } else {
    logger.info('全局快捷键 Ctrl+Shift+S 已注册')
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

app.on('before-quit', () => {
  isQuitting = true
})

app.on('second-instance', () => {
  // 聚焦已有窗口
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  logger.info(`SnowLumaTray 启动，版本 ${app.getVersion()}`)

  // 初始化管理器
  snowlumaManager = new SnowlumaManager()
  trayManager = new TrayManager(snowlumaManager)

  // 创建窗口（隐藏）
  createWindow()

  // 注册 IPC
  setupIPC()

  // 注册快捷键
  registerShortcuts()

  // 创建托盘（在窗口创建之后）
  if (mainWindow) {
    trayManager.create(mainWindow)
  }

  // 初始化 OTA 自动更新（仅设置 logger，不自动检查）
  autoUpdater.logger = log

  // 检测是否首次使用
  if (!isConfigured()) {
    // 首次使用，显示引导
    logger.info('首次使用，显示引导窗口')
    guideManager = new GuideManager(snowlumaManager)
    guideManager.show((dir) => {
      logger.info('引导完成，目录:', dir)
    })
  } else {
    // 已有配置，直接启动
    logger.info('检测到已有配置，直接启动')
    setTimeout(() => {
      snowlumaManager.detectAndStart()
    }, 500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 不退出，让托盘继续运行
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  trayManager?.destroy()
  logger.info('SnowLumaTray 退出')
})
