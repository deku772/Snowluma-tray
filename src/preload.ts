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
})
