# SnowLumaTray

> SnowLuma 系统托盘管理器 — 为 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 提供 Windows 系统托盘、常驻后台、崩溃自恢复能力。

## 概述

SnowLuma 本身是无窗口的 Node.js CLI 服务，需配合终端使用。SnowLumaTray 将其包装为 Windows 托盘应用，实现：

- 🔔 **系统托盘图标** — 状态一目了然
- 🔄 **崩溃自恢复** — 意外退出 5 秒后自动重启（最多 10 次）
- 🖥️ **隐藏后台运行** — 无窗口、无控制台，纯后台进程
- ⌨️ **全局快捷键** — `Ctrl+Shift+S` 显示/隐藏主窗口
- 📂 **一键操作** — 启动/停止/重启/查看日志/打开 WebUI

## 快速开始

### 下载使用（推荐）

1. 下载最新的 `SnowLumaTray.exe`
2. 将其放到 **SnowLuma 目录**（即 `index.mjs` 和 `node.exe` 所在目录），或放到任意目录
3. 双击运行，托盘图标出现即表示启动成功

> 如果找不到 SnowLuma，首次启动会弹出目录选择框，选择后自动记住路径。

### 从源码构建

```bash
# 克隆本仓库
git clone https://github.com/deku772/Snowluma-tray.git
cd Snowluma-tray/src

# 安装依赖
npm install

# 开发调试
npm run dev

# 构建便携版 exe
npm run dist
```

构建产物位于 `dist/SnowLumaTray.exe`。

## 项目结构

```
SnowLumaTray/
├── src/
│   ├── assets/             # 托盘图标（PNG）
│   ├── main.ts             # Electron 主进程入口
│   ├── tray.ts             # 系统托盘模块
│   ├── snowluma-manager.ts # SnowLuma 子进程管理器
│   ├── logger.ts           # 日志模块（electron-log）
│   ├── preload.ts          # IPC bridge（预留扩展）
│   ├── package.json        # 项目配置 + electron-builder
│   └── tsconfig.json       # TypeScript 配置
├── assets/
│   ├── icon.png            # 托盘图标源文件
│   └── make_icon.py        # 图标生成脚本（Python PIL）
├── dist/                   # 构建产物（gitignore）
│   └── SnowLumaTray.exe
└── README.md
```

## 功能详情

### 系统托盘

| 菜单项 | 说明 |
|--------|------|
| 🌐 打开 WebUI | 浏览器访问 `http://localhost:5099` |
| 🔄 重启 SnowLuma | 平滑重启子进程（自动停止后启动） |
| ▶️ 启动 SnowLuma | 手动启动（子进程已停止时可用） |
| ⏹️ 停止 SnowLuma | 手动停止子进程 |
| 📥 检查更新 | 预留功能（待实现） |
| 📁 打开日志目录 | 直接打开 `SnowLuma目录/logs` |
| ❌ 退出 | 关闭托盘并停止 SnowLuma |

### 托盘图标状态

| 状态 | 说明 |
|------|------|
| ❌ 已停止 | SnowLuma 子进程未运行 |
| 🔄 启动中... | 正在启动 |
| ✅ 运行中 | 正常工作中 |
| ⏳ 停止中... | 正在关闭 |
| ⚠️ 异常 | 子进程退出码非零 |

### 崩溃自恢复

当 SnowLuma 子进程意外退出（非主动停止），托盘管理器会在 **5 秒后**自动重启。如果反复崩溃（超过 10 次），停止自动恢复。

### 目录自动检测

首次启动时自动搜索以下位置：

1. `SnowLumaTray.exe` 同级目录
2. `D:\snowluma`
3. `C:\snowluma`
4. 用户主目录下的 `snowluma`
5. 如果都找不到，弹出窗口让用户手动选择

配置路径保存在 `%APPDATA%\snowluma-tray\config.json`。

## 配置

配置文件位于 `%APPDATA%\snowluma-tray/config.json`：

```json
{
  "snowlumaDir": "D:\\snowluma"
}
```

日志文件位于 `%APPDATA%\snowluma-tray/logs/`。

## 技术栈

- **Electron** ^31 — 跨平台桌面应用框架
- **electron-log** ^5 — 日志记录
- **electron-builder** ^24 — 打包为单文件 exe
- **TypeScript** ^5 — 类型安全

## 与上级仓库的关系

本项目为 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 的衍生工具，不修改上游源码，独立构建、独立发布。

> SnowLuma 是一个基于 OneBot 协议的 QQ 机器人框架，支持 HTTP/WebSocket 适配器，提供 WebUI 管理界面。

## License

MIT
