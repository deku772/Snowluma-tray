// 生成 electron-updater 所需的 latest.yml（portable 目标）
// 在 electron-builder 打包完成后运行：node generate-latest-yml.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const distDir = path.resolve(__dirname, '..', 'dist')
const exePath = path.join(distDir, 'SnowLumaTray.exe')
const pkgPath = path.join(__dirname, 'package.json')

if (!fs.existsSync(exePath)) {
  console.error('[generate-latest-yml] 未找到 SnowLumaTray.exe，请先运行 electron-builder')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const version = pkg.version
const buf = fs.readFileSync(exePath)
const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
const size = buf.length
const releaseDate = new Date().toISOString()

const yml = [
  `version: ${version}`,
  `files:`,
  `  - url: SnowLumaTray.exe`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: SnowLumaTray.exe`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ``,
].join('\n')

fs.writeFileSync(path.join(distDir, 'latest.yml'), yml, 'utf-8')
console.log(`[generate-latest-yml] 已生成 latest.yml (v${version}, ${size} bytes)`)
