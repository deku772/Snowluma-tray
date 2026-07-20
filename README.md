# SnowLuma Tray

为 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 打造的托盘管理工具，基于 Electron + TypeScript 开发。

## 功能特性

- **托盘管理**：最小化到系统托盘，一目了然运行状态
- **自动重启**：SnowLuma 意外退出后 5 秒自动恢复（最多 10 次）
- **多实例防护**：单例运行，避免重复启动
- **WebUI 快速访问**：双击托盘图标直接打开 `http://localhost:5099`
- **全局快捷键**：`Ctrl+Shift+S` 打开/隐藏主窗口
- **OTA 更新**：支持从 GitHub Releases 自动检查更新
- **版本显示**：菜单和 tooltip 同时显示托盘版和 SnowLuma 版

## 运行效果

```
🆔 SnowLuma  v1.12.6  ✅ 运行中
  托盘版本: v1.0.0
  SnowLuma: v1.12.6
  目录: D:\snowluma
━━━━━━━━━━━━━━━━━━━━━━
🌐 打开 WebUI
🔄 重启 SnowLuma
⏹️ 停止 SnowLuma
📥 检查更新
📁 打开 SnowLuma 目录
📁 打开日志目录
👁️ 显示窗口
❌ 退出
```

## 使用说明

### 前提

- 已安装 [SnowLuma](https://github.com/SnowLuma/SnowLuma)（版本 ≥ 1.12.6）
- SnowLuma 解压目录，例如 `D:\snowluma`

### 运行

下载 `SnowLumaTray.exe`（便携版，无需安装），直接运行即可。

首次运行会自动检测 SnowLuma 目录，若未找到会弹出目录选择窗口。

### 修改 WebUI 密码

首次运行 SnowLuma 会生成随机初始密码。修改密码：

```bash
python assets/reset_password.py <新密码>
# 例如：
python assets/reset_password.py QQCqqc123
```

> **注意**：SnowLuma 使用 scrypt 哈希密码，请勿使用其他哈希算法（如 PBKDF2）生成的 hash。

修改后重启 SnowLumaTray 使配置生效。

### 快捷操作

| 操作 | 方式 |
|------|------|
| 打开 WebUI | 双击托盘图标 或 右键菜单「打开 WebUI」 |
| 切换窗口 | `Ctrl+Shift+S` 或 右键菜单「显示/隐藏窗口」 |
| 重启 SnowLuma | 右键菜单「重启 SnowLuma」 |
| 退出程序 | 右键菜单「退出」 |

## 目录结构

```
SnowLumaTray/
├── src/
│   ├── main.ts              # Electron 主进程
│   ├── preload.ts           # IPC 预加载
│   ├── tray.ts              # 托盘 UI 管理
│   ├── snowluma-manager.ts  # SnowLuma 子进程管理
│   ├── logger.ts            # 日志模块（electron-log）
│   ├── assets/
│   │   ├── icon.png         # 托盘图标
│   │   └── reset_password.py # WebUI 密码重置工具
│   ├── package.json
│   └── tsconfig.json
├── dist/
│   └── SnowLumaTray.exe     # 打包产物（68 MB）
└── README.md
```

## 开发

```bash
cd src
npm install
npm run dev    # 开发模式（热重载）
npm run build  # 构建
```

## 构建发布包

```bash
cd src
npm run dist
```

产物位于 `dist/SnowLumaTray.exe`（便携版）。

## 相关项目

- [SnowLuma](https://github.com/SnowLuma/SnowLuma) — QQ 机器人框架（上游）
- [LuckyLilliaBot](https://github.com/deku772/LuckyLilliaBot) — 基于 Cordis 的 QQ 机器人

## License

MIT
