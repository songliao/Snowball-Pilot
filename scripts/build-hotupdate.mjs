/**
 * 构建渲染层热更新包
 *
 * 用法：
 *   npm run build                       # 先产出 out/renderer
 *   node scripts/build-hotupdate.mjs    # 普通发布（hotIndex=0，随 Release 附带）
 *   HOTUPDATE_INDEX=1 node scripts/build-hotupdate.mjs   # 前端热修复包
 *   HOTUPDATE_NOTES="修复xx显示" node scripts/build-hotupdate.mjs
 *
 * 产物（dist/hot-update/）：
 *   renderer-<rendererVersion>.zip   压缩包根目录即渲染层（index.html + assets/），平台无关
 *   hot-update.json                  清单，客户端按 appVersion 匹配、按 hotIndex 判断新旧
 *
 * 发布：
 *   随正式 Release 发布 → CI 自动执行并上传（见 .github/workflows/release.yml）；
 *   只发前端热修复（不推新 tag）→ 把两个产物用
 *   `gh release upload v<version> dist/hot-update/* --clobber`
 *   追加到该版本对应的已有 Release 上即可（latest release 的清单会被客户端读到）。
 *
 * 约束：热更新包只允许包含渲染层产物；主进程 / preload / 原生依赖变更必须走全量更新。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const hotIndex = Number(process.env.HOTUPDATE_INDEX || 0)
if (!Number.isInteger(hotIndex) || hotIndex < 0) {
  console.error(`HOTUPDATE_INDEX 必须是非负整数，当前为 "${process.env.HOTUPDATE_INDEX}"`)
  process.exit(1)
}
const rendererVersion = hotIndex > 0 ? `${version}-hot.${hotIndex}` : version

const rendererDir = join(root, 'out', 'renderer')
const indexHtml = join(rendererDir, 'index.html')
if (!existsSync(indexHtml)) {
  console.error('未找到 out/renderer/index.html，请先执行 npm run build')
  process.exit(1)
}

const outDir = join(root, 'dist', 'hot-update')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 打 zip：条目位于压缩包根目录（index.html + assets/…），与 out/renderer 结构一致，
// 客户端解压后直接 loadFile其中的 index.html
const zip = new AdmZip()
const addDir = (dir, rel = '') => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const entry = rel ? `${rel}/${name}` : name
    if (statSync(full).isDirectory()) {
      addDir(full, entry)
    } else {
      zip.addLocalFile(full, rel)
    }
  }
}
addDir(rendererDir)
const zipName = `renderer-${rendererVersion}.zip`
const zipPath = join(outDir, zipName)
zip.writeZip(zipPath)

const buf = readFileSync(zipPath)
const entry = {
  appVersion: version,
  hotIndex,
  rendererVersion,
  url: zipName,
  sha512: createHash('sha512').update(buf).digest('hex'),
  size: buf.length,
  notes: process.env.HOTUPDATE_NOTES || undefined,
  publishedAt: new Date().toISOString()
}
writeFileSync(join(outDir, 'hot-update.json'), JSON.stringify({ entries: [entry] }, null, 2))

console.log(`热更新包构建完成 → dist/hot-update/`)
console.log(`  ${zipName}  ${(entry.size / 1024 / 1024).toFixed(2)} MB`)
console.log(`  hot-update.json  appVersion=${version} hotIndex=${hotIndex} rendererVersion=${rendererVersion}`)
if (hotIndex === 0) {
  console.log('（hotIndex=0 为随版本发布的基础包，客户端会跳过它，仅作占位与后续热修复的基线）')
}
