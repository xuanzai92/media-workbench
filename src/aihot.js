// AIHOT v1 只读客户端：固定 endpoint、按响应缓存、保留来源和 canonical 链接。
import { tr } from './i18n.js'

const BASE_URL = 'https://aihot.news/api/v1'
const MIN_CACHE_MS = 60_000
const MAX_TEXT = 4_000_000
const cache = new Map()

const TABS = new Set(['selected', 'all', 'hot'])
const CATEGORIES = new Set(['ai-models', 'ai-products', 'industry', 'paper', 'tip', 'opinion'])

function text(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function queryValue(value, max = 200) {
  const valueText = text(value, max)
  return valueText || null
}

function normalizeItem(row) {
  if (!row || typeof row !== 'object') return null
  const aiHot = safeUrl(row.links?.aihot)
  if (!aiHot) return null
  const original = safeUrl(row.links?.original)
  const source = text(row.source?.name, 160) || tr('AIHOT')
  const category = text(row.category, 40)
  return {
    id: text(row.id, 120),
    title: text(row.title, 240) || tr('无标题'),
    originalTitle: text(row.originalTitle, 240),
    summary: text(row.summary, 1800),
    reason: text(row.reason, 900),
    source,
    category: CATEGORIES.has(category) ? category : '',
    score: Number.isFinite(row.score) ? row.score : null,
    selected: row.selected === true,
    publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : null,
    discoveredAt: typeof row.discoveredAt === 'string' ? row.discoveredAt : null,
    links: { aihot: aiHot, ...(original ? { original } : {}) },
    attribution: {
      name: text(row.attribution?.name, 160) || 'AIHOT',
      url: safeUrl(row.attribution?.url) || aiHot,
    },
  }
}

function normalizeTopic(row) {
  if (!row || typeof row !== 'object') return null
  const aiHot = safeUrl(row.links?.aihot)
  if (!aiHot) return null
  const original = safeUrl(row.links?.original)
  const story = safeUrl(row.links?.story)
  return {
    rank: Number.isFinite(row.rank) ? row.rank : null,
    id: text(row.id, 120),
    title: text(row.title, 240) || tr('无标题'),
    source: text(row.source?.name, 160),
    sourceCount: Number.isFinite(row.sourceCount) ? row.sourceCount : null,
    signalCount: Number.isFinite(row.signalCount) ? row.signalCount : null,
    participantCount: Number.isFinite(row.participantCount) ? row.participantCount : null,
    sourceNames: Array.isArray(row.sourceNames) ? row.sourceNames.filter(v => typeof v === 'string').slice(0, 12) : [],
    latestAt: typeof row.latestAt === 'string' ? row.latestAt : null,
    links: { aihot: aiHot, ...(original ? { original } : {}), ...(story ? { story } : {}) },
  }
}

function parseSeconds(value) {
  const match = /(?:s-maxage|max-age)\s*=\s*(\d+)/i.exec(value || '')
  return match ? Number(match[1]) : 60
}

function errorForStatus(status) {
  if (status === 429) return new Error(tr('AIHOT 请求太频繁，请稍后再试'))
  if (status === 503) return new Error(tr('AIHOT 暂时不可用，请稍后再试'))
  return new Error(tr('AIHOT 返回了错误（{status}）', { status }))
}

function validateTab(tab) {
  if (!TABS.has(tab)) throw Object.assign(new Error(tr('热点分区无效')), { status: 400 })
}

function buildRequest(tab, params = {}) {
  validateTab(tab)
  const search = new URLSearchParams()
  if (tab === 'hot') return { path: '/hot-topics', search }
  search.set('mode', tab === 'selected' ? 'selected' : 'all')
  search.set('window', '7d')
  search.set('limit', String(Math.min(50, Math.max(1, Number(params.limit) || 30))))
  const category = queryValue(params.category, 40)
  if (category) {
    if (!CATEGORIES.has(category)) throw Object.assign(new Error(tr('热点分类无效')), { status: 400 })
    search.set('category', category)
  }
  const q = queryValue(params.q, 200)
  if (q) {
    if ([...q].length < 2) throw Object.assign(new Error(tr('热点搜索词至少需要两个字')), { status: 400 })
    search.set('q', q)
  }
  const cursor = queryValue(params.cursor, 600)
  if (cursor) search.set('cursor', cursor)
  return { path: '/items', search }
}

async function readJson(response) {
  const raw = await response.text()
  if (raw.length > MAX_TEXT) throw new Error(tr('AIHOT 返回内容太大'))
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(tr('AIHOT 返回的内容无法读取'))
  }
}

function normalizeResponse(tab, data) {
  if (!data || typeof data !== 'object') throw new Error(tr('AIHOT 返回的数据无效'))
  if (tab === 'hot') {
    return {
      tab,
      items: [],
      topics: Array.isArray(data.items) ? data.items.map(normalizeTopic).filter(Boolean) : [],
      page: { count: Number.isFinite(data.count) ? data.count : 0, hasMore: false, nextCursor: null },
    }
  }
  return {
    tab,
    items: Array.isArray(data.items) ? data.items.map(normalizeItem).filter(Boolean) : [],
    topics: [],
    query: data.query && typeof data.query === 'object' ? {
      mode: text(data.query.mode, 20),
      category: text(data.query.category, 40) || null,
      window: text(data.query.window, 10),
      q: text(data.query.q, 200) || null,
    } : null,
    page: {
      count: Number.isFinite(data.page?.count) ? data.page.count : 0,
      hasMore: data.page?.hasMore === true,
      nextCursor: typeof data.page?.nextCursor === 'string' ? data.page.nextCursor : null,
    },
  }
}

async function fetchRemote(tab, params, previous) {
  const { path, search } = buildRequest(tab, params)
  const key = `${tab}?${search.toString()}`
  const now = Date.now()
  const saved = cache.get(key)
  if (!params.refresh && saved && saved.expiresAt > now) return { ...saved.data, cached: true, stale: false, fetchedAt: saved.fetchedAt }

  const headers = { accept: 'application/json', 'accept-encoding': 'gzip' }
  if (saved?.etag) headers['if-none-match'] = saved.etag
  let response
  try {
    response = await fetch(`${BASE_URL}${path}?${search.toString()}`, { headers, signal: AbortSignal.timeout(12_000) })
  } catch {
    if (saved?.data) return { ...saved.data, cached: true, stale: true, fetchedAt: saved.fetchedAt }
    throw new Error(tr('AIHOT 暂时无法连接，请稍后再试'))
  }
  if (response.status === 304 && saved?.data) {
    saved.expiresAt = now + Math.max(MIN_CACHE_MS, parseSeconds(response.headers.get('cache-control')) * 1000)
    return { ...saved.data, cached: true, stale: false, fetchedAt: saved.fetchedAt }
  }
  if (!response.ok) {
    if (saved?.data && [429, 500, 502, 503, 504].includes(response.status)) return { ...saved.data, cached: true, stale: true, fetchedAt: saved.fetchedAt }
    throw errorForStatus(response.status)
  }
  const data = normalizeResponse(tab, await readJson(response))
  const fetchedAt = new Date().toISOString()
  cache.set(key, {
    data,
    etag: response.headers.get('etag') || null,
    fetchedAt,
    expiresAt: now + Math.max(MIN_CACHE_MS, parseSeconds(response.headers.get('cache-control')) * 1000),
  })
  return { ...data, cached: false, stale: false, fetchedAt }
}

export async function fetchAihot(tab, params = {}) {
  return fetchRemote(tab, params)
}

export function clearAihotCache() {
  cache.clear()
}

