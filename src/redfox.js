// RedFox 统一数据服务：用 HTTP API 读取公开账号、作品和互动数据。
// API Key 只从本地 settings 传入，不进入浏览器状态，也不写进内容数据。
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertPublicUrl } from './harvest.js'
import { newId } from './ops.js'
import { platformName, tr } from './i18n.js'

const BASE_URL = 'https://redfox.hk'
const POST_COUNT = 20
const REQUEST_TIMEOUT_MS = 60_000
const COVER_MAX_BYTES = 8 * 1024 * 1024
const COVER_CONCURRENCY = 4
const SHORT_HOSTS = ['xhslink.com', 'v.douyin.com', 'b23.tv', 'vm.tiktok.com', 'vt.tiktok.com']

const RESERVED = {
  Instagram: new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv']),
  X: new Set(['i', 'home', 'search', 'explore', 'intent', 'share', 'settings', 'messages', 'notifications', 'hashtag', 'compose']),
}

function hostIs(host, name) {
  return host === name || host.endsWith(`.${name}`)
}

function text(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function count(value) {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function dateValue(value) {
  if (Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString()
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function firstLine(value, fallback) {
  const line = text(value, 300).split('\n').find(row => row.trim())?.trim() ?? ''
  return line.slice(0, 80) || fallback
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return null
  const url = value.startsWith('//') ? `https:${value}` : value.replace(/^http:\/\//, 'https://')
  return url.startsWith('https://') ? url : null
}

export function findUrl(value) {
  const match = /https?:\/\/[^\s，。！？、；：「」《》（）()"'<>]+/i.exec(String(value ?? ''))
  return match?.[0] ?? null
}

export function parseAccountUrl(raw) {
  let url
  try { url = new URL(raw) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const host = url.hostname.toLowerCase()
  if (hostIs(host, 'xiaohongshu.com')) {
    const id = /^\/user\/profile\/([0-9a-f]{24})(?:\/|$)/i.exec(url.pathname)?.[1]
    return id ? { platform: '小红书', id, userId: id, url: `https://www.xiaohongshu.com/user/profile/${id}` } : null
  }
  if (hostIs(host, 'douyin.com') || hostIs(host, 'iesdouyin.com')) {
    const id = /^\/(?:share\/)?user\/([\w-]{20,160})(?:\/|$)/.exec(url.pathname)?.[1]
    return id ? { platform: '抖音', id, secUserId: id, url: `https://www.douyin.com/user/${id}` } : null
  }
  if (host === 'space.bilibili.com' || host === 'm.bilibili.com') {
    const id = /^\/(?:space\/)?(\d{1,20})(?:\/|$)/.exec(url.pathname)?.[1]
    return id ? { platform: 'B站', id, mid: id, url: `https://space.bilibili.com/${id}` } : null
  }
  if (hostIs(host, 'tiktok.com')) {
    const id = /^\/@([\w.]{2,24})(?:\/|$)/.exec(url.pathname)?.[1]
    return id ? { platform: 'TikTok', id, handle: id, url: `https://www.tiktok.com/@${id}` } : null
  }
  if (hostIs(host, 'instagram.com')) {
    const id = /^\/([\w.]{1,30})\/?$/.exec(url.pathname)?.[1]
    return id && !RESERVED.Instagram.has(id.toLowerCase()) ? { platform: 'Instagram', id, username: id, url: `https://www.instagram.com/${id}/` } : null
  }
  if (hostIs(host, 'x.com') || hostIs(host, 'twitter.com')) {
    const id = /^\/(\w{1,15})\/?$/.exec(url.pathname)?.[1]
    return id && !RESERVED.X.has(id.toLowerCase()) ? { platform: 'X', id, screenName: id, url: `https://x.com/${id}` } : null
  }
  return null
}

export async function resolveAccount(value, fetchImpl = fetch) {
  const first = findUrl(value)
  if (!first) throw Object.assign(new Error(tr('没找到链接，请贴账号主页的链接')), { status: 400 })
  const unsupported = () => Object.assign(new Error(tr('认不出这个主页。目前支持小红书、抖音、B 站、TikTok、Instagram 和 X 的账号主页链接。')), { status: 400 })
  let current = first
  for (let hop = 0; hop < 4; hop += 1) {
    const account = parseAccountUrl(current)
    if (account) return account
    const url = new URL(current)
    if (!SHORT_HOSTS.some(name => hostIs(url.hostname.toLowerCase(), name)) && hop === 0) throw unsupported()
    await assertPublicUrl(current)
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0' } })
    const location = response.headers.get('location')
    if (!location) break
    current = new URL(location, current).toString()
  }
  throw Object.assign(new Error(tr('这个链接打开后不是账号主页。请到账号主页再复制一次链接。')), { status: 400 })
}

function apiError(code, message) {
  const status = code === 3103 || code === 3105 ? 400 : code === 3201 ? 402 : code === 4004 ? 429 : code >= 500 ? 503 : 502
  const textMessage = code === 3103 || code === 3105 ? tr('RedFox API Key 无效或已禁用')
    : code === 3201 ? tr('RedFox 余额不足，请先充值')
      : code === 4004 ? tr('RedFox 请求太频繁，请稍后再试')
        : text(message, 200) || tr('RedFox 服务返回了错误（{code}）', { code })
  return Object.assign(new Error(textMessage), { status, code })
}

export function createRedfoxClient(config = {}, fetchImpl = fetch) {
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  const baseUrl = typeof config.baseUrl === 'string' && /^https?:\/\//i.test(config.baseUrl) ? config.baseUrl.replace(/\/+$/, '') : BASE_URL
  const request = async (path, body) => {
    if (!apiKey) throw Object.assign(new Error(tr('请先在设置里填写 RedFox API Key')), { status: 400 })
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { REDFOX_API_KEY: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) } catch { throw Object.assign(new Error(tr('RedFox 返回的内容不是有效 JSON')), { status: 502 }) }
    const code = Number(data?.code)
    if (!response.ok || code !== 2000) throw apiError(code || response.status, data?.msg ?? data?.message)
    return data.data
  }
  return { apiKey, request }
}

function normalizeDouyin(rows) {
  return (rows ?? []).filter(row => row?.workId || row?.awemeId).map(row => ({
    id: text(row.workId ?? row.awemeId, 120), title: text(row.title, 80) || firstLine(row.content, tr('无标题')), body: text(row.content, 2000),
    publishedAt: dateValue(row.publishTime), url: httpsUrl(row.workUrl), cover: httpsUrl(row.coverUrl), views: count(row.viewCount), likes: count(row.likeCount), comments: count(row.commentCount), saves: count(row.collectCount), shares: count(row.shareCount ?? row.repostCount),
  }))
}

function normalizeXhs(rows) {
  return (rows ?? []).filter(row => row?.workId).map(row => ({
    id: text(row.workId, 120), title: text(row.workTitle, 80) || firstLine(row.workDesc, tr('无标题')), body: text(row.workDesc, 2000), publishedAt: dateValue(row.workPublishTime), url: httpsUrl(row.workUrl), cover: httpsUrl(row.coverUrl), views: count(row.workReadedCount), likes: count(row.workLikedCount), comments: count(row.workCommentsCount), saves: count(row.workCollectedCount), shares: count(row.workSharedCount),
  }))
}

function normalizeBilibili(rows) {
  return (rows ?? []).filter(row => row?.bvId).map(row => ({
    id: text(row.bvId, 120), title: text(row.title, 80) || tr('无标题'), body: text(row.description, 2000), publishedAt: dateValue(row.created), url: `https://www.bilibili.com/video/${row.bvId}`, cover: httpsUrl(row.picUrl), views: count(row.playCount), likes: count(row.likeCount), comments: count(row.commentCount), saves: count(row.favoriteCount), shares: count(row.shareCount),
  }))
}

function normalizeTikTok(rows) {
  return (rows ?? []).map(row => {
    const id = text(row.awemeId ?? row.aweme_id ?? row.itemId ?? row.videoId, 120)
    const author = row.authorData ?? row.author ?? {}
    const stats = row.statistics ?? row.stats ?? {}
    const cover = row.coverUrl ?? row.cover?.url ?? row.videoData?.coverUrl ?? row.video?.cover?.url_list?.[0]
    return id ? { id, title: firstLine(row.content ?? row.desc, tr('无标题')), body: text(row.content ?? row.desc, 2000), publishedAt: dateValue(row.publishTime ?? row.createTime ?? row.create_time), url: httpsUrl(row.shareLink ?? row.webUrl) ?? `https://www.tiktok.com/@${text(author.userHandle, 40)}/video/${id}`, cover: httpsUrl(cover), views: count(row.playCount ?? stats.playCount ?? stats.play_count), likes: count(row.likeCount ?? stats.likeCount ?? stats.digg_count), comments: count(row.commentCount ?? stats.commentCount ?? stats.comment_count), saves: count(row.collectCount ?? stats.collectCount ?? stats.collect_count), shares: count(row.shareCount ?? stats.shareCount ?? stats.share_count) } : null
  }).filter(Boolean)
}

function normalizeInstagram(rows, username) {
  const filtered = (rows ?? []).filter(row => !username || row?.user?.username?.toLowerCase() === username.toLowerCase())
  const source = filtered.length ? filtered : rows ?? []
  return source.filter(row => row?.code || row?.mediaId).map(row => ({
    id: text(row.code ?? row.mediaId, 120), title: firstLine(row.captionText, tr('无标题')), body: text(row.captionText, 2000), publishedAt: dateValue(row.takenAtDate ?? row.takenAt), url: row.code ? `https://www.instagram.com/p/${row.code}/` : null, cover: httpsUrl(row.imageUrl ?? row.thumbnailUrl), views: count(row.playCount), likes: count(row.likeCount), comments: count(row.commentCount), saves: 0, shares: count(row.shareCount),
  }))
}

function normalizeX(rows, screenName) {
  return (rows ?? []).filter(row => row?.tweetId).map(row => ({
    id: text(row.tweetId, 120), title: firstLine(row.text, tr('无标题')), body: text(row.text, 2000), publishedAt: dateValue(row.createdAt), url: `https://x.com/${text(screenName, 30)}/status/${row.tweetId}`, cover: httpsUrl(row.medias?.photos?.[0]?.url), views: count(row.viewCount), likes: count(row.likeCount), comments: count(row.replyCount), saves: count(row.bookmarkCount), shares: count(row.retweetCount) + count(row.quoteCount),
  }))
}

function profileOf(platform, data, account) {
  if (platform === '抖音') return { nickname: text(data?.nickname), description: text(data?.signature, 300), followers: count(data?.followerCount), avatar: httpsUrl(data?.avatarUrl) }
  if (platform === '小红书') return { nickname: text(data?.accountName), description: text(data?.accountDesc, 300), followers: count(data?.accountFans), avatar: httpsUrl(data?.accountAvatar) }
  if (platform === 'B站') return { nickname: text(data?.name), description: text(data?.sign, 300), followers: count(data?.follower), avatar: httpsUrl(data?.face) }
  if (platform === 'TikTok') return { nickname: text(data?.userName || data?.userHandle), description: text(data?.userSignature, 300), followers: count(data?.fansCount), avatar: httpsUrl(data?.avatarImage) }
  if (platform === 'Instagram') return { nickname: text(data?.fullName || data?.username || account.id), description: text(data?.biography, 300), followers: count(data?.followerCount), avatar: httpsUrl(data?.profilePicUrlHd || data?.profilePicUrl) }
  return { nickname: text(data?.displayName || data?.username || account.id), description: text(data?.description, 300), followers: count(data?.followers), avatar: httpsUrl(data?.avatar) }
}

export async function fetchAccount(account, client) {
  const { request } = client
  let profileData = null
  let posts = []
  if (account.platform === '抖音') {
    profileData = await request('/story/api/dyData/queryUser', { accountId: account.id })
    const data = await request('/story/api/dyData/queryWorkList', { accountId: account.id, authorUrl: account.url, secUserId: account.id, offset: 0, sortType: '_2' })
    posts = normalizeDouyin(data?.list)
  } else if (account.platform === '小红书') {
    profileData = await request('/story/api/xhsUser/queryAccountDetail', { accountId: account.id, userId: account.userId })
    const data = await request('/story/api/xhsUser/queryWorkList', { redId: account.id, userid: account.userId, offset: 0, sortType: '_2' })
    posts = normalizeXhs(data?.list)
  } else if (account.platform === 'B站') {
    profileData = await request('/story/api/bili/data/accountDetail', { mid: account.id })
    const data = await request('/story/api/bili/data/accountWorkList', { mid: account.id, accountUrl: account.url, page: 1, pageSize: POST_COUNT, order: 'time' })
    posts = normalizeBilibili(data?.workList)
  } else if (account.platform === 'TikTok') {
    const search = await request('/story/api/tiktok/ability/searchUser', { keyword: account.id, offset: 0, count: 20, otherPrefFilter: '1' })
    const users = search?.userList ?? []
    const selected = users.find(row => String(row.userHandle).toLowerCase() === String(account.id).toLowerCase()) ?? users[0]
    if (!selected?.secUserId) throw Object.assign(new Error(tr('RedFox 没找到这个 TikTok 账号')), { status: 404 })
    const data = await request('/story/api/tiktok/ability/userAwemeList', { secUserId: selected.secUserId })
    const list = Array.isArray(data) ? data : data?.list ?? data?.awemeList ?? []
    profileData = selected
    posts = normalizeTikTok(list).slice(0, POST_COUNT)
  } else if (account.platform === 'Instagram') {
    profileData = await request('/story/api/ins/userInfo', { username: account.id })
    const data = await request('/story/api/ins/search', { keyword: account.id })
    posts = normalizeInstagram(data?.items, account.id).slice(0, POST_COUNT)
  } else if (account.platform === 'X') {
    profileData = await request('/story/api/x/userInfo', { screenName: account.id })
    const data = await request('/story/api/x/userTimeline', { screenName: account.id })
    posts = normalizeX(data?.timeline, account.id).slice(0, POST_COUNT)
  }
  if (!posts.length) throw Object.assign(new Error(tr('没抓到内容，账号可能是私密的或者还没发过内容。')), { status: 404 })
  return { posts, profile: profileOf(account.platform, profileData, account), cost: null }
}

function sniffImage(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return '.png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return '.gif'
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp'
  return null
}

async function saveCover(raw, filesDir, fetchImpl) {
  try {
    let current = raw
    for (let hop = 0; hop < 3; hop += 1) {
      await assertPublicUrl(current)
      const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) { current = new URL(location, current).toString(); continue }
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > COVER_MAX_BYTES) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      const ext = buffer.length <= COVER_MAX_BYTES ? sniffImage(buffer) : null
      if (!ext) return null
      const name = `${newId('c')}${ext}`
      await writeFile(join(filesDir, name), buffer)
      return `media-workbench/files/${name}`
    }
  } catch { /* 封面不是导入的必要条件 */ }
  return null
}

export async function saveCovers(posts, platform, state, filesDir, fetchImpl = fetch) {
  const known = new Set(state.items.filter(item => item.media?.src && item.externalId).map(item => item.externalId))
  const queue = posts.filter(post => post.cover && !known.has(`${platform}:${post.id}`))
  const saved = new Map()
  const worker = async () => {
    for (let post = queue.shift(); post; post = queue.shift()) {
      const src = await saveCover(post.cover, filesDir, fetchImpl)
      if (src) saved.set(post.id, src)
    }
  }
  await Promise.all(Array.from({ length: COVER_CONCURRENCY }, worker))
  return saved
}

export function importPosts(draft, { account, profile, posts, covers = new Map(), now = new Date().toISOString() }) {
  const { platform } = account
  const nickname = profile.nickname || platformName(platform)
  let added = 0
  for (const post of posts) {
    const externalId = `${platform}:${post.id}`
    let item = draft.items.find(row => row.externalId === externalId)
    if (!item) {
      item = { id: newId('it'), kind: 'web', title: post.title, body: post.body, tags: [], status: 'published', personaIds: [], drafts: {}, createdAt: post.publishedAt, publishedAt: post.publishedAt, scheduledAt: post.publishedAt, platform, url: post.url, source: nickname, media: null, imported: true, externalId }
      draft.items.push(item)
      added += 1
    }
    if (covers.has(post.id)) item.media = { src: covers.get(post.id) }
    const numbers = { views: post.views, likes: post.likes, comments: post.comments, shares: post.shares, saves: post.saves }
    const metric = draft.metrics.find(row => row.externalId === externalId)
    if (metric) Object.assign(metric, numbers, { fetchedAt: now })
    else draft.metrics.push({ id: newId('m'), itemId: item.id, platform, date: post.publishedAt, ...numbers, externalId, fetchedAt: now })
  }
  const key = `${platform}:${account.id}`
  const row = draft.accounts.find(entry => entry.externalId === key)
  const fields = { platform, handle: nickname, url: account.url, followers: profile.followers || null, description: profile.description, fetchedAt: now, fetchError: null }
  if (row) Object.assign(row, fields)
  else draft.accounts.push({ id: newId('ac'), createdAt: now, externalId: key, ...fields })
  return { added, updated: posts.length - added }
}

export function postsToMaterial(posts) {
  const score = post => post.likes + post.comments + post.saves + post.shares
  return [...posts].sort((a, b) => (b.views - a.views) || (score(b) - score(a))).map(post => (post.body && !post.body.startsWith(post.title) ? `${post.title}\n${post.body}` : post.body || post.title)).join('\n\n---\n\n')
}

export function redfoxStatus(settings = {}) {
  const key = settings?.apiKey ?? settings?.redfox?.apiKey
  return key ? { state: 'ready', balance: null } : { state: 'nokey' }
}
