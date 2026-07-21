import { spawn, ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { app, Notification } from 'electron'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// SnowLuma 版本读取
// ----------------------------------------------------------------------------

/** 读取 SnowLuma 目录下的 package.json 获取版本 */
function readSnowlumaVersion(snowlumaDir: string): string {
  try {
    const pkgPath = path.join(snowlumaDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      return pkg.version ?? '未知'
    }
  } catch { /* ignore */ }
  return '未知'
}

// ---------------------------------------------------------------------------
// 目录自动检测 + 用户配置持久化
// ---------------------------------------------------------------------------

/** SnowLuma 特征文件（用于验证目录是否有效） */
const MARKER_FILES = ['index.mjs', 'node.exe']

/** 常见候选目录 */
const CANDIDATE_DIRS = [
  // 托盘 exe 所在目录的父目录（Portable exe 在 dist/win-unpacked/）
  path.join(path.dirname(path.dirname(app.getPath('exe'))), '..', '..', '..'),
  // 托盘 exe 同级
  path.join(path.dirname(app.getPath('exe')), '..'),
  // 默认安装目录
  'D:\\snowluma',
  'C:\\snowluma',
  path.join(app.getPath('home'), 'snowluma'),
]

/** 归一化路径（去除末尾分隔符、转为绝对路径） */
function normalizeDir(p: string): string {
  return path.resolve(p.replace(/[\\/]+$/, ''))
}

/** 检查目录是否有效（包含特征文件） */
function isValidSnowlumaDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return false
  return MARKER_FILES.every(f => fs.existsSync(path.join(dir, f)))
}

/** 遍历候选目录，返回第一个有效目录 */
function detectSnowlumaDir(): string | null {
  const seen = new Set<string>()
  for (const raw of CANDIDATE_DIRS) {
    const dir = normalizeDir(raw)
    if (seen.has(dir)) continue
    seen.add(dir)
    if (isValidSnowlumaDir(dir)) {
      logger.info(`自动检测到 SnowLuma 目录: ${dir}`)
      return dir
    }
  }
  return null
}

/** 加载用户保存的配置 */
function loadConfig(): { snowlumaDir?: string } {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

/** 保存配置到文件 */
function saveConfig(snowlumaDir: string) {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ snowlumaDir }, null, 2), 'utf-8')
    logger.info(`配置已保存: ${configPath}`)
  } catch (e) {
    logger.error('保存配置失败:', e)
  }
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

export type SnowlumaState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export class SnowlumaManager extends EventEmitter {
  private process: ChildProcess | null = null
  private _state: SnowlumaState = 'stopped'
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttempt = 0
  private maxRestartAttempts = 10
  private snowlumaDir: string | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private _snowlumaVersion: string = '未知'

  get state(): SnowlumaState {
    return this._state
  }

  get snowlumaProcess(): ChildProcess | null {
    return this.process
  }

  get snowlumaVersion(): string {
    return this._snowlumaVersion
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------

  /** 检测或选择目录，然后启动 */
  async detectAndStart(): Promise<boolean> {
    const dir = this.resolveDir()
    if (!dir) {
      logger.error('未找到有效的 SnowLuma 目录')
      this._state = 'error'
      this.emitState()
      return false
    }
    return this.start()
  }

  private resolveDir(): string | null {
    if (this.snowlumaDir) return this.snowlumaDir

    const config = loadConfig()
    if (config.snowlumaDir && isValidSnowlumaDir(config.snowlumaDir)) {
      this.snowlumaDir = config.snowlumaDir
      this._snowlumaVersion = readSnowlumaVersion(this.snowlumaDir)
      return this.snowlumaDir
    }

    const detected = detectSnowlumaDir()
    if (detected) {
      this.snowlumaDir = detected
      this._snowlumaVersion = readSnowlumaVersion(detected)
      saveConfig(detected)
      return detected
    }

    return null
  }

  /** 获取当前目录（供 UI 显示） */
  getCurrentDir(): string | null {
    return this.snowlumaDir
  }

  /** 设置目录并保存 */
  setDir(dir: string) {
    if (!isValidSnowlumaDir(dir)) {
      logger.error(`无效的 SnowLuma 目录: ${dir}`)
      return false
    }
    this.snowlumaDir = dir
    this._snowlumaVersion = readSnowlumaVersion(dir)
    saveConfig(dir)
    logger.info(`目录已设置为: ${dir}`)
    return true
  }

  start(): boolean {
    if (this._state === 'running' || this._state === 'starting') {
      logger.warn('SnowLuma 已在运行或启动中')
      return false
    }

    const dir = this.resolveDir()
    if (!dir) {
      logger.error('SnowLuma 目录无效')
      this._state = 'error'
      this.emitState()
      return false
    }

    logger.info(`正在启动 SnowLuma，目录: ${dir}`)
    this._state = 'starting'
    this.emitState()

    try {
      this.process = spawn(
        path.join(dir, 'node.exe'),
        [path.join(dir, 'index.mjs')],
        {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: false,
          env: { ...process.env, SNOWLUMA_DIR: dir },
        }
      )

      const proc = this.process

      proc.on('error', (err) => {
        logger.error('SnowLuma 进程错误:', err.message)
        this.handleExit(1)
      })

      proc.on('exit', (code, signal) => {
        logger.info(`SnowLuma 进程退出: code=${code} signal=${signal}`)
        this.handleExit(code ?? 1)
      })

      // 捕获 stdout（用于日志，但不影响主进程）
      proc.stdout?.on('data', (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString()
        const lines = this.stdoutBuffer.split('\n')
        this.stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) logger.info(`[SnowLuma] ${line.trim()}`)
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim()
        if (msg) logger.warn(`[SnowLuma ERR] ${msg}`)
      })

      // 等待启动确认（检查进程是否持续运行）
      setTimeout(() => {
        if (this._state === 'starting' && this.process?.pid) {
          try {
            process.kill(this.process.pid, 0) // 检查进程是否存在
            this._state = 'running'
            this.restartAttempt = 0
            logger.info('SnowLuma 启动成功')
            this.emitState()
            this.notify('SnowLuma 已启动', '后台服务正在运行')
          } catch {
            // 进程已退出
          }
        }
      }, 3000)

      return true
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('启动 SnowLuma 失败:', message)
      this._state = 'error'
      this.emitState()
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // 停止
  // ---------------------------------------------------------------------------

  stop(): boolean {
    if (this._state !== 'running' && this._state !== 'error') {
      logger.warn(`停止操作被忽略，当前状态: ${this._state}`)
      return false
    }

    logger.info('正在停止 SnowLuma...')
    this._state = 'stopping'
    this.emitState()

    // 清除重启定时器
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    const pid = this.process?.pid
    if (pid) {
      try {
        // 先尝试 SIGTERM
        process.kill(pid, 'SIGTERM')
        // 等待最多 5 秒后强制 kill
        setTimeout(() => {
          try {
            process.kill(pid, 0) // still alive?
            process.kill(pid, 'SIGKILL')
            logger.info('已强制终止 SnowLuma 进程')
          } catch {
            // 进程已退出
          }
        }, 5000)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('发送终止信号失败:', msg)
      }
    }

    // 立即设置为 stopped（等待 exit 事件清理 process 引用）
    this._state = 'stopped'
    return true
  }

  restart(): boolean {
    logger.info('执行重启操作')
    const wasRunning = this._state === 'running'
    this.stop()
    if (wasRunning || this._state === 'stopped') {
      setTimeout(() => this.start(), 1000)
    }
    return true
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private handleExit(code: number) {
    if (this._state === 'stopping' || this._state === 'stopped') {
      this.process = null
      return
    }

    this.process = null
    this._state = code === 0 ? 'stopped' : 'error'

    if (code !== 0) {
      this.restartAttempt++
      logger.warn(`SnowLuma 异常退出 (attempt ${this.restartAttempt}/${this.maxRestartAttempts}), 5秒后重启...`)
      this.emitState()
      this.notify('SnowLuma 异常', `退出码 ${code}，正在重启...`)

      if (this.restartAttempt <= this.maxRestartAttempts) {
        this.restartTimer = setTimeout(() => {
          this._state = 'stopped'
          this.start()
        }, 5000)
      } else {
        logger.error('重启次数超过上限，停止自动恢复')
        this._state = 'error'
        this.emitState()
      }
    } else {
      this._state = 'stopped'
      this.emitState()
    }
  }

  private emitState() {
    this.emit('stateChanged', this._state)
  }

  private notify(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  }
}
