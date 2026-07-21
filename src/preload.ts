import { contextBridge, ipcRenderer } from 'electron'

// 暴露安全的 IPC 方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取 SnowLuma 当前状态
  getState: () => ipcRenderer.invoke('snowluma:getState'),
  // 启动
  start: () => ipcRenderer.invoke('snowluma:start'),
  // 停止
  stop: () => ipcRenderer.invoke('snowluma:stop'),
  // 重启
  restart: () => ipcRenderer.invoke('snowluma:restart'),
  // 获取目录
  getDir: () => ipcRenderer.invoke('snowluma:getDir'),
  // 监听状态变化
  onStateChanged: (callback: (state: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: string) => callback(state)
    ipcRenderer.on('snowluma:stateChanged', handler)
    return () => ipcRenderer.removeListener('snowluma:stateChanged', handler)
  },
  // 打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  // 获取版本
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ============================================
  // 引导页面 API
  // ============================================

  // 获取托盘版本
  getTrayVersion: () => ipcRenderer.invoke('guide:getTrayVersion'),

  // 选择目录
  selectDirectory: () => ipcRenderer.invoke('guide:selectDirectory'),

  // 获取最新 SnowLuma 版本
  getLatestSnowluma: () => ipcRenderer.invoke('guide:getLatestSnowluma'),

  // 下载 SnowLuma（带进度回调）
  downloadSnowluma: (url: string, onProgress: (pct: number) => void) => {
    ipcRenderer.on('guide:downloadProgress', (_event, pct) => onProgress(pct))
    return ipcRenderer.invoke('guide:downloadSnowluma', url)
  },

  // 解压
  extractSnowluma: () => ipcRenderer.invoke('guide:extractSnowluma'),

  // 设置目录并验证
  setSnowlumaDir: (dir: string) => ipcRenderer.invoke('guide:setSnowlumaDir', dir),

  // 启动 SnowLuma
  startSnowluma: (dir: string) => ipcRenderer.invoke('guide:startSnowluma', dir),
})
