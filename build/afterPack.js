// 打包后、签名前的钩子。
//
// 问题背景：electron-builder 下载并解压的 Electron 框架在 macOS 上会携带
// 扩展属性 com.apple.FinderInfo 与 com.apple.fileprovider.fpfs#P（位于 .app 及
// 各 .framework / Helper .app 这些 *目录* 上）。开启 hardened runtime
// （--options runtime）时，codesign 会报：
//   "resource fork, Finder information, or similar detritus not allowed"
// 导致签名失败。普通的 `xattr -d` / `xattr -cr` 删不掉这类目录级属性，
// 但 `cp -R -X`（大写 X = 不拷贝扩展属性）复制时会自动剥离它们。
// 注：com.apple.provenance 会自动保留，但经验证它不影响 codesign，可忽略。
const { execSync } = require('child_process')

exports.default = async ({ appOutDir, packager }) => {
  // 该钩子只解决 macOS codesign 的扩展属性问题，Windows/Linux 上无意义，
  // 且 `cp -R -X`（BSD 选项）在 Windows 会直接报错刷屏，故直接跳过。
  if (process.platform !== 'darwin') return

  const appName = packager.appInfo.productFilename // 例如 "Snowball Pilot"
  const appPath = `${appOutDir}/${appName}.app`
  const tmpPath = `${appOutDir}/.__clean_${appName}.app`
  try {
    // 复制为剥离扩展属性的干净副本，再替换原包，供后续签名使用
    execSync(`cp -R -X "${appPath}" "${tmpPath}"`, { stdio: 'inherit' })
    execSync(`rm -rf "${appPath}"`, { stdio: 'inherit' })
    execSync(`mv "${tmpPath}" "${appPath}"`, { stdio: 'inherit' })
    // 二次保险：递归清除所有残留扩展属性（含 resource fork、provenance）
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' })
    // macOS 26+ 上 com.apple.provenance 可能无法被 -cr 清除，单独删除
    try {
      execSync(`xattr -dr com.apple.provenance "${appPath}"`, { stdio: 'pipe' })
    } catch (_) { /* 没有该属性则忽略 */ }
    console.log(`[afterPack] 已剥离 FinderInfo/fileprovider 扩展属性: ${appPath}`)
  } catch (e) {
    console.warn(`[afterPack] 拷贝剥离失败（退回原包）: ${e.message}`)
  }
}
