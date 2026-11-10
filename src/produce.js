// 一键成稿流水线：文章 → 标题与画面规划 → 封面、配图、分镜。
// 任务在 Host 里跑，关掉页面也不会中断；每生成一张图就落盘一次。
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { articlePrompts, extractJson, fallbackArticle, fallbackPlan, normalizeOutputFormat, planPrompts, shortCoverText } from './ai.js'
import { tr } from './i18n.js'
import { coverPrompt, figurePrompt, shotPrompt } from './images.js'
import { newId } from './ops.js'
import { imageReady } from './settings.js'

const CONCURRENCY = 3
// 模型卡住不出字时，到点改用草稿，不让进度条一直转
const TEXT_TIMEOUT_MS = 240_000
const RETRY_WAIT_MS = [6000, 14000]

function splitTitle(markdown, fallback) {
  const match = /^\s*#\s+(.+)\n?/.exec(markdown)
  if (!match) return { title: fallback, article: markdown.trim() }
  return { title: match[1].trim(), article: markdown.slice(match[0].length).trim() }
}

/** 模型给的规划不可信：只取需要的字段，数量按设置截断。 */
export function normalizePlan(plan, settings, title, format = 'video') {
  const normalized = normalizeOutputFormat(format)
  const text = (value, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const images = (Array.isArray(plan?.images) ? plan.images : []).slice(0, settings.imageCount).map(row => ({ caption: text(row?.caption, 60), anchor: text(row?.anchor, 60), prompt: text(row?.prompt, 1200) })).filter(row => row.prompt)
  const shots = (Array.isArray(plan?.shots) ? plan.shots : []).slice(0, settings.shotCount).map((row, index) => ({
    no: index + 1, shot: text(row?.shot, 12) || tr('中景'), visual: text(row?.visual, 200), voice: text(row?.voice, 200),
    seconds: Number.isFinite(row?.seconds) ? Math.max(1, Math.min(60, Math.round(row.seconds))) : 5, prompt: text(row?.prompt, 1200),
  })).filter(row => row.prompt || row.visual)
  return {
    title: text(plan?.title, 60) || title,
    coverText: normalized === 'video' ? text(plan?.coverText, 24) || shortCoverText(title) : '',
    facts: (Array.isArray(plan?.facts) ? plan.facts : []).map(row => text(row, 120)).filter(Boolean).slice(0, 8),
    outline: (Array.isArray(plan?.outline) ? plan.outline : []).map(row => text(row, 40)).filter(Boolean).slice(0, 6),
    cover: normalized === 'video' ? text(plan?.cover, 1200) || title : '',
    characters: text(plan?.characters, 400),
    // 图文和文章都需要配图；视频额外生成封面和分镜。
    images,
    shots: normalized === 'video' ? shots : [],
  }
}

function findTarget(state, id) {
  return state.items.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id) ?? null
}

function referenceIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(row => typeof row === 'string' ? row : row?.id).filter(Boolean))].slice(0, 12)
}

export function buildMergedItem(state, sourceIds, id = `merged_${sourceIds.join('_')}`) {
  const sources = sourceIds.map(sourceId => state.items.find(row => row.id === sourceId)).filter(Boolean)
  return {
    id,
    kind: 'note',
    title: sources.map(row => row.title).join('｜').slice(0, 120),
    body: sources.map((row, index) => `【素材 ${index + 1}】\n标题：${row.title}\n补充：${row.body || ''}\n标签：${(row.tags ?? []).join('、')}\n来源：${row.source || ''}`).join('\n\n---\n\n'),
    tags: [...new Set(sources.flatMap(row => row.tags ?? []))].slice(0, 24),
    source: tr('合并灵感'),
    url: null,
    angleId: null,
    personaIds: [],
    sourceIds: [...sourceIds],
  }
}

function parseTarget(target) {
  if (target === 'cover') return { kind: 'cover' }
  const match = /^(image|shot):(\d{1,2})$/.exec(String(target))
  return match ? { kind: match[1], index: Number(match[2]) } : null
}

function assetAt(production, target) {
  const parsed = parseTarget(target)
  if (!parsed) return null
  if (parsed.kind === 'cover') return production.cover
  return (parsed.kind === 'image' ? production.images : production.shots)?.[parsed.index] ?? null
}

function fullPrompt(production, target, asset) {
  const { kind } = parseTarget(target)
  if (kind === 'cover') return coverPrompt(asset.prompt)
  if (kind === 'image') return figurePrompt(asset.prompt)
  return shotPrompt(asset.prompt || asset.visual, production.characters)
}

/**
 * 把对话里的修改落到成稿上。模型输出不可信：只认这几个字段，序号越界的直接丢弃。
 * @param {object} production - 成稿，会被就地修改。
 * @param {object} revise - 模型给出的修改。
 * @param {{canDraw?: boolean}} [options] - 没接生图时，回执只说更新了画面描述。
 * @returns {{receipts: string[], errors: string[], targets: string[]}} 回执和需要重画的图。
 */
export function applyRevision(production, revise, { canDraw = true } = {}) {
  const receipts = []
  const errors = []
  const targets = []
  const redraw = what => (canDraw ? tr('重画{what}', { what }) : tr('更新了画面描述：{what}（接入生图模型后才会重画）', { what }))
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const title = text(revise?.title, 80)
  if (title && title !== production.title) {
    production.title = title
    receipts.push(tr('标题改成《{title}》', { title }))
  }
  const coverText = text(revise?.coverText, 24)
  if (coverText && coverText !== production.coverText) {
    production.coverText = coverText
    receipts.push(tr('封面大字改成「{text}」', { text: coverText }))
  }
  if (typeof revise?.article === 'string' && revise.article.trim()) {
    production.article = revise.article.replace(/^\s*#\s+.*\n?/, '').trim().slice(0, 200000)
    receipts.push(tr('重写了脚本'))
  } else if (Array.isArray(revise?.edits)) {
    let changed = 0
    for (const edit of revise.edits.slice(0, 20)) {
      if (typeof edit?.find !== 'string' || typeof edit?.replace !== 'string' || !edit.find) continue
      if (production.article.includes(edit.find)) {
        production.article = production.article.replace(edit.find, () => edit.replace)
        changed += 1
      } else {
        errors.push(tr('脚本里没找到「{text}」', { text: edit.find.slice(0, 16) }))
      }
    }
    if (changed) receipts.push(tr(changed === 1 ? '改了脚本的 1 处' : '改了脚本的 {n} 处', { n: changed }))
  }
  const coverPrompt = text(revise?.cover?.prompt, 1200)
  if (coverPrompt && production.cover) {
    production.cover.prompt = coverPrompt
    targets.push('cover')
    receipts.push(redraw(tr('封面')))
  }
  for (const row of Array.isArray(revise?.images) ? revise.images.slice(0, 8) : []) {
    const image = production.images?.[Number(row?.no) - 1]
    if (!image) continue
    const caption = text(row.caption, 40)
    if (caption) image.caption = caption
    const prompt = text(row.prompt, 1200)
    if (prompt) {
      image.prompt = prompt
      targets.push(`image:${Number(row.no) - 1}`)
    }
    receipts.push(prompt ? redraw(tr('配图 {no}', { no: row.no })) : tr('改了配图 {no} 的图注', { no: row.no }))
  }
  for (const row of Array.isArray(revise?.shots) ? revise.shots.slice(0, 24) : []) {
    const shot = production.shots?.[Number(row?.no) - 1]
    if (!shot) continue
    for (const [key, max] of [['shot', 12], ['visual', 200], ['voice', 200]]) {
      const value = text(row[key], max)
      if (value) shot[key] = value
    }
    if (Number.isFinite(row.seconds)) shot.seconds = Math.max(1, Math.min(60, Math.round(row.seconds)))
    const prompt = text(row.prompt, 1200)
    if (prompt) {
      shot.prompt = prompt
      targets.push(`shot:${Number(row.no) - 1}`)
    }
    receipts.push(prompt ? redraw(tr('第 {no} 镜', { no: row.no })) : tr('改了第 {no} 镜的文案', { no: row.no }))
  }
  return { receipts, errors, targets }
}

export class Producer {
  /**
   * @param {{store: object, settings: object, callText: Function, generate: Function, ready?: Function}} deps - 存储、设置、文本模型和生图函数。
   */
  constructor({ store, settings, callText, generate, ready = imageReady }) {
    this.store = store
    this.settings = settings
    this.callText = callText
    this.generate = generate
    this.ready = ready
    this.jobs = new Map()
    this.assets = new Set()
  }

  isRunning(id) {
    return this.jobs.has(id)
  }

  status(id) {
    const job = this.jobs.get(id)
    if (!job) return { running: false }
    // 策划案是流式写出来的：标题和分镜一出现就先显示
    const plan = job.planText
    return {
      running: true,
      stage: job.stage,
      text: job.text,
      title: /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(plan)?.[1],
      visuals: [...plan.matchAll(/"visual"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]),
    }
  }

  patch(id, mutate) {
    return this.store.mutate('成稿', (state) => {
      const item = findTarget(state, id)
      if (item?.production) mutate(item.production, item)
      return state
    }, { undoable: false })
  }

  async start(id, { format = 'video', references = [] } = {}) {
    const normalized = normalizeOutputFormat(format)
    if (this.jobs.has(id)) return false
    const state = await this.store.read()
    const item = state.items.find(row => row.id === id)
    if (!item) throw Object.assign(new Error(tr('找不到这条灵感')), { status: 404 })
    const job = { stage: 'brief', text: '', planText: '', controller: new AbortController(), sourceIds: [id], referenceIds: referenceIds(references), format: normalized, merged: false }
    this.jobs.set(id, job)
    await this.store.mutate('开始成稿', (draft) => {
      const target = draft.items.find(row => row.id === id)
      target.production = { status: 'running', stage: 'brief', startedAt: new Date().toISOString(), title: target.title, article: '', format: normalized, sourceIds: [id], references: job.referenceIds, cover: null, images: [], shots: [] }
      return draft
    }, { undoable: false })
    // 不等待：浏览器靠轮询拿进度
    this.run(id, job).catch(() => {}).finally(() => this.jobs.delete(id))
    return true
  }

  async startMerge(sourceIds, { format = 'video', references = [], draftId = null } = {}) {
    const normalized = normalizeOutputFormat(format)
    const ids = [...new Set((Array.isArray(sourceIds) ? sourceIds : []).filter(Boolean))].slice(0, 12)
    const state = await this.store.read()
    const sources = ids.map(id => state.items.find(row => row.id === id)).filter(Boolean)
    if (sources.length < 2) throw Object.assign(new Error(tr('至少选择两条灵感才能合并成稿')), { status: 400 })
    const reusableId = typeof draftId === 'string' && draftId && state.mergedDrafts?.some(row => row.id === draftId)
    const id = reusableId ? draftId : newId('md')
    const item = buildMergedItem(state, sources.map(row => row.id), id)
    if (!reusableId) await this.store.mutate('开始合并成稿', (draft) => {
      draft.mergedDrafts ??= []
      draft.mergedDrafts.unshift({ id, sourceIds: item.sourceIds, title: item.title, createdAt: new Date().toISOString(), status: 'outline', scheduledAt: null, platform: null, production: null })
      return draft
    }, { undoable: false })
    const job = { stage: 'brief', text: '', planText: '', controller: new AbortController(), sourceIds: item.sourceIds, referenceIds: referenceIds(references), format: normalized, merged: true }
    this.jobs.set(id, job)
    await this.store.mutate('开始合并成稿', (draft) => {
      const target = draft.mergedDrafts.find(row => row.id === id)
      target.sourceIds = item.sourceIds
      target.title = item.title
      target.status = target.status === 'archived' ? 'outline' : (target.status ?? 'outline')
      target.scheduledAt ??= null
      target.platform ??= null
      target.production = { status: 'running', stage: 'brief', startedAt: new Date().toISOString(), title: item.title, article: '', format: normalized, sourceIds: item.sourceIds, references: job.referenceIds, cover: null, images: [], shots: [] }
      return draft
    }, { undoable: false })
    this.run(id, job).catch(() => {}).finally(() => this.jobs.delete(id))
    return id
  }

  async cancel(id) {
    this.jobs.get(id)?.controller.abort()
  }

  async run(id, job) {
    // 保留 start() 放进 jobs Map 的同一个对象。否则用展开复制后，进度更新
    // 会写到副本，轮询看到的 stage/text 永远停在初始值。
    job ??= {}
    job.sourceIds ??= [id]
    job.referenceIds ??= []
    job.format ??= 'video'
    job.merged ??= false
    job.controller ??= new AbortController()
    job.planText ??= ''
    job.text ??= ''
    job.stage ??= 'brief'
    const { signal } = job.controller
    try {
      const settings = await this.settings.read()
      const state = await this.store.read()
      const snapshot = JSON.parse(JSON.stringify(state))
      const sourceItems = job.sourceIds.map(sourceId => snapshot.items.find(row => row.id === sourceId)).filter(Boolean)
      const referenceItems = job.referenceIds.map(referenceId => snapshot.items.find(row => row.id === referenceId)).filter(row => row?.imported && !job.sourceIds.includes(row.id))
      const promptSources = [...sourceItems, ...referenceItems]
      const item = job.merged ? buildMergedItem(snapshot, job.sourceIds, id) : sourceItems[0]
      if (!item) throw new Error(tr('找不到这条灵感'))

      signal.throwIfAborted()
      const backup = normalizePlan(fallbackPlan(item, '', settings, job.format), settings, item.title, job.format)

      let plan
      try {
        const prompts = planPrompts(snapshot, item, settings, job.format, promptSources)
        const { text } = await this.callText({ ...prompts, maxTokens: 3000, light: true, signal: AbortSignal.any([signal, AbortSignal.timeout(TEXT_TIMEOUT_MS)]), onText: (delta) => { job.planText += delta } })
        plan = normalizePlan(extractJson(text), settings, item.title, job.format)
      } catch (err) {
        if (signal.aborted) throw err
        plan = backup
      }
      // 模型漏掉配图或分镜时用模板补上，流水线不能因此少一块
      if (plan.images.length < settings.imageCount) plan.images = [...plan.images, ...backup.images.slice(plan.images.length)]
      if (job.format === 'video' && plan.shots.length < settings.shotCount) plan.shots = [...plan.shots, ...backup.shots.slice(plan.shots.length).map((row, i) => ({ ...row, no: plan.shots.length + i + 1 }))]

      const ready = this.ready(settings)
      const initial = ready ? 'pending' : 'skipped'
      job.stage = 'making'
      await this.patch(id, (production) => {
        production.stage = 'making'
        production.title = plan.title
        production.coverText = plan.coverText
        production.facts = plan.facts
        production.outline = plan.outline
        production.characters = plan.characters
        production.cover = job.format === 'video' ? { prompt: plan.cover, status: initial } : null
        production.images = plan.images.map(row => ({ ...row, status: initial }))
        production.shots = plan.shots.map(row => ({ ...row, status: initial }))
        if (!ready) production.needsProvider = true
      })

      // 策划案定了之后，文章和所有画面同时开工
      const writeArticle = async () => {
        let engine = 'local'
        let notice = null
        let markdown = ''
        try {
          const prompts = articlePrompts(snapshot, item, settings.voice, plan, job.format, promptSources)
          const result = await this.callText({ ...prompts, maxTokens: 6000, signal: AbortSignal.any([signal, AbortSignal.timeout(TEXT_TIMEOUT_MS)]), onText: (delta) => { job.text += delta } })
          markdown = result.text
          engine = result.model
          if (!markdown.trim()) throw new Error(tr('模型返回了空内容'))
        } catch (err) {
          if (signal.aborted) throw err
          markdown = fallbackArticle(snapshot, item)
          job.text = markdown
          notice = tr('没有连上文字模型，先给你一份结构草稿。可以到 DeepSeek Harness 设置里检查模型。')
        }
        const { article } = splitTitle(markdown, plan.title)
        await this.patch(id, (production) => {
          production.article = article
          production.aiArticle = article
          production.engine = engine
          production.notice = notice
        })
      }

      const tasks = [writeArticle()]
      if (ready) {
        const targets = [...(job.format === 'video' ? ['cover'] : []), ...plan.images.map((_, i) => `image:${i}`), ...plan.shots.map((_, i) => `shot:${i}`)]
        let next = 0
        const worker = async () => {
          while (next < targets.length && !signal.aborted) {
            const target = targets[next]
            next += 1
            await this.renderAsset(id, target, settings, signal)
          }
        }
        for (let i = 0; i < CONCURRENCY; i += 1) tasks.push(worker())
      }
      await Promise.all(tasks)
      if (signal.aborted) throw new Error('cancelled')

      await this.store.mutate('完成成稿', (draft) => {
        const target = findTarget(draft, id)
        if (!target?.production) return draft
        target.production.status = 'done'
        target.production.stage = 'done'
        target.production.finishedAt = new Date().toISOString()
        if (['idea', 'outline'].includes(target.status)) target.status = target.scheduledAt ? 'ready' : 'draft'
        return draft
      }, { undoable: false })
    } catch (err) {
      const cancelled = signal.aborted
      await this.patch(id, (production) => {
        production.status = cancelled ? 'cancelled' : 'failed'
        production.stage = 'done'
        production.error = cancelled ? null : err.message
        for (const asset of [production.cover, ...production.images ?? [], ...production.shots ?? []]) {
          if (asset && ['pending', 'running'].includes(asset.status)) asset.status = 'idle'
        }
      })
    }
  }

  /** 生图服务限流（429）时等一会儿再试，最多再试两次；其他错误直接报。 */
  async generateWithRetry(image, prompt, signal) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.generate(image, prompt, { signal })
      } catch (err) {
        const limited = err?.status === 429 || /429/.test(String(err?.message))
        if (err.permanent || !limited || attempt >= RETRY_WAIT_MS.length || signal?.aborted) throw err
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, RETRY_WAIT_MS[attempt] * (this.retryScale ?? 1))
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')) }, { once: true })
        })
      }
    }
  }

  async renderAsset(id, target, settings, signal) {
    let prompt = null
    await this.patch(id, (production) => {
      const asset = assetAt(production, target)
      if (!asset) return
      asset.status = 'running'
      asset.error = null
      prompt = fullPrompt(production, target, asset)
    })
    if (!prompt) return
    try {
      const { buffer, ext } = await this.generateWithRetry(settings.image, prompt, signal)
      const name = `${newId('g')}${ext}`
      await writeFile(join(this.store.filesDir, name), buffer)
      await this.patch(id, (production) => {
        const asset = assetAt(production, target)
        if (!asset) return
        asset.status = 'done'
        asset.src = `media-workbench/files/${name}`
      })
    } catch (err) {
      if (signal?.aborted) return
      await this.patch(id, (production) => {
        const asset = assetAt(production, target)
        if (!asset) return
        asset.status = 'failed'
        asset.error = err.message
      })
    }
  }

  /** 单独重画一张。 */
  async regenerate(id, target) {
    const settings = await this.settings.read()
    if (!this.ready(settings)) throw Object.assign(new Error(tr('还没有接入生图模型')), { status: 400 })
    if (!parseTarget(target)) throw Object.assign(new Error(tr('目标无效')), { status: 400 })
    const key = `${id}:${target}`
    if (this.assets.has(key)) return
    const state = await this.store.read()
    const production = findTarget(state, id)?.production
    if (!production || !assetAt(production, target)) throw Object.assign(new Error(tr('找不到这张图')), { status: 404 })
    this.assets.add(key)
    await this.patch(id, (next) => { assetAt(next, target).status = 'running' })
    this.renderAsset(id, target, settings).catch(() => {}).finally(() => this.assets.delete(key))
  }

  /** Host 重启后，没人在跑的「进行中」不能一直转圈。 */
  /** Host 重启后，把上次没做完的成稿都标成中断，卡片不会一直显示「正在成稿」。 */
  async settleAll() {
    const state = await this.store.read()
    for (const item of [...state.items, ...(state.mergedDrafts ?? [])]) if (item.production?.status === 'running') await this.settle(item.id)
  }

  async settle(id) {
    const state = await this.store.read()
    const production = findTarget(state, id)?.production
    if (!production || this.jobs.has(id)) return
    const stuck = !this.anyAssetActive(id) && [production.cover, ...production.images ?? [], ...production.shots ?? []].some(asset => asset?.status === 'running')
    if (production.status !== 'running' && !stuck) return
    await this.patch(id, (next) => {
      if (next.status === 'running') {
        next.status = 'failed'
        next.stage = 'done'
        next.error = tr('上次成稿被中断了，可以重新开始')
      }
      for (const asset of [next.cover, ...next.images ?? [], ...next.shots ?? []]) {
        if (asset && ['pending', 'running'].includes(asset.status)) asset.status = 'idle'
      }
    })
  }

  anyAssetActive(id) {
    return [...this.assets].some(key => key.startsWith(`${id}:`))
  }
}
