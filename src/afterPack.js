#!/usr/bin/env node
/**
 * afterPack hook: 移除不需要的 Electron 文件
 */
const fs = require('fs')
const path = require('path')

module.exports = async function(context) {
  const appDir = context.appOutDir
  
  // 移除不需要的 DLL（保留 ffmpeg.dll - Electron 运行时需要）
  const removeFiles = [
    'vk_swiftshader.dll',
    'vulkan-1.dll',
    'd3dcompiler_47.dll',
    'vk_swiftshader_icd.json',
    'LICENSES.chromium.html',
  ]
  
  for (const file of removeFiles) {
    const filePath = path.join(appDir, file)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`Removed: ${file}`)
    }
  }
  
  // 只保留中文和英文 locale
  const localesDir = path.join(appDir, 'locales')
  if (fs.existsSync(localesDir)) {
    const keepLocales = ['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']
    const files = fs.readdirSync(localesDir)
    for (const file of files) {
      if (!keepLocales.includes(file)) {
        fs.unlinkSync(path.join(localesDir, file))
        console.log(`Removed locale: ${file}`)
      }
    }
  }
  
  console.log('afterPack: cleanup complete')
}
