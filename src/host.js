// media-workbench host 半片：/media-workbench/* 接口、文件服务和模型调用。
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assistantModelOverride, callModel, chatPrompts, defaultSelection, extractJson, modelInfo, modelStatus, setAssistantModel } from './ai.js'
import { fetchAihot, fetchAihotStory } from './aihot.js'
import { saveProduction } from './export.js'
import { harvest, harvestText } from './harvest.js'
import { generateImage } from './images.js'
import { generateToolImage, imageTool } from './image-tool.js'
import { localIntent } from './intents.js'
import { computeInsights, exportSkill, proposeRules } from './learn.js'
import { ensureMarkdownDirs, importMarkdown, organizeExternalMarkdown, removeMarkdown, safeFilePart, syncMarkdown } from './markdown.js'
import { createRedfoxClient, fetchAccount, fetchRankings, importPosts, importSearchPosts, postsToMaterial, redfoxStatus, resolveAccount, saveCovers, searchPosts } from './redfox.js'
import { applyOps, newId } from './ops.js'
import { createPublishJob, findPublishJob, isPublishJobExpired, publicPublishJob, updatePublishJob } from './publish.js'
import { applyRevision, buildMergedItem, Producer } from './produce.js'
import { publicSettings, Settings, imageReady } from './settings.js'
import { normalizeStyle, stylePrompts } from './style.js'
import { dshHome, Store } from './store.js'
import { defaultWorkspaceDir, normalizeWorkspaceDir, readWorkspaceDir, writeWorkspaceDir } from './workspace.js'
import { fetchXbangdan } from './xbangdan.js'
import { currentLang, platformName, tr, withLang } from './i18n.js'
import { localizeSamples, samplesNeedLocale } from './seed.js'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const MAX_JSON = 4_000_000
const MAX_UPLOAD = 250_000_000
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }
const UPLOAD_EXT = Object.fromEntries(Object.entries(MIME).filter(([ext]) => ext !== '.jpeg').map(([ext, type]) => [type, ext]))

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function html(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function handoffAssetUrl(src) {
  if (/^media-workbench\/(?:attachments|files|assets)\/[\w.-]+$/.test(src)) return `/${src}`
  return /^https?:\/\//.test(src) ? src : ''
}

function handoffPage(job) {
  const source = job.source ?? {}
  const payload = JSON.stringify(publicPublishJob(job)).replace(/[<\u2028\u2029]/g, char => ({ '<': '\\u003c', '\u2028': '\\u2028', '\u2029': '\\u2029' }[char]))
  const media = (source.media ?? []).map((entry) => {
    const url = handoffAssetUrl(entry.src)
    if (!url) return ''
    return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.role)}${entry.index === undefined ? '' : ` ${entry.index + 1}`}</a></li>`
  }).filter(Boolean).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Media Workbench · 发布交接</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:860px;margin:40px auto;padding:0 24px;color:#202124;background:#fafafa}main{background:white;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 8px 30px #0000000b}h1{font-size:24px;margin:0 0 8px}h2{font-size:16px;margin:24px 0 8px}p{white-space:pre-wrap;background:#f7f7f8;border-radius:10px;padding:14px;max-height:320px;overflow:auto}.meta{color:#6b7280;font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}button,a.button{border:1px solid #d1d5db;border-radius:9px;background:#fff;color:#111827;padding:8px 12px;text-decoration:none;cursor:pointer}button.primary{background:#111827;color:white;border-color:#111827}ul{padding-left:20px}</style></head>
<body><main><h1>发布交接已准备</h1><div class="meta">任务 ${escapeHtml(job.id)} · 有效至 ${escapeHtml(job.expiresAt)}</div>
<h2>${escapeHtml(source.title)}</h2><div class="actions"><button class="primary" id="copy-title">复制标题</button><button id="copy-body">复制正文</button><button id="copy-markdown">复制 Markdown</button></div>
<h2>正文预览</h2><p id="body">${escapeHtml(source.body)}</p>
<h2>素材</h2><ul>${media || '<li>这条成稿没有可交接的本地素材</li>'}</ul>
<p id="handoff-status" class="meta">正在尝试把任务交给爱贝壳；如果扩展没有响应，请直接在爱贝壳中选择平台。</p></main>
<script>
const payload=${payload};
const copy=value=>navigator.clipboard?.writeText(value).then(()=>true).catch(()=>false);
const status=document.querySelector('#handoff-status');
document.querySelector('#copy-title').onclick=()=>copy(payload.source.title);
document.querySelector('#copy-body').onclick=()=>copy(payload.source.body);
document.querySelector('#copy-markdown').onclick=()=>copy(payload.source.markdown);
window.__MEDIA_WORKBENCH_HANDOFF__=payload;
window.__MEDIA_WORKBENCH_RETRY__=()=>{
  if (!globalThis.chrome?.runtime?.sendMessage) { status.textContent='当前页面没有可用的扩展通信接口，请在爱贝壳中手动选择平台。'; return; }
  try {
    chrome.runtime.sendMessage('jejejajkcbhejfiocemmddgbkdlhhngm', { type:'media-workbench:publish', job:payload }, response => {
      const error=chrome.runtime.lastError;
      if (error) status.textContent='爱贝壳未接收任务，请在扩展中手动选择平台。';
      else status.textContent=response?.status === 'received' ? '内容已交给爱贝壳，请在爱贝壳中选择平台。' : '等待爱贝壳接收任务，请在扩展中选择平台。';
    });
  } catch { status.textContent='爱贝壳未接收任务，请在扩展中手动选择平台。'; }
};
window.__MEDIA_WORKBENCH_RETRY__();
</script></body></html>`
}

function handoffUrl(req, job) {
  const host = req.headers.host
  if (!host) return `/media-workbench/publish/handoff?jobId=${encodeURIComponent(job.id)}&nonce=${encodeURIComponent(job.nonce)}`
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const protocol = forwarded || (req.socket?.encrypted ? 'https' : 'http')
  return `${protocol}://${host}/media-workbench/publish/handoff?jobId=${encodeURIComponent(job.id)}&nonce=${encodeURIComponent(job.nonce)}`
}

function requirePublishJob(state, jobId, nonce = '') {
  const job = findPublishJob(state, String(jobId || ''))
  if (!job || !nonce || nonce !== job.nonce) throw Object.assign(new Error(tr('发布任务不存在')), { status: 404 })
  if (isPublishJobExpired(job)) throw Object.assign(new Error(tr('发布任务已过期')), { status: 410 })
  return job
}

function markContentPublished(state, contentId) {
  const result = applyOps(state, [{ op: 'set_status', id: contentId, status: 'published' }])
  return result.receipts
}

async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error(tr('内容太大')), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBuffer(req, MAX_JSON)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error(tr('请求不是有效的 JSON')), { status: 400 })
  }
}

/** 支持 Range，视频才能正常拖动和循环。 */
async function sendFile(req, res, file) {
  const type = MIME[extname(file).toLowerCase()]
  if (!type) return json(res, 404, { error: tr('不支持的文件类型') })
  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: tr('文件不存在') })
  }
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'private, max-age=3600')
  res.setHeader('x-content-type-options', 'nosniff')
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start >= info.size || start > end) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', end - start + 1)
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.statusCode = 200
  res.setHeader('content-length', info.size)
  if (req.method === 'HEAD') return res.end()
  return createReadStream(file).pipe(res)
}

async function attachmentPath(store, prefix, name) {
  const legacy = prefix === 'files'
  const preferred = join(legacy ? store.legacyFilesDir : store.attachmentsDir, name)
  if (legacy) {
    try {
      await stat(preferred)
      return preferred
    } catch { /* fall through to the migrated attachments directory */ }
  }
  return join(store.attachmentsDir, name)
}

function engineLabel(ctx) {
  const info = modelInfo(ctx)
  return info ? info.label : null
}

/** 同一次故障只提醒一次，用人话说。原始错误放在模型状态的提示里。 */
function outageNotice(ctx, wasDown, fallback) {
  if (wasDown) return null
  return modelInfo(ctx) ? tr('模型暂时用不了，{fallback}。可以到设置里检查账号或密钥。', { fallback }) : tr('当前没有连接模型，{fallback}。', { fallback })
}

async function chatTurn(ctx, store, desk, body) {
  const message = String(body.message || '').trim()
  if (!message) throw Object.assign(new Error(tr('消息为空')), { status: 400 })
  const focusId = typeof body.focusId === 'string' ? body.focusId : undefined
  const state = await store.read()
  const snapshot = JSON.parse(JSON.stringify(state))
  const merged = focusId ? snapshot.mergedDrafts?.find(row => row.id === focusId) : null
  const promptState = merged
    ? { ...snapshot, items: [...snapshot.items, { ...buildMergedItem(snapshot, merged.sourceIds, merged.id), production: merged.production }] }
    : snapshot
  let plan
  let engine = 'local'
  let notice = null
  const wasDown = modelStatus.ok === false
  try {
    const history = snapshot.chat.filter(row => (row.itemId ?? null) === (focusId ?? null))
    const { system, user } = chatPrompts(promptState, message, { focusId, history })
    const editing = (merged?.production ?? snapshot.items.find(row => row.id === focusId)?.production)?.status === 'done'
    const { text, model } = await callModel(ctx, { system, user, maxTokens: editing ? 8000 : 2000, light: true, signal: AbortSignal.timeout(editing ? 240_000 : 90_000) })
    engine = model
    try {
      plan = extractJson(text)
      if (typeof plan.reply !== 'string') plan.reply = tr('处理好了。')
    } catch {
      // 模型只回了一段话时，当成普通回答，不算失败
      plan = { reply: text.trim().slice(0, 1200) || tr('我没有听懂，可以换个说法吗？'), ops: [] }
    }
  } catch {
    notice = outageNotice(ctx, wasDown, tr('先用本地规则处理'))
    plan = localIntent(promptState, message, { focusId })
  }
  const settings = await desk.settings.read()
  const canDraw = desk.producer.ready(settings)
  // 只把真正改了数据的那一步放进撤销；问一句话不占撤销位
  const changed = await store.mutate(tr('对话：{text}', { text: message.slice(0, 18) }), (draft) => {
    const target = focusId ? (draft.items.find(row => row.id === focusId) ?? draft.mergedDrafts?.find(row => row.id === focusId)) : null
    const production = target?.production?.status === 'done' ? target.production : null
    // 本地规则只会改灵感标题；有成稿时要改的是成稿标题
    const ops = (Array.isArray(plan.ops) ? plan.ops : []).map((op) => {
      if (merged && op?.op === 'update_item' && op.id === focusId && typeof op.title === 'string') return { op: 'update_production', id: focusId, title: op.title }
      if (production && op?.op === 'update_item' && op.id === focusId && typeof op.title === 'string') return { op: 'update_production', id: focusId, title: op.title }
      return op
    }).filter(op => !merged || ['update_production'].includes(op?.op))
    const { receipts, errors } = applyOps(draft, ops)
    let targets = []
    if (production && plan.revise) {
      // 没接生图时，图不会重画，回执要说实话
      const revision = applyRevision(production, plan.revise, { canDraw })
      receipts.push(...revision.receipts.map(text => ({ text })))
      errors.push(...revision.errors)
      targets = canDraw ? revision.targets : []
    }
    return { receipts, errors, targets, done: Boolean(production) }
  })
  const result = await store.mutate('对话记录', (draft) => {
    const { receipts, errors, targets, done } = changed
    const at = new Date().toISOString()
    const itemId = focusId ?? undefined
    // 已经做好的成稿不会因为一句话被整篇重做，要重做请点「重新成稿」
    const actions = (Array.isArray(plan.actions) ? plan.actions : [])
      .filter(a => a && ['produce', 'open', 'nav'].includes(a.type))
      .filter(a => !(a.type === 'produce' && (done && a.id === focusId || draft.items.find(row => row.id === a.id)?.production?.status === 'done')))
    draft.chat.push({ id: newId('c'), at, role: 'user', text: message, itemId })
    const answer = { id: newId('c'), at, role: 'assistant', text: plan.reply, receipts, errors, engine, notice, undoable: receipts.length > 0, itemId }
    draft.chat.push(answer)
    draft.chat = draft.chat.slice(-300)
    return { answer, actions, targets, state: draft, modelOk: modelStatus.ok, modelError: modelStatus.error }
  }, { undoable: false })
  if (canDraw) {
    await Promise.all(result.targets.map(target => desk.producer.regenerate(focusId, target).catch(() => {})))
    return { ...result, state: await store.read() }
  }
  return result
}

async function extractStyle(ctx, store, body) {
  const urls = (Array.isArray(body.urls) ? body.urls : []).map(row => String(row).trim()).filter(Boolean).slice(0, 5)
  const parts = [String(body.text ?? '').trim()].filter(Boolean)
  const failures = []
  for (const url of urls) {
    try {
      const page = await harvestText(url)
      if (page.text.length >= 80) parts.push(`${page.title ?? ''}\n${page.text}`)
      else failures.push(tr('{url}：页面上几乎没有文字，可能需要登录', { url }))
    } catch (err) {
      failures.push(tr('{url}：{error}', { url, error: err.message }))
    }
  }
  const material = parts.join('\n\n---\n\n')
  if (material.length < 80) {
    throw Object.assign(new Error(failures.length ? tr('抓不到内容。{reason}。可以把内容直接贴进来。', { reason: failures[0] }) : tr('内容太少了，至少贴一段完整的文字')), { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 20) : ''
  const source = urls.length && parts.length === urls.length ? tr('链接') : urls.length ? tr('内容和链接') : tr('内容')
  return styleFromMaterial(ctx, store, { material, name, source, sourceUrls: urls, failures })
}

/** 提炼一张风格卡并设为当前风格。同一个账号再抓一次时更新原来那张。 */
async function styleFromMaterial(ctx, store, { material, name, source, sourceUrls = [], failures = [], accountKey = null }) {
  let style
  try {
    const { system, user } = stylePrompts(material, name)
    const { text } = await callModel(ctx, { system, user, maxTokens: 1500, light: true, signal: AbortSignal.timeout(120_000) })
    style = normalizeStyle(extractJson(text), name)
  } catch (err) {
    throw Object.assign(new Error(tr('提炼风格需要文字模型：{error}', { error: err.message })), { status: 502 })
  }
  return store.mutate(tr('提炼风格「{name}」', { name: style.name }), (draft) => {
    const existing = accountKey ? (draft.styles ?? []).find(row => row.accountKey === accountKey) : null
    const id = existing?.id ?? newId('st')
    const row = { id, ...style, source, sourceUrls, ...(accountKey ? { accountKey } : {}), createdAt: existing?.createdAt ?? new Date().toISOString() }
    draft.styles = existing ? draft.styles.map(entry => (entry.id === id ? row : entry)) : [row, ...(draft.styles ?? [])]
    draft.activeStyleId = id
    return { id, failures, state: draft }
  })
}

/** 导入用户自己的账号。先把内容存好，提炼失败也不会白花。 */
async function importAccountRoute(ctx, store, desk, body) {
  if (desk.importing) throw Object.assign(new Error(tr('上一个账号还在导入，等它结束再试')), { status: 409 })
  desk.importing = true
  try {
    const account = await resolveAccount(body.text)
    const settings = await desk.settings.read()
    const client = createRedfoxClient(settings.redfox)
    const { posts, profile, cost } = await fetchAccount(account, client)
    const covers = await saveCovers(posts, account.platform, await store.read(), store.filesDir)
    const added = await store.mutate(tr('导入{platform}账号', { platform: platformName(account.platform) }), draft => importPosts(draft, { account, profile, posts, covers }).added)
    const nickname = profile.nickname || platformName(account.platform)
    let styleError = null
    const material = postsToMaterial(posts)
    if (material.length >= 80) {
      try {
        await styleFromMaterial(ctx, store, { material, name: nickname, source: tr('{platform}账号', { platform: platformName(account.platform) }), sourceUrls: [account.url], accountKey: `${account.platform}:${account.id}` })
      } catch (err) {
        styleError = err.message
      }
    } else {
      styleError = tr('这个账号的文字太少，提炼不出风格')
    }
    return { platform: account.platform, nickname, count: posts.length, added, cost, styleName: styleError ? null : nickname, styleError, state: await store.read() }
  } finally {
    desk.importing = false
  }
}

async function searchRedfoxRoute(store, desk, body) {
  const settings = await desk.settings.read()
  const client = createRedfoxClient(settings.redfox)
  const posts = await searchPosts(body.keyword, body.platforms, client)
  const results = await store.mutate(tr('搜索 RedFox 内容'), draft => importSearchPosts(draft, { posts }))
  return { results, state: await store.read() }
}

async function addFromUrl(ctx, store, body) {
  const url = String(body.url || '').trim()
  const info = await harvest(url)
  const op = {
    op: 'add_item', kind: 'web', title: body.title || info.title || url, body: body.note || info.description || '', url: info.url, source: info.siteName, tags: Array.isArray(body.tags) ? body.tags : [],
    media: info.image ? { src: info.image } : null,
  }
  return store.mutate(tr('收藏《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
    const { receipts, errors } = applyOps(draft, [op])
    return { receipts, errors, id: receipts[0]?.target, state: draft }
  })
}

async function refreshAccount(store, body) {
  const url = String(body.url || '').trim()
  const now = new Date().toISOString()
  let patch
  try {
    const info = await harvest(url)
    patch = { url: info.url, title: info.title ?? undefined, description: info.description ?? undefined, avatar: info.image ?? undefined, fetchedAt: now, fetchError: '', ...(info.followers ? { followers: info.followers } : {}) }
  } catch (err) {
    patch = { url, fetchedAt: now, fetchError: err.message }
  }
  return store.mutate(tr('更新账号档案'), (draft) => {
    const op = body.id ? { op: 'update_account', id: body.id, ...patch } : { op: 'add_account', platform: body.platform ?? '', handle: body.handle ?? '', ...patch }
    const { errors } = applyOps(draft, [op])
    return { state: draft, errors, fetchError: patch.fetchError || null }
  })
}

async function handleUpload(req, store, res) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const ext = UPLOAD_EXT[type]
  if (!ext) return json(res, 415, { error: tr('不支持这种文件：{type}', { type: type || tr('未知') }) })
  const buffer = await readBuffer(req, MAX_UPLOAD)
  await store.read()
  const name = `${newId('f')}${ext}`
  await writeFile(join(store.attachmentsDir, name), buffer)
  return json(res, 200, { src: `media-workbench/attachments/${name}`, kind: type.startsWith('video/') ? 'video' : 'image' })
}

function createRuntime(ctx, root) {
  const store = new Store(root)
  const settings = new Settings(store.root)
  const producer = new Producer({
    store, settings, callText: options => callModel(ctx, options),
    ready: saved => imageReady(saved, Boolean(imageTool(ctx))),
    generate: (image, prompt, options) => image.source === 'tool' ? generateToolImage(ctx, image, prompt, options) : generateImage(image, prompt, options),
    onPersist: state => syncMarkdown(store.root, state),
  })
  return { store, settings, producer }
}

async function projectMarkdown(store, state) {
  try {
    await syncMarkdown(store.root, state)
    return null
  } catch (err) {
    return err?.message || String(err)
  }
}

async function cleanupMarkdown(store, receipts = []) {
  const cleanup = (Array.isArray(receipts) ? receipts : [])
    .map(receipt => receipt?.cleanup)
    .filter(Boolean)
  if (!cleanup.length) return null
  try {
    await removeMarkdown(store.root, {
      inspirationIds: cleanup.flatMap(entry => entry.inspirationIds ?? []),
      contentIds: cleanup.flatMap(entry => entry.contentIds ?? []),
    })
    return null
  } catch (err) {
    return err?.message || String(err)
  }
}

async function importMarkdownState(store) {
  const current = await store.read()
  const draft = structuredClone(current)
  const result = await importMarkdown(store.root, draft)
  if (result.imported || result.updated) {
    result.state = await store.mutate('同步 Markdown 灵感', (state) => {
      state.items = draft.items
      state.mergedDrafts = draft.mergedDrafts
      return state
    }, { undoable: false })
  } else result.state = current
  // 外部采集只有在状态已持久化后才会整理到“灵感”，失败时保留源文件供下次重试。
  if (result.externalFiles?.length) {
    const organized = await organizeExternalMarkdown(store.root, result.externalFiles, result.state)
    result.organized = organized.organized.length
    if (organized.errors.length) result.errors.push(...organized.errors)
  } else result.organized = 0
  // 绝对路径只在 Host 内部使用，不返回给客户端。
  delete result.externalFiles
  return result
}

async function copyWorkspaceContents(source, target) {
  await mkdir(target, { recursive: true })
  for (const name of await readdir(source)) await cp(join(source, name), join(target, name), { recursive: true, force: false, errorOnExist: true })
}

/** 在 Host 所在电脑上打开原生文件夹选择器，返回用户确认的绝对路径。 */
function execFileText(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        rejectPromise(error)
        return
      }
      resolvePromise(String(stdout || '').trim())
    })
  })
}

async function pickWorkspaceFolder() {
  try {
    if (process.platform === 'darwin') {
      // 用户取消 choose folder 时 osascript 返回 1；空字符串代表取消，不是错误。
      return await execFileText('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择工作台数据目录")'])
    }
    if (process.platform === 'linux') return await execFileText('zenity', ['--file-selection', '--directory', '--title=选择工作台数据目录'])
    if (process.platform === 'win32') {
      const script = "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '选择工作台数据目录'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
      return await execFileText('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
    }
  } catch (error) {
    // 取消选择在 macOS 和 zenity 都是退出码 1，按取消处理；其他错误要让用户知道选择器不可用。
    if (error?.code === 1) return ''
    throw Object.assign(new Error(tr('无法打开文件夹选择器，请检查 Host 所在电脑的系统权限')), { status: 501, cause: error })
  }
  throw Object.assign(new Error(tr('当前系统不支持文件夹选择器')), { status: 501 })
}

async function switchWorkspace(ctx, desk, value) {
  const root = normalizeWorkspaceDir(value)
  if (root === desk.store.root) return
  const current = resolve(desk.store.root)
  const nextPath = resolve(root)
  if (nextPath.startsWith(`${current}${sep}`)) throw Object.assign(new Error(tr('工作台目录不能放在当前工作台目录里面')), { status: 400 })
  await desk.store.read()
  try {
    await stat(join(root, 'state.json'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    await copyWorkspaceContents(desk.store.root, root)
  }
  await writeWorkspaceDir(root)
  const next = createRuntime(ctx, root)
  await ensureMarkdownDirs(root)
  Object.assign(desk, next, { settled: false })
  const saved = await desk.settings.read()
  setAssistantModel(saved.assistant)
}

async function route(ctx, store, desk, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/media-workbench\/?/, '')
  const method = req.method || 'GET'

  if ((method === 'GET' || method === 'HEAD') && path.startsWith('assets/')) {
    const name = path.slice('assets/'.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    return sendFile(req, res, join(ASSETS_DIR, name))
  }
  if ((method === 'GET' || method === 'HEAD') && (path.startsWith('attachments/') || path.startsWith('files/'))) {
    const prefix = path.startsWith('attachments/') ? 'attachments' : 'files'
    const name = path.slice(`${prefix}/`.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    await store.read()
    return sendFile(req, res, await attachmentPath(store, prefix, name))
  }
  if (method === 'GET') {
    if (path === 'publish/handoff') {
      const jobId = url.searchParams.get('jobId') || ''
      const nonce = url.searchParams.get('nonce') || ''
      const job = findPublishJob(await store.read(), jobId)
      if (!job || !nonce || nonce !== job.nonce) return html(res, 404, '<!doctype html><meta charset="utf-8"><title>发布任务不存在</title><p>发布任务不存在或链接已失效。</p>')
      if (isPublishJobExpired(job)) return html(res, 410, '<!doctype html><meta charset="utf-8"><title>发布任务已过期</title><p>发布任务已过期，请回到工作台重新点击“一键发布”。</p>')
      return html(res, 200, handoffPage(job))
    }
    if (path === 'publish/job') {
      const jobId = url.searchParams.get('jobId') || ''
      const nonce = url.searchParams.get('nonce') || ''
      const job = findPublishJob(await store.read(), jobId)
      if (!job || !nonce || nonce !== job.nonce) return json(res, 404, { error: tr('发布任务不存在') })
      if (isPublishJobExpired(job)) return json(res, 410, { error: tr('发布任务已过期') })
      return json(res, 200, { job: publicPublishJob(job) })
    }
    if (path === 'state') {
      if (!desk.settled) { desk.settled = true; await desk.producer.settleAll().catch(() => {}) }
      const imported = await importMarkdownState(store)
      let state = imported.state
      // 示例数据跟着界面语言走；用户自己的内容不动
      if (samplesNeedLocale(state, currentLang())) state = await store.mutate('', draft => (localizeSamples(draft, currentLang()), draft), { undoable: false })
      const markdownError = await projectMarkdown(store, state)
      return json(res, 200, { state, model: engineLabel(ctx), modelOk: modelStatus.ok, modelError: modelStatus.error, canUndo: store.undo.length > 0, markdown: { imported: imported.imported, updated: imported.updated, organized: imported.organized, skipped: imported.skipped, errors: imported.errors }, ...(markdownError ? { markdownError } : {}) })
    }
    if (path === 'production') {
      const id = url.searchParams.get('id') ?? ''
      await desk.producer.settle(id)
      const state = await store.read()
      const item = state.items.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id)
      return json(res, 200, { production: item?.production ?? null, status: item?.status, live: desk.producer.status(id) })
    }
    if (path === 'settings') return json(res, 200, { ...publicSettings(await desk.settings.read(), Boolean(imageTool(ctx))), workspaceDir: store.root, defaultWorkspaceDir: defaultWorkspaceDir() })
    if (path === 'models') {
      // 列出 Harness 里已接的提供方和它们公布的模型，给工作台的助手模型选择器用
      const llm = ctx.get('llm')
      const providers = llm ? await llm.listProviders() : []
      const settled = await Promise.allSettled(providers.map(async p => ({
        provider: p.id, name: p.name,
        models: (await llm.listModels(p.id)).map(m => ({ id: m.id, name: m.name || m.id })),
      })))
      return json(res, 200, {
        providers: settled.filter(r => r.status === 'fulfilled').map(r => r.value).filter(p => p.models.length),
        default: defaultSelection(ctx),
        current: assistantModelOverride(),
      })
    }
    if (path === 'insights') return json(res, 200, computeInsights(await store.read()))
    if (path === 'redfox/status') return json(res, 200, redfoxStatus(await desk.settings.read()))
    if (path === 'redfox/rankings') {
      const settings = await desk.settings.read()
      const client = createRedfoxClient(settings.redfox)
      const result = await fetchRankings({
        platform: url.searchParams.get('platform') || 'xiaohongshu',
        ranking: url.searchParams.get('ranking') || '',
        period: url.searchParams.get('period') || 'day',
        date: url.searchParams.get('date') || '',
        category: url.searchParams.get('category') || '',
        gender: url.searchParams.get('gender') || 'all',
      }, client)
      return json(res, 200, result)
    }
    if (path === 'xbangdan/posts') {
      const result = await fetchXbangdan({
        section: url.searchParams.get('section') || 'rate',
        category: url.searchParams.get('category') || 'all',
        hours: url.searchParams.get('hours') || 24,
      })
      return json(res, 200, result)
    }
    if (path === 'aihot') {
      const tab = url.searchParams.get('tab') || 'selected'
      return json(res, 200, await fetchAihot(tab, {
        category: url.searchParams.get('category') || '',
        q: url.searchParams.get('q') || '',
        cursor: url.searchParams.get('cursor') || '',
        limit: url.searchParams.get('limit') || '',
      }))
    }
    if (path === 'aihot-story') {
      return json(res, 200, await fetchAihotStory(url.searchParams.get('url') || '', {
        refresh: url.searchParams.get('refresh') === '1',
      }))
    }
    return json(res, 404, { error: tr('接口不存在') })
  }
  if (method !== 'POST') return json(res, 405, { error: tr('不支持的方法') })

  // 所有写操作都拒绝跨站请求
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return json(res, 403, { error: tr('拒绝跨站请求') })

  if (path === 'upload') return handleUpload(req, store, res)
  const body = await readJson(req)
  switch (path) {
    case 'markdown/sync': {
      const imported = await importMarkdownState(store)
      const markdownError = await projectMarkdown(store, imported.state)
      return json(res, 200, { ...imported, ...(markdownError ? { markdownError } : {}) })
    }
    case 'workspace': {
      await switchWorkspace(ctx, desk, body.path)
      return json(res, 200, { ...publicSettings(await desk.settings.read(), Boolean(imageTool(ctx))), workspaceDir: desk.store.root, defaultWorkspaceDir: defaultWorkspaceDir() })
    }
    case 'workspace/pick': {
      const path = await pickWorkspaceFolder()
      return json(res, 200, { path })
    }
    case 'ops': {
      const label = typeof body.label === 'string' ? body.label : tr('操作')
      const result = await store.mutate(label, (draft) => {
        const applied = applyOps(draft, body.ops)
        return { ...applied, state: draft }
      }, { undoable: body.undoable !== false })
      const cleanupError = await cleanupMarkdown(store, result.receipts)
      const markdownError = cleanupError || await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'publish/prepare': {
      const id = String(body.id || '')
      let job
      const state = await store.mutate('准备发布任务', (draft) => {
        job = createPublishJob(draft, id, { adapter: 'aibeike' })
        return draft
      }, { undoable: false })
      return json(res, 200, { job: publicPublishJob(job), handoffUrl: handoffUrl(req, job), state })
    }
    case 'publish/handoff': {
      const state = await store.read()
      let job
      try {
        job = requirePublishJob(state, body.jobId, body.nonce)
      } catch (err) {
        if (err.status === 410) {
          const current = findPublishJob(state, body.jobId)
          const expired = current
            ? await store.mutate('发布任务过期', draft => updatePublishJob(draft, current.id, { status: 'expired' }), { undoable: false })
            : null
          return json(res, 410, { error: err.message, ...(expired ? { job: publicPublishJob(expired) } : {}) })
        }
        return json(res, err.status || 404, { error: err.message })
      }
      if (job.contentId !== String(body.id || job.contentId)) return json(res, 404, { error: tr('发布任务不存在') })
      const next = await store.mutate('打开发布任务', draft => updatePublishJob(draft, job.id, { status: 'handed_off', attempts: (job.attempts ?? 0) + 1 }), { undoable: false })
      return json(res, 200, { job: publicPublishJob(next), handoffUrl: handoffUrl(req, next) })
    }
    case 'publish/result': {
      const state = await store.read()
      const job = requirePublishJob(state, body.jobId, body.nonce)
      const status = typeof body.status === 'string' ? body.status : 'awaiting_user'
      if (!['handed_off', 'awaiting_platform', 'awaiting_user', 'published', 'failed'].includes(status)) return json(res, 400, { error: tr('发布状态无效') })
      const next = await store.mutate('更新发布结果', draft => {
        const updated = updatePublishJob(draft, job.id, {
          status,
          externalId: body.externalId,
          externalUrl: body.externalUrl,
          lastError: body.error,
        })
        if (status === 'published') markContentPublished(draft, updated.contentId)
        return updated
      }, { undoable: false })
      const nextState = await store.read()
      const markdownError = await projectMarkdown(store, nextState)
      return json(res, 200, { job: publicPublishJob(next), state: nextState, ...(markdownError ? { markdownError } : {}) })
    }
    case 'publish/confirm': {
      const state = await store.read()
      let job
      try {
        job = requirePublishJob(state, body.jobId, body.nonce)
      } catch (err) {
        if (err.status === 410) {
          const current = findPublishJob(state, body.jobId)
          const expired = current
            ? await store.mutate('发布任务过期', draft => updatePublishJob(draft, current.id, { status: 'expired' }), { undoable: false })
            : null
          return json(res, 410, { error: err.message, ...(expired ? { job: publicPublishJob(expired) } : {}) })
        }
        return json(res, err.status || 404, { error: err.message })
      }
      if (job.contentId !== String(body.id || job.contentId)) return json(res, 404, { error: tr('发布任务不存在') })
      const next = await store.mutate('确认发布结果', draft => {
        const updated = updatePublishJob(draft, job.id, { status: 'published', externalUrl: body.externalUrl, externalId: body.externalId })
        markContentPublished(draft, updated.contentId)
        return updated
      }, { undoable: false })
      const nextState = await store.read()
      const markdownError = await projectMarkdown(store, nextState)
      return json(res, 200, { job: publicPublishJob(next), state: nextState, ...(markdownError ? { markdownError } : {}) })
    }
    case 'undo': {
      const label = await store.undoLast()
      const state = await store.read()
      const markdownError = await projectMarkdown(store, state)
      return json(res, 200, { label, state, canUndo: store.undo.length > 0, ...(markdownError ? { markdownError } : {}) })
    }
    case 'chat': {
      const result = await chatTurn(ctx, store, desk, body)
      const cleanupError = await cleanupMarkdown(store, result.answer?.receipts)
      const markdownError = cleanupError || await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'chat/clear': {
      const state = await store.mutate('清空对话', (draft) => { draft.chat = []; return draft }, { undoable: false })
      return json(res, 200, { state })
    }
    case 'produce': {
      const started = await desk.producer.start(String(body.id), { format: body.format, references: body.references, imageCount: body.imageCount, shotCount: body.shotCount })
      return json(res, 200, { started, state: await store.read() })
    }
    case 'produce/merge': {
      const id = await desk.producer.startMerge(body.sourceIds, { format: body.format, references: body.references, draftId: body.draftId, imageCount: body.imageCount, shotCount: body.shotCount })
      return json(res, 200, { id, state: await store.read() })
    }
    case 'produce/cancel':
      await desk.producer.cancel(String(body.id))
      return json(res, 200, { ok: true })
    case 'produce/regen':
      await desk.producer.regenerate(String(body.id), body.target)
      return json(res, 200, { state: await store.read() })
    case 'produce/save': {
      const state = await store.read()
      const id = String(body.mergedId || body.id || '')
      const item = state.items.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id)
      if (!item?.production?.article) return json(res, 400, { error: tr('还没有可以保存的成稿') })
      await store.read()
      // 视频封面由浏览器合成（画面叠大字），这里只接受 JPEG
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.videoCover ?? '')
      const videoCover = match ? Buffer.from(match[1], 'base64') : null
      if (videoCover && !(videoCover[0] === 0xff && videoCover[1] === 0xd8)) return json(res, 400, { error: tr('封面不是有效的图片') })
      const contentDir = join(store.root, '内容', safeFilePart(id, 'content'))
      const saved = await saveProduction(item.production, { filesDir: store.filesDir, targetDir: contentDir, videoCover })
      const next = await store.mutate('保存成稿', (draft) => {
        const target = draft.items.find(row => row.id === id) ?? draft.mergedDrafts?.find(row => row.id === id)
        if (target?.production) {
          target.production.savedPath = saved.path
          target.production.savedAt = new Date().toISOString()
        }
        return draft
      }, { undoable: false })
      const markdownError = await projectMarkdown(store, next)
      return json(res, 200, { ...saved, state: next, ...(markdownError ? { markdownError } : {}) })
    }
    case 'produce/reveal': {
      // 路径只取自保存记录，不接受请求里传来的路径
      const state = await store.read()
      const id = String(body.id || '')
      const path = (state.items.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id))?.production?.savedPath
      if (!path) return json(res, 400, { error: tr('还没有保存过') })
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(command, [path], () => {})
      return json(res, 200, { path })
    }
    case 'style/extract': return json(res, 200, await extractStyle(ctx, store, body))
    case 'redfox/import': {
      const result = await importAccountRoute(ctx, store, desk, body)
      const markdownError = await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'redfox/search': {
      const result = await searchRedfoxRoute(store, desk, body)
      const markdownError = await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'settings': {
      const before = modelInfo(ctx)
      const updated = await desk.settings.update(body)
      setAssistantModel(updated.assistant)
      const after = modelInfo(ctx)
      // 换了模型，上一个模型的失败状态不再算数
      if (before?.provider !== after?.provider || before?.model !== after?.model) Object.assign(modelStatus, { ok: null, error: null })
      return json(res, 200, { ...publicSettings(updated, Boolean(imageTool(ctx))), workspaceDir: store.root, defaultWorkspaceDir: defaultWorkspaceDir(), assistantEffective: modelInfo(ctx)?.label ?? null })
    }
    case 'settings/test': {
      const settings = await desk.settings.read()
      if (!desk.producer.ready(settings)) return json(res, 400, { error: tr(settings.image.source === 'tool' ? '未找到订阅生图工具，或默认执行器不支持直接调用；请检查插件和执行器后刷新工作台' : '先填好接口地址、模型和密钥') })
      await store.read()
      const { buffer, ext } = await desk.producer.generate(settings.image, 'A single paper boat on calm water, black and white pencil line art sketch, plain white paper background, no text.')
      const name = `${newId('t')}${ext}`
      await writeFile(join(store.attachmentsDir, name), buffer)
      return json(res, 200, { src: `media-workbench/attachments/${name}` })
    }
    case 'capture-url': {
      const result = await addFromUrl(ctx, store, body)
      const markdownError = await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'account/refresh': {
      const result = await refreshAccount(store, body)
      const markdownError = await projectMarkdown(store, result.state)
      return json(res, 200, { ...result, ...(markdownError ? { markdownError } : {}) })
    }
    case 'skills/learn': {
      const proposals = proposeRules(await store.read())
      if (!proposals.length) return json(res, 200, { added: 0, state: await store.read() })
      const state = await store.mutate(tr('从数据中学习'), (draft) => {
        // 只用示例数据算出来的建议也算示例，清空示例时一起清掉，也不会被导出
        const fromSamples = !draft.metrics.some(metric => !metric.sample)
        const { receipts } = applyOps(draft, proposals.map(row => ({ op: 'add_skill', ...row, status: 'proposed' })))
        if (fromSamples) for (const receipt of receipts) { const skill = draft.skills.find(row => row.id === receipt?.target); if (skill) skill.sample = true }
        return draft
      })
      return json(res, 200, { added: proposals.length, state })
    }
    case 'skills/export': {
      const state = await store.read()
      const result = await exportSkill(state, dshHome())
      const next = await store.mutate('导出 Skill', (draft) => {
        applyOps(draft, draft.skills.filter(s => !s.sample && s.status === 'active').map(s => ({ op: 'update_skill', id: s.id, status: 'exported' })))
        return draft
      }, { undoable: false })
      return json(res, 200, { ...result, state: next })
    }
    default: return json(res, 404, { error: tr('接口不存在') })
  }
}

/**
 * Web 服务不会替插件路由鉴权，所以每个请求都要自己走一遍 Host/Origin 和登录凭证检查。
 * 拿不到鉴权服务时一律拒绝。
 * @param {object} ctx - Cordis 上下文。
 * @param {{headers: object}} req - HTTP 请求。
 * @returns {number|undefined} 拒绝时的状态码；可以继续时为 undefined。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = 'media-workbench'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    const desk = { store: null, settings: null, producer: null, settled: false, ready: null }
    desk.ready = (async () => {
      const root = await readWorkspaceDir()
      await ensureMarkdownDirs(root)
      Object.assign(desk, createRuntime(ctx, root))
      const saved = await desk.settings.read()
      setAssistantModel(saved.assistant)
    })()
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/media-workbench',
      handler: async (req, res) => {
        try {
          await desk.ready
          const rejection = requestRejection(ctx, req)
          if (rejection) {
            json(res, rejection, { error: tr('未授权') })
            return
          }
          await withLang(req.headers['x-media-workbench-lang'], () => route(ctx, desk.store, desk, req, res))
        } catch (err) {
          if (res.headersSent) {
            res.end()
            return
          }
          json(res, err.status || 500, { error: err.message })
        }
      },
    }), 'media-workbench: /media-workbench routes')
  },
}
