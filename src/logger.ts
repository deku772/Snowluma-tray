import log from 'electron-log'
import path from 'node:path'
import { app } from 'electron'

// 配置日志文件路径到 AppData/snowluma-tray/logs/
const logDir = path.join(app.getPath('userData'), 'logs')
try {
  log.transports.file.resolvePathFn = () => path.join(logDir, 'snowluma-tray.log')
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
} catch {
  // app 尚未 ready 时降级到 console
  log.transports.file.resolvePathFn = () => ''
}

export const logger = log
