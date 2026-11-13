// xbangdan 公开榜单读取：只访问固定的公开 JSON，不接受客户端传入 URL。
import { tr } from './i18n.js'

const FEED_URL = 'https://xbangdan.com/hot.json'
const REQUEST_TIMEOUT_MS = 15_000
const FEED_CACHE_TTL_MS = 60_000
const SECTIONS = new Set(['rate', 'views'])
const CATEGORIES = new Set(['all', 'ai', 'finance', 'self_media'])
const HOURS = new Set([3, 6, 12, 24])

// The upstream feed is shared by every filter combination. Keep one short-lived
// in-memory copy so switching tabs does not trigger another remote request.
let feedCache = null
let feedCacheAt = 0
let feedPromise = null

function text(value, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeId(value) {
  const id = String(value ?? '').trim()
  return /^\d{4,40}$/.test(id) ? id : ''
}

function safeHandle(value) {
  const handle = String(value ?? '').trim()
  return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle : ''
}

function categoryMatches(value, category) {
  if (category === 'all') return true
  const raw = String(value ?? '').toLowerCase()
  if (category === 'ai') return raw === 'ai_coding' || raw.startsWith('ai_') || raw.includes('ai')
  if (category === 'finance') return raw === 'finance' || raw.includes('finance')
  return raw === 'growth' || raw.includes('growth') || raw.includes('media') || raw.includes('creator')
}

function normalizeRow(row, section, index, updated) {
  if (!row || typeof row !== 'object') return null
  const id = safeId(row.id)
  const handle = safeHandle(row.h)
  if (!id || !handle) return null
  const age = Number(row.age)
  const publishedAt = Number.isFinite(age) && Number.isFinite(updated)
    ? new Date((updated - Math.max(0, age) * 3600) * 1000).toISOString()
    : null
  return {
    id,
    rank: index + 1,
    section,
    handle,
    name: text(row.n, 120) || `@${handle}`,
    text: text(row.t, 1400) || tr('无标题'),
    category: text(row.c, 40) || 'none',
    followers: Number.isFinite(Number(row.fo)) ? Number(row.fo) : null,
    exposure: Number.isFinite(Number(row.v)) ? Number(row.v) : null,
    interactions: Number.isFinite(Number(row.r)) ? Number(row.r) : null,
    likes: Number.isFinite(Number(row.l)) ? Number(row.l) : null,
    age: Number.isFinite(age) ? age : null,
    publishedAt,
    url: `https://x.com/${handle}/status/${id}`,
  }
}

function validateOptions({ section, category, hours }) {
  if (!SECTIONS.has(section)) throw Object.assign(new Error(tr('xbangdan 榜单分区无效')), { status: 400 })
  if (!CATEGORIES.has(category)) throw Object.assign(new Error(tr('xbangdan 赛道无效')), { status: 400 })
  if (!HOURS.has(hours)) throw Object.assign(new Error(tr('xbangdan 时间范围无效')), { status: 400 })
}

export async function fetchXbangdan({ section = 'rate', category = 'all', hours = 24 } = {}, fetchImpl = fetch) {
  const normalizedHours = Number(hours)
  validateOptions({ section, category, hours: normalizedHours })
  const loadFeed = async () => {
    const response = await fetchImpl(`${FEED_URL}?t=${Date.now()}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'media-workbench/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw Object.assign(new Error(tr('xbangdan 返回了错误（{status}）', { status: response.status })), { status: 502 })
    try { return await response.json() } catch { throw Object.assign(new Error(tr('xbangdan 返回的内容不是有效 JSON')), { status: 502 }) }
  }

  // Do not share test/injected fetch implementations across calls. In the app,
  // dedupe both concurrent requests and filter changes against the native fetch.
  const canCache = fetchImpl === globalThis.fetch
  let data
  if (canCache && feedCache && Date.now() - feedCacheAt < FEED_CACHE_TTL_MS) {
    data = feedCache
  } else if (canCache && feedPromise) {
    data = await feedPromise
  } else {
    const pending = loadFeed()
    if (canCache) feedPromise = pending
    try {
      data = await pending
      if (canCache) {
        feedCache = data
        feedCacheAt = Date.now()
      }
    } finally {
      if (canCache && feedPromise === pending) feedPromise = null
    }
  }
  const updated = Number(data?.updated)
  const rows = Array.isArray(data?.[section]) ? data[section] : []
  const normalized = rows.map((row, index) => normalizeRow(row, section, index, updated)).filter(Boolean)
    .filter(row => categoryMatches(row.category, category))
    .filter(row => row.age === null || row.age <= normalizedHours)
  return {
    source: 'xbangdan.com',
    updated: Number.isFinite(updated) ? new Date(updated * 1000).toISOString() : null,
    section,
    category,
    hours: normalizedHours,
    rows: normalized,
  }
}

