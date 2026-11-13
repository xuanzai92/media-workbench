// 工作台内容的 Markdown 投影：把 state.json 中的灵感和成稿写成 Obsidian 可读的文件。
// state.json 仍然是运行状态的来源，这个模块只负责幂等地更新用户可见文件。
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const INSPIRATION_DIR = '灵感'
const CONTENT_DIR = '内容'
const EXTERNAL_DIR = '外部采集'
const STATUSES = new Set(['idea', 'outline', 'draft', 'ready', 'published', 'archived'])
const KINDS = new Set(['image', 'video', 'web', 'quote', 'note'])
const INSPIRATION_FRONTMATTER_KEYS = new Set([
  'id', 'type', 'kind', 'title', 'created_at', 'updated_at', 'status',
  'source', 'source_url', 'platform', 'scheduled_at', 'tags',
])
const CONTENT_FRONTMATTER_KEYS = new Set([
  'id', 'type', 'title', 'format', 'created_at', 'updated_at', 'status',
  'production_status', 'source_ids', 'platform', 'scheduled_at', 'tags',
])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function iso(value, fallback = new Date().toISOString()) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return fallback
}

function scalar(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  if ((raw.startsWith('"') && raw.endsWith('"')) || raw.startsWith('[') || raw.startsWith('{')) {
    try { return JSON.parse(raw) } catch { /* keep the original text */ }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'")
  return raw
}

/** 读取本模块生成的简单 YAML frontmatter，也接受第三方插件写的同类字段。 */
export function parseFrontmatter(source) {
  const textSource = String(source ?? '').replace(/^\uFEFF/, '')
  if (!/^---\s*\r?\n/.test(textSource)) return { fields: {}, body: textSource }
  const closing = /(?:^|\n)---\s*(?:\r?\n|$)/.exec(textSource.slice(4))
  if (!closing) return { fields: {}, body: textSource }
  const end = 4 + closing.index + (closing[0].startsWith('\n') ? 1 : 0)
  const headerEnd = 4 + closing.index + closing[0].length
  const header = textSource.slice(textSource.indexOf('\n') + 1, end).replace(/\r/g, '')
  const body = textSource.slice(headerEnd).replace(/^\n/, '')
  const fields = {}
  const lines = header.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([^:\s][^:]*):(?:\s*(.*))?$/.exec(lines[index])
    if (!match) continue
    const key = match[1].trim()
    const raw = match[2] ?? ''
    if (!raw) {
      const list = []
      while (index + 1 < lines.length) {
        const row = /^\s+-\s*(.*)$/.exec(lines[index + 1])
        if (!row) break
        list.push(scalar(row[1]))
        index += 1
      }
      fields[key] = list.length ? list : null
    } else fields[key] = scalar(raw)
  }
  return { fields, body }
}

function inspirationBody(body) {
  let value = String(body ?? '').replace(/^\s+|\s+$/g, '')
  value = value.replace(/^#\s+[^\n]*(?:\n|$)/, '').trim()
  // 这是 exporter 生成的附属区块，避免同步后重复嵌套到正文。
  // 只移除末尾的已知来源行，保留插件或用户添加的其他 Markdown 区块。
  value = value.replace(/\n##\s+来源\s*\n(?:来源：[^\n]*\n)?(?:原文：[^\n]*\n)?(?:!\[[^\]]*\]\([^)]*\)\s*\n?)?\s*$/i, '').trim()
  return value
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 24) : []
}

function stableMarkdownId(root, path, prefix) {
  const key = relative(root, path).split(sep).join('/')
  return `${prefix}_local_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`
}

async function markdownFilesUnder(root) {
  const files = []
  async function visit(dir) {
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path)
    }
  }
  await visit(root)
  return files
}

function firstString(value) {
  return Array.isArray(value) ? text(value[0]) : text(value)
}

function topicKind(value) {
  const kind = firstString(value).toLowerCase()
  if (kind.includes('video')) return 'video'
  if (kind.includes('image') || kind.includes('图文')) return 'image'
  if (kind.includes('quote') || kind.includes('观点')) return 'quote'
  if (kind.includes('web') || kind.includes('article') || kind.includes('文章')) return 'web'
  return 'note'
}

function importedInspiration(fields, body, fallbackNow, { id: fallbackId = '', title: fallbackTitle = '', source: fallbackSource = '' } = {}) {
  const id = text(fields.id) || fallbackId
  if (!id) return null
  const createdAt = iso(fields.created_at, fallbackNow)
  const updatedAt = iso(fields.updated_at, createdAt)
  const status = STATUSES.has(fields.status) ? fields.status : 'idea'
  const kind = KINDS.has(fields.kind) ? fields.kind : topicKind(fields.type)
  const markdownMeta = Object.fromEntries(Object.entries(fields).filter(([key]) => !INSPIRATION_FRONTMATTER_KEYS.has(key)))
  return {
    id,
    kind: KINDS.has(kind) ? kind : 'note',
    title: text(fields.title) || headingTitle(body) || fallbackTitle || '未命名灵感',
    body: inspirationBody(body),
    tags: arrayOfStrings(fields.tags),
    status,
    source: text(fields.source) || fallbackSource,
    url: typeof fields.source_url === 'string' ? fields.source_url : null,
    platform: typeof fields.platform === 'string' ? fields.platform : firstString(fields['发布渠道']) || null,
    scheduledAt: typeof fields.scheduled_at === 'string' ? fields.scheduled_at : iso(fields['发布时间'], '') || null,
    createdAt,
    updatedAt,
    markdownMeta,
  }
}

function headingTitle(body) {
  return text(/^#\s+([^\n]*)/.exec(String(body ?? '').trim())?.[1])
}

/** 只取内容正文，保留由工作台生成的封面、配图、分镜和来源区块。 */
function contentArticle(body) {
  const lines = String(body ?? '').replace(/^\s+|\s+$/g, '').split('\n')
  if (lines[0] && /^#\s+/.test(lines[0])) lines.shift()
  const end = lines.findIndex(line => /^##\s+(?:封面|配图|分镜脚本|来源灵感)\s*$/i.test(line.trim()))
  return lines.slice(0, end < 0 ? lines.length : end).join('\n').trim()
}

function importedContent(fields, body, fallbackNow) {
  const id = text(fields.id)
  if (!id) return null
  const createdAt = iso(fields.created_at, fallbackNow)
  const updatedAt = iso(fields.updated_at, createdAt)
  const status = STATUSES.has(fields.status) ? fields.status : 'draft'
  const title = text(fields.title) || headingTitle(body) || '未命名内容'
  const productionStatus = text(fields.production_status)
  const markdownMeta = Object.fromEntries(Object.entries(fields).filter(([key]) => !CONTENT_FRONTMATTER_KEYS.has(key)))
  return {
    id,
    title,
    article: contentArticle(body),
    format: text(fields.format) || 'video',
    sourceIds: arrayOfStrings(fields.source_ids),
    status,
    productionStatus: productionStatus || null,
    platform: typeof fields.platform === 'string' ? fields.platform : null,
    scheduledAt: typeof fields.scheduled_at === 'string' ? fields.scheduled_at : null,
    createdAt,
    updatedAt,
    markdownMeta,
  }
}

/** 保留中文和常用标点，去掉会破坏本地文件路径的字符。 */
export function safeFilePart(value, fallback = '未命名') {
  const clean = String(value ?? '')
    .replace(/[\\/:*?"<>|\[\]()\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 80)
  return clean || fallback
}

function yaml(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

function yamlList(values) {
  const list = Array.isArray(values) ? values.filter(value => value !== null && value !== undefined && String(value).trim()) : []
  if (!list.length) return '[]'
  return `\n${list.map(value => `  - ${yaml(value)}`).join('\n')}`
}

function frontmatter(fields) {
  const rows = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) rows.push(`${key}:${yamlList(value)}`)
    else rows.push(`${key}: ${yaml(value)}`)
  }
  rows.push('---', '')
  return `${rows.join('\n')}\n`
}

function markdownPath(root, kind, id) {
  return kind === 'inspiration' ? join(root, INSPIRATION_DIR, `${safeFilePart(id, 'inspiration')}.md`) : join(root, CONTENT_DIR, safeFilePart(id, 'content'), '内容.md')
}

function relativeMediaLink(root, filePath, src) {
  const value = text(src)
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const match = /^media-workbench\/(attachments|files|assets)\/([\w.-]+)$/.exec(value)
  if (!match) return null
  const directory = match[1] === 'attachments' || match[1] === 'files' ? 'attachments' : 'assets'
  return relative(dirname(filePath), join(root, directory, match[2])).split(sep).join('/')
}

function mediaLink(root, filePath, src, label = '媒体') {
  const href = relativeMediaLink(root, filePath, src)
  if (!href) return ''
  const ext = /\.([a-z0-9]+)$/i.exec(href)?.[1]?.toLowerCase()
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return `[${label}](${href})`
  return `![${label}](${href})`
}

function sourceLinks(root, filePath, sourceIds, state) {
  const byId = new Map((state?.items ?? []).map(item => [item.id, item]))
  const inspirationDir = join(root, INSPIRATION_DIR)
  return (Array.isArray(sourceIds) ? sourceIds : []).map(id => {
    const source = byId.get(id)
    const name = safeFilePart(source?.title || id)
    const href = relative(dirname(filePath), join(inspirationDir, `${safeFilePart(id, 'inspiration')}.md`)).split(sep).join('/')
    return `- [${name}](${href})`
  }).join('\n')
}

function inspirationFields(item, updatedAt) {
  return {
    ...(item.markdownMeta && typeof item.markdownMeta === 'object' ? item.markdownMeta : {}),
    id: item.id,
    type: 'inspiration',
    kind: item.kind ?? 'note',
    title: item.title ?? '',
    created_at: iso(item.createdAt, updatedAt),
    updated_at: updatedAt,
    status: item.status ?? 'idea',
    source: item.source ?? '',
    source_url: item.url ?? null,
    platform: item.platform ?? null,
    scheduled_at: item.scheduledAt ?? null,
    tags: item.tags ?? [],
  }
}

function contentFields(item, production, sourceIds, updatedAt) {
  return {
    ...(production?.markdownMeta && typeof production.markdownMeta === 'object' ? production.markdownMeta : {}),
    id: item.id,
    type: 'content',
    title: production?.title || item.title || '',
    format: production?.format || 'video',
    created_at: iso(item.createdAt, updatedAt),
    updated_at: updatedAt,
    status: item.status ?? production?.status ?? 'draft',
    production_status: production?.status ?? null,
    source_ids: sourceIds,
    platform: item.platform ?? null,
    scheduled_at: item.scheduledAt ?? null,
    tags: item.tags ?? [],
  }
}

/** 写入单条灵感 Markdown，并返回文件路径。 */
export async function writeInspirationMarkdown(root, item, { now = new Date().toISOString() } = {}) {
  if (!item || typeof item.id !== 'string' || !item.id) return null
  const path = markdownPath(root, 'inspiration', item.id)
  await mkdir(dirname(path), { recursive: true })
  const updatedAt = iso(item.updatedAt ?? now)
  const media = item.media ? mediaLink(root, path, item.media.src, item.kind === 'video' ? '视频' : '图片') : ''
  const body = [
    frontmatter(inspirationFields(item, updatedAt)),
    `# ${text(item.title) || '未命名灵感'}`,
    '',
    text(item.body),
    item.source || item.url || media ? ['', '## 来源', item.source ? `来源：${item.source}` : '', item.url ? `原文：${item.url}` : '', media].filter(Boolean).join('\n') : '',
  ].filter(Boolean).join('\n\n').trimEnd() + '\n'
  await atomicWrite(path, body)
  return path
}

function storyboard(root, production, path) {
  const shots = Array.isArray(production?.shots) ? production.shots : []
  if (!shots.length) return ''
  const rows = shots.map((shot, index) => {
    const visual = String(shot.visual ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
    const voice = String(shot.voice ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
    const shotType = String(shot.shot ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
    const seconds = shot.seconds === undefined || shot.seconds === null ? '' : `${shot.seconds} 秒`
    const image = mediaLink(root, path, shot.src, `第 ${index + 1} 镜`)
    return `| ${index + 1} | ${shotType} | ${visual} | ${voice} | ${seconds} | ${image} |`
  })
  return `## 分镜脚本\n\n| 镜号 | 景别 | 画面 | 口播 | 时长 | 画面文件 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}`
}

/** 写入一条成稿或合并成稿 Markdown，并返回主文件路径。 */
export async function writeContentMarkdown(root, item, state, { now = new Date().toISOString() } = {}) {
  if (!item || typeof item.id !== 'string' || !item.id || !item.production) return null
  const production = item.production
  const path = markdownPath(root, 'content', item.id)
  await mkdir(dirname(path), { recursive: true })
  const updatedAt = iso(item.updatedAt ?? production.updatedAt ?? production.finishedAt ?? now)
  const sourceIds = [...new Set((production.sourceIds ?? item.sourceIds ?? []).filter(Boolean))]
  const cover = mediaLink(root, path, production.cover?.src, '封面')
  const images = (production.images ?? []).map((image, index) => mediaLink(root, path, image?.src, image?.caption || `配图 ${index + 1}`)).filter(Boolean)
  const links = sourceLinks(root, path, sourceIds, state)
  const sections = [
    frontmatter(contentFields(item, production, sourceIds, updatedAt)),
    `# ${text(production.title) || text(item.title) || '未命名内容'}`,
    text(production.article),
    cover ? `## 封面\n\n${cover}` : '',
    images.length ? `## 配图\n\n${images.join('\n\n')}` : '',
    storyboard(root, production, path),
    links ? `## 来源灵感\n\n${links}` : '',
  ].filter(Boolean)
  await atomicWrite(path, `${sections.join('\n\n').trimEnd()}\n`)
  return path
}

/** 把当前状态投影到灵感/和内容/；不会删除用户已经存在的 Markdown。外部采集由导入流程单独整理。 */
export async function syncMarkdown(root, state, options = {}) {
  await ensureMarkdownDirs(root)
  const written = []
  for (const item of state?.items ?? []) {
    if (item?.sample && options.includeSamples !== true) continue
    const inspiration = await writeInspirationMarkdown(root, item, options)
    if (inspiration) written.push(inspiration)
    if (item.production) {
      const content = await writeContentMarkdown(root, item, state, options)
      if (content) written.push(content)
    }
  }
  for (const item of state?.mergedDrafts ?? []) {
    if (item?.sample && options.includeSamples !== true) continue
    if (!item.production) continue
    const content = await writeContentMarkdown(root, item, state, options)
    if (content) written.push(content)
  }
  return written
}

/**
 * 把本次导入的外部采集写成正式灵感文件，再删除外部采集源文件。
 *
 * importMarkdown 只负责读取和合并状态；Host 应在状态持久化并完成一次投影后调用
 * 这里，确保写入灵感失败时仍会保留原始采集文件，下一次同步可以重试。
 */
export async function organizeExternalMarkdown(root, externalFiles, state, options = {}) {
  const organized = []
  const errors = []
  const seen = new Set()
  const externalRoot = resolve(root, EXTERNAL_DIR)
  const items = Array.isArray(state?.items) ? state.items : []
  for (const record of Array.isArray(externalFiles) ? externalFiles : []) {
    const sourcePath = typeof record === 'string' ? record : record?.path
    const id = typeof record === 'string' ? '' : text(record?.id)
    if (!sourcePath || seen.has(sourcePath)) continue
    seen.add(sourcePath)
    const source = resolve(sourcePath)
    if (!(source === externalRoot || source.startsWith(`${externalRoot}${sep}`))) {
      errors.push(`${relative(root, sourcePath).split(sep).join('/')}: 外部采集文件路径无效`)
      continue
    }
    const item = items.find(row => row?.id === id)
    if (!item) {
      errors.push(`${relative(root, sourcePath).split(sep).join('/')}: 找不到对应灵感`)
      continue
    }
    try {
      const target = await writeInspirationMarkdown(root, item, options)
      if (!target) throw new Error('无法写入灵感 Markdown')
      // 先写入规范化灵感，再删除原始采集，避免失败时丢失唯一来源。
      await rm(source, { force: true })
      organized.push({ id: item.id, source: relative(root, source).split(sep).join('/'), target: relative(root, target).split(sep).join('/') })
    } catch (err) {
      errors.push(`${relative(root, sourcePath).split(sep).join('/')}: ${err.message || String(err)}`)
    }
  }
  return { organized, errors }
}

/** 工作台一旦选定根目录就准备好两个用户可见目录，即使当前还没有内容。 */
export async function ensureMarkdownDirs(root) {
  await Promise.all([
    mkdir(join(root, INSPIRATION_DIR), { recursive: true }),
    mkdir(join(root, CONTENT_DIR), { recursive: true }),
    mkdir(join(root, EXTERNAL_DIR), { recursive: true }),
  ])
}

/** 删除工作台记录对应的用户可见 Markdown。媒体文件仍由状态/成稿删除逻辑单独管理。 */
export async function removeMarkdown(root, { inspirationIds = [], contentIds = [] } = {}) {
  const removed = []
  for (const id of new Set((Array.isArray(inspirationIds) ? inspirationIds : []).filter(value => typeof value === 'string' && value))) {
    const path = markdownPath(root, 'inspiration', id)
    await rm(path, { force: true })
    removed.push(path)
  }
  for (const id of new Set((Array.isArray(contentIds) ? contentIds : []).filter(value => typeof value === 'string' && value))) {
    const path = join(root, CONTENT_DIR, safeFilePart(id, 'content'))
    await rm(path, { recursive: true, force: true })
    removed.push(path)
  }
  return removed
}

/**
 * 把灵感、外部采集、内容选题和内容目录中的 Markdown 导入现有状态。
 * 带 id 的文件沿用原 id；已有 vault 文件没有 id 时按相对路径生成稳定 id。
 * 灵感和兼容目录原文件保持不动；外部采集文件会先记录在 externalFiles，待 Host 持久化后整理到灵感目录。
 */
export async function importMarkdown(root, state, { now = new Date().toISOString() } = {}) {
  const result = { state, imported: 0, updated: 0, skipped: 0, skippedFiles: [], errors: [], externalFiles: [] }
  const skip = (path, reason) => {
    result.skipped += 1
    if (result.skippedFiles.length < 24) result.skippedFiles.push(`${relative(root, path).split(sep).join('/')}: ${reason}`)
  }
  const dir = join(root, INSPIRATION_DIR)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') entries = []
    else throw err
  }
  state.items ??= []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md') || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    try {
      const source = await readFile(path, 'utf8')
      const { fields, body } = parseFrontmatter(source)
      if (fields.type && fields.type !== 'inspiration') {
        skip(path, 'type 不是 inspiration')
        continue
      }
      const next = importedInspiration(fields, body, now)
      if (!next) {
        skip(path, '缺少可用的 id')
        continue
      }
      const existing = state.items.find(item => item.id === next.id)
      if (!existing) {
        state.items.unshift({ ...next, personaIds: [], drafts: {}, importedFromMarkdown: true })
        result.imported += 1
        continue
      }
      const before = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
      Object.assign(existing, next, { importedFromMarkdown: true })
      if (!existing.externalId) delete existing.imported
      const after = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
      if (before === after) result.skipped += 1
      else result.updated += 1
    } catch (err) {
      result.errors.push(`${entry.name}: ${err.message || String(err)}`)
    }
  }

  // 兼容已有 Obsidian vault 的“内容选题/作者/标题.md”结构。
  // 只导入作者子目录里的 Markdown，根目录的汇总和模板不作为灵感，原文件保持不动。
  const topicsRoot = join(root, '内容选题')
  const topicFiles = (await markdownFilesUnder(topicsRoot)).filter(path => {
    const rel = relative(topicsRoot, path).split(sep)
    const name = rel.at(-1) || ''
    return rel.length > 1 && !/(汇总|模板)/.test(name)
  })
  for (const path of topicFiles) {
    try {
      const source = await readFile(path, 'utf8')
      const { fields, body } = parseFrontmatter(source)
      const rel = relative(topicsRoot, path).split(sep)
      const author = rel.length > 1 ? rel[rel.length - 2] : ''
      const next = importedInspiration(fields, body, now, {
        id: stableMarkdownId(root, path, 'it'),
        title: rel.at(-1).replace(/\.md$/i, ''),
        source: author ? `内容选题 · ${author}` : '内容选题',
      })
      if (!next) {
        skip(path, '缺少可用的 id')
        continue
      }
      const existing = state.items.find(item => item.id === next.id)
      if (!existing) {
        state.items.unshift({ ...next, personaIds: [], drafts: {}, importedFromMarkdown: true })
        result.imported += 1
        continue
      }
      const before = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
      Object.assign(existing, next, { importedFromMarkdown: true })
      if (!existing.externalId) delete existing.imported
      const after = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
      if (before === after) result.skipped += 1
      else result.updated += 1
    } catch (err) {
      result.errors.push(`${relative(root, path).split(sep).join('/')}: ${err.message || String(err)}`)
    }
  }

  // 外部采集是只读输入队列：所有 Markdown 都按灵感导入，成功持久化后由
  // organizeExternalMarkdown 写入“灵感”并移除原始文件。这样读取失败或写入失败时
  // 原文件仍在“外部采集”中，可以在下一次同步重试。
  const externalRoot = join(root, EXTERNAL_DIR)
  const externalFiles = await markdownFilesUnder(externalRoot)
  for (const path of externalFiles) {
    try {
      const source = await readFile(path, 'utf8')
      const { fields, body } = parseFrontmatter(source)
      const rel = relative(externalRoot, path).split(sep)
      const fallbackTitle = rel.at(-1)?.replace(/\.md$/i, '') || '未命名灵感'
      const next = importedInspiration(fields, body, now, {
        id: text(fields.id) || stableMarkdownId(root, path, 'it_external'),
        title: fallbackTitle,
        source: '外部采集',
      })
      if (!next) {
        skip(path, '无法识别为灵感')
        continue
      }
      next.markdownMeta = { ...(next.markdownMeta ?? {}), external_capture: true }
      const existing = state.items.find(item => item.id === next.id)
      if (!existing) {
        state.items.unshift({ ...next, personaIds: [], drafts: {}, importedFromMarkdown: true, importedFromExternal: true })
        result.imported += 1
      } else {
        const before = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
        Object.assign(existing, next, { importedFromMarkdown: true, importedFromExternal: true })
        const after = JSON.stringify({ kind: existing.kind, title: existing.title, body: existing.body, tags: existing.tags, status: existing.status, source: existing.source, url: existing.url, platform: existing.platform, scheduledAt: existing.scheduledAt, markdownMeta: existing.markdownMeta })
        if (before === after) result.skipped += 1
        else result.updated += 1
      }
      result.externalFiles.push({ path, id: next.id })
    } catch (err) {
      result.errors.push(`${relative(root, path).split(sep).join('/')}: ${err.message || String(err)}`)
    }
  }

  // 内容 Markdown 由“内容/<稳定 ID>/内容.md”投影生成；也接受内容/下的普通 Markdown，
  // 现有封面、配图、分镜等运行态字段原样保留，避免 Obsidian 编辑正文后丢媒体。
  const contentRoot = join(root, CONTENT_DIR)
  let contentEntries
  try {
    contentEntries = await readdir(contentRoot, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return result
    throw err
  }
  state.mergedDrafts ??= []
  const contentPaths = contentEntries.flatMap(entry => {
    if (entry.name.startsWith('.')) return []
    if (entry.isDirectory()) return [join(contentRoot, entry.name, '内容.md')]
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [join(contentRoot, entry.name)] : []
  })
  // 直接放在内容/下的外部文件作为来源，最后处理，避免第一次投影出的内容/<id>/内容.md 覆盖它。
  contentPaths.sort((a, b) => {
    const aDirect = dirname(a) === contentRoot
    const bDirect = dirname(b) === contentRoot
    return Number(aDirect) - Number(bDirect)
  })
  for (const path of contentPaths) {
    try {
      const source = await readFile(path, 'utf8')
      const { fields, body } = parseFrontmatter(source)
      if (fields.type && fields.type !== 'content') {
        skip(path, 'type 不是 content')
        continue
      }
      const next = importedContent({ ...fields, id: text(fields.id) || stableMarkdownId(root, path, 'md') }, body, now)
      if (!next) {
        skip(path, '缺少可用的 id')
        continue
      }
      const existing = state.mergedDrafts.find(item => item.id === next.id) ?? state.items.find(item => item.id === next.id)
      if (!existing) {
        state.mergedDrafts.unshift({
          id: next.id,
          title: next.title,
          sourceIds: next.sourceIds,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
          status: next.status,
          scheduledAt: next.scheduledAt,
          platform: next.platform,
          production: {
            title: next.title,
            article: next.article,
            format: next.format,
            sourceIds: next.sourceIds,
            status: next.productionStatus || next.status,
            markdownMeta: next.markdownMeta,
          },
          imported: true,
        })
        result.imported += 1
        continue
      }
      const before = JSON.stringify({
        title: existing.production?.title,
        article: existing.production?.article,
        format: existing.production?.format,
        productionStatus: existing.production?.status,
        sourceIds: existing.production?.sourceIds ?? existing.sourceIds,
        status: existing.status,
        platform: existing.platform,
        scheduledAt: existing.scheduledAt,
        updatedAt: existing.updatedAt,
        markdownMeta: existing.production?.markdownMeta,
      })
      existing.title = next.title
      existing.sourceIds = next.sourceIds
      existing.status = next.status
      existing.platform = next.platform
      existing.scheduledAt = next.scheduledAt
      existing.updatedAt = next.updatedAt
      existing.production = {
        ...(existing.production ?? {}),
        title: next.title,
        article: next.article,
        format: next.format,
        sourceIds: next.sourceIds,
        status: next.productionStatus || existing.production?.status || next.status,
        markdownMeta: next.markdownMeta,
      }
      existing.imported = true
      const after = JSON.stringify({
        title: existing.production?.title,
        article: existing.production?.article,
        format: existing.production?.format,
        productionStatus: existing.production?.status,
        sourceIds: existing.production?.sourceIds ?? existing.sourceIds,
        status: existing.status,
        platform: existing.platform,
        scheduledAt: existing.scheduledAt,
        updatedAt: existing.updatedAt,
        markdownMeta: existing.production?.markdownMeta,
      })
      if (before === after) result.skipped += 1
      else result.updated += 1
    } catch (err) {
      result.errors.push(`${relative(root, path).split(sep).join('/')}: ${err.message || String(err)}`)
    }
  }
  return result
}

export const importInspirationMarkdown = importMarkdown

async function atomicWrite(path, content) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}
