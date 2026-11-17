// 一键保存：把成稿写成一个普通文件夹，脚本、封面、配图和分镜都在里面。
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { byLang, currentLang, tr } from './i18n.js'
import { productionMarkdown, productionReadiness } from './content-output.js'

export function defaultExportDir() {
  // 已经有中文文件夹的老用户切到英文后继续用原来的文件夹
  const zh = join(homedir(), 'Documents', '自媒体工作台')
  if (currentLang() !== 'en' || existsSync(zh)) return zh
  return join(homedir(), 'Documents', 'Media Workbench')
}

export function resolveExportDir(value) {
  const dir = String(value ?? '').trim()
  if (!dir) return defaultExportDir()
  return dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir
}

function folderName(title) {
  const clean = String(title ?? '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60)
  return clean || tr('未命名')
}

function cell(text) {
  return String(text ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
}

/**
 * @param {object} production - 成稿。
 * @param {{filesDir: string, exportDir?: string, targetDir?: string, videoCover?: Buffer}} options - 素材目录、自动保存目录和合成好的视频封面。
 * @returns {Promise<{path: string, files: string[]}>} 文件夹路径和写入的文件名。
 */
export async function saveProduction(production, { filesDir, exportDir, targetDir, videoCover }) {
  if (['article', 'image_text'].includes(production.format)) return saveWrittenProduction(production, { filesDir, exportDir, targetDir })
  // 英文界面用纯 ASCII 文件名，方便在别的系统和工具里打开
  const en = currentLang() === 'en'
  const names = en
    ? { cover: 'cover-original', videoCover: 'video-cover.jpg', figure: i => `figure-${i}`, shot: n => `shot-${n}`, script: 'script.md', board: 'storyboard.md' }
    : { cover: '封面原图', videoCover: '视频封面.jpg', figure: i => `配图${i}`, shot: n => `分镜${n}`, script: '脚本.md', board: '分镜脚本.md' }
  const target = targetDir || production.savedPath || join(resolveExportDir(exportDir), folderName(production.title))
  await mkdir(target, { recursive: true })
  const files = []

  const copy = async (asset, name) => {
    const match = /^media-workbench\/(?:attachments|files)\/([\w.-]+)$/.exec(asset?.src ?? '')
    if (!match) return null
    const file = `${name}${extname(match[1])}`
    await copyFile(join(filesDir, match[1]), join(target, file))
    files.push(file)
    return file
  }

  const cover = await copy(production.cover, names.cover)
  if (videoCover) {
    await writeFile(join(target, names.videoCover), videoCover)
    files.push(names.videoCover)
  }
  const figures = []
  for (const [i, image] of (production.images ?? []).entries()) {
    figures.push({ image, file: await copy(image, names.figure(i + 1)) })
  }
  const shots = []
  for (const [i, shot] of (production.shots ?? []).entries()) {
    shots.push({ shot, file: await copy(shot, names.shot(String(i + 1).padStart(2, '0'))) })
  }

  // 配图放回对应小标题那一节的末尾
  const sections = String(production.article ?? '').split(/\n(?=##\s)/)
  const unplaced = []
  for (const { image, file } of figures) {
    if (!file) continue
    const line = `\n\n![${image.caption ?? ''}](${file})`
    const at = sections.findIndex(part => image.anchor && part.startsWith(`## ${image.anchor}`))
    if (at >= 0) sections[at] = `${sections[at].trimEnd()}${line}\n`
    else unplaced.push(line)
  }
  const article = `# ${production.title}\n\n${sections.join('\n')}${unplaced.join('')}\n`
  await writeFile(join(target, names.script), article)
  files.push(names.script)

  if (shots.length) {
    const seconds = value => (value === undefined || value === null ? '' : en ? `${value}s` : `${value} 秒`)
    const rows = shots.map(({ shot, file }, i) => `| ${i + 1} | ${cell(shot.shot)} | ${seconds(shot.seconds)} | ${cell(shot.visual)} | ${cell(shot.voice)} | ${file ? `![](${file})` : ''} |`)
    const heading = en ? `# ${production.title}: storyboard\n\n| Shot | Size | Length | Visual | Voice-over | Frame |` : `# ${production.title}：分镜头脚本\n\n| 镜号 | 景别 | 时长 | 画面 | 口播 | 分镜图 |`
    await writeFile(join(target, names.board), `${heading}\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`)
    files.push(names.board)
  }
  return { path: target, files }
}

async function saveWrittenProduction(production, { filesDir, exportDir, targetDir }) {
  const readiness = productionReadiness(production)
  if (!String(production.article ?? '').trim()) throw new Error(byLang('正文为空，暂时无法导出。', 'Write some content before exporting.'))
  if (readiness.busy) throw new Error(byLang('内容仍在生成，请等生成结束后再导出。', 'Content is still being generated. Export after it finishes.'))
  const en = currentLang() === 'en'
  const isImageText = production.format === 'image_text'
  const documentName = isImageText ? (en ? 'post.md' : '图文.md') : (en ? 'article.md' : '文章.md')
  const target = targetDir || production.savedPath || join(resolveExportDir(exportDir), folderName(production.title))
  const assets = [], figureFiles = new Map()
  const prepare = async (asset, label, basename, index) => {
    if (!asset?.src) return
    const match = /^media-workbench\/(?:attachments|files)\/([\w.-]+)$/.exec(asset.src)
    if (!match) throw new Error(byLang(`${label}尚未保存为本地附件，请先替换为本地图片再导出。`, `${label} is not a local attachment. Replace it with a local image before exporting.`))
    const source = join(filesDir, match[1])
    let info
    try { info = await stat(source) } catch (err) {
      if (err.code !== 'ENOENT') throw err
      throw new Error(byLang(`${label}的本地文件已丢失，请重新生成或替换后再导出。`, `${label}'s local file is missing. Regenerate or replace it before exporting.`))
    }
    if (!info.isFile()) throw new Error(byLang(`${label}不是可读取的图片文件。`, `${label} is not a readable image file.`))
    const file = `${basename}${extname(match[1])}`
    // Read all sources now, so a missing or unreadable later image cannot leave half an export.
    assets.push({ data: await readFile(source), file })
    if (index !== undefined) figureFiles.set(index, file)
  }
  // Validate every referenced asset before creating or overwriting any output files.
  await prepare(production.cover, en ? 'Cover' : '封面', en ? 'cover' : '封面')
  for (const [index, image] of (production.images ?? []).entries()) {
    const order = String(index + 1).padStart(2, '0')
    await prepare(image, en ? `Image ${index + 1}` : `第 ${index + 1} 张图`, isImageText ? (en ? `image-${order}` : `图片${order}`) : (en ? `figure-${order}` : `配图${order}`), index)
  }
  const warnings = []
  const planNotice = typeof production.planNotice === 'string' ? production.planNotice.trim() : ''
  if (planNotice) warnings.push(planNotice)
  if (readiness.textDraft) warnings.push(byLang('正文是结构草稿，请核对并修改后再使用。', 'The text is a fallback draft. Review and edit it before use.'))
  else if (!readiness.textReady) warnings.push(byLang('正文生成未完成，本次导出保留已有正文，请核对后再使用。', 'Text generation did not complete. This export retains the available text; review it before use.'))
  if (readiness.imagesMissing) warnings.push(byLang(`图片尚未齐全（${readiness.imagesDone}/${readiness.imagesTotal}），本次仅导出已有图片。`, `Images are incomplete (${readiness.imagesDone}/${readiness.imagesTotal}); only available images were exported.`))
  for (const [index, image] of (production.images ?? []).entries()) {
    if (image?.src && image.status && image.status !== 'done') warnings.push(byLang(`第 ${index + 1} 张图未生成成功，本次保留上一版图片，请核对后使用。`, `Image ${index + 1} did not finish generating. The previous image is included; review it before use.`))
  }
  const markdown = productionMarkdown(production, { imageSrc: (_, index) => figureFiles.get(index) })
  const notesName = en ? 'export-notes.txt' : '导出说明.txt'
  const files = assets.map(asset => asset.file)
  let existing = []
  try { existing = await readdir(target, { withFileTypes: true }) } catch (err) { if (err.code !== 'ENOENT') throw err }
  const expected = new Set([...files, documentName, notesName])
  for (const entry of existing) {
    if (expected.has(entry.name) && !entry.isFile()) throw new Error(byLang(`导出目标 ${entry.name} 不是普通文件，请先更名后再导出。`, `The export destination ${entry.name} is not a regular file. Rename it before exporting.`))
  }
  const previousFiles = existing.filter(entry => entry.isFile() && !expected.has(entry.name) && /^(?:(?:文章|图文|脚本|分镜脚本|article|post|script|storyboard)\.md|(?:导出说明|export-notes)\.txt|(?:配图\d+|图片\d+|分镜\d+|figure-\d+|image-\d+|shot-\d+|封面(?:原图)?|视频封面|cover(?:-original)?|video-cover)\.[a-z0-9]+)$/i.test(entry.name)).map(entry => entry.name).sort()
  if (previousFiles.length) warnings.push(byLang(`文件夹中保留了不属于本次版本的旧导出文件：${previousFiles.join('、')}。请按本次导出清单选取文件。`, `The folder retains previous export files that are not part of this version: ${previousFiles.join(', ')}. Use only the files listed in this export.`))
  await mkdir(target, { recursive: true })
  for (const asset of assets) await writeFile(join(target, asset.file), asset.data)
  await writeFile(join(target, documentName), markdown)
  files.push(documentName)
  // Always refresh the manifest so a later successful export does not retain an old missing-image warning.
  const notes = [
    en ? 'Exported files' : '本次导出文件',
    ...files.map(file => `- ${file}`),
    '',
    ...(warnings.length ? warnings : [en ? 'Requested text and images are complete.' : '正文和所需图片已齐全。']),
  ].join('\n') + '\n'
  await writeFile(join(target, notesName), notes)
  files.push(notesName)
  return { path: target, files, warnings }
}
