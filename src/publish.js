// 发布任务：把成稿整理成一次性本地交接任务，供浏览器桥接页或兼容工具读取。
// 这里不保存 Cookie、密码或第三方长期凭据；媒体仍引用工作台自己的附件路径。
import { newId } from './ops.js'

export const PUBLISH_JOB_STATUSES = [
  'ready',
  'opening',
  'handed_off',
  'awaiting_platform',
  'awaiting_user',
  'published',
  'failed',
  'expired',
]

const JOB_TTL_MS = 15 * 60 * 1000

function text(value, max = 200000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function asset(value, role, index = null) {
  if (!value || typeof value.src !== 'string' || !value.src) return null
  return {
    role,
    ...(index === null ? {} : { index }),
    src: value.src,
    ...(typeof value.poster === 'string' && value.poster ? { poster: value.poster } : {}),
    ...(Number.isFinite(value.w) ? { w: value.w } : {}),
    ...(Number.isFinite(value.h) ? { h: value.h } : {}),
  }
}

function targetFor(state, id) {
  return state.items?.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id) ?? null
}

export function buildPublishSource(target) {
  const production = target?.production
  if (!production || production.status !== 'done' || !text(production.article)) return null
  const title = text(production.title, 200) || text(target.title, 200)
  const article = text(production.article)
  const media = [
    asset(production.cover, 'cover'),
    ...(Array.isArray(production.images) ? production.images.map((row, index) => asset(row, 'image', index)).filter(Boolean) : []),
    ...(Array.isArray(production.shots) ? production.shots.map((row, index) => asset(row, 'shot', index)).filter(Boolean) : []),
  ]
  if (!media.length && target.media) {
    const fallback = asset(target.media, target.kind === 'video' ? 'video' : 'media')
    if (fallback) media.push(fallback)
  }
  return {
    title,
    body: article,
    markdown: `# ${title}\n\n${article}\n`,
    format: production.format || (target.kind === 'video' ? 'video' : 'article'),
    tags: Array.isArray(target.tags) ? target.tags.filter(value => typeof value === 'string').slice(0, 24) : [],
    media,
  }
}

export function createPublishJob(state, id, { adapter = 'aibeike', now = new Date() } = {}) {
  const target = targetFor(state, id)
  if (!target) throw Object.assign(new Error('找不到这条内容'), { status: 404 })
  const source = buildPublishSource(target)
  if (!source) throw Object.assign(new Error('请先完成成稿，再发布'), { status: 400 })
  const createdAt = new Date(now).toISOString()
  const job = {
    id: newId('pub'),
    contentId: id,
    adapter: adapter === 'aibeike' ? 'aibeike' : 'manual',
    nonce: newId('nonce'),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(new Date(now).getTime() + JOB_TTL_MS).toISOString(),
    status: 'ready',
    attempts: 0,
    source,
    variants: {},
    externalId: null,
    externalUrl: null,
    lastError: null,
    publishedAt: null,
  }
  state.publishJobs = [job, ...(Array.isArray(state.publishJobs) ? state.publishJobs : [])].slice(0, 50)
  return job
}

export function findPublishJob(state, id) {
  return (Array.isArray(state.publishJobs) ? state.publishJobs : []).find(job => job.id === id) ?? null
}

export function isPublishJobExpired(job, now = new Date()) {
  return !job?.expiresAt || Date.parse(job.expiresAt) <= new Date(now).getTime()
}

export function updatePublishJob(state, id, patch = {}, now = new Date()) {
  const job = findPublishJob(state, id)
  if (!job) throw Object.assign(new Error('找不到发布任务'), { status: 404 })
  const allowed = new Set(PUBLISH_JOB_STATUSES)
  if (patch.status !== undefined) {
    if (!allowed.has(patch.status)) throw Object.assign(new Error('发布状态无效'), { status: 400 })
    job.status = patch.status
  }
  if (patch.externalId !== undefined) job.externalId = typeof patch.externalId === 'string' ? patch.externalId.slice(0, 500) : null
  if (patch.externalUrl !== undefined) job.externalUrl = typeof patch.externalUrl === 'string' ? patch.externalUrl.slice(0, 2000) : null
  if (patch.lastError !== undefined) job.lastError = typeof patch.lastError === 'string' ? patch.lastError.slice(0, 1000) : null
  if (patch.attempts !== undefined && Number.isFinite(patch.attempts)) job.attempts = Math.max(0, Math.min(99, Math.round(patch.attempts)))
  if (patch.publishedAt !== undefined) job.publishedAt = typeof patch.publishedAt === 'string' ? patch.publishedAt : null
  if (patch.status === 'published' && !job.publishedAt) job.publishedAt = new Date(now).toISOString()
  job.updatedAt = new Date(now).toISOString()
  return job
}

export function publicPublishJob(job) {
  if (!job) return null
  return structuredClone(job)
}

