// Resolve public source material at production time without changing saved ideas.
import { harvestText } from './harvest.js'

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])
const X_PATH = /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d{1,30})\/?$/
const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 8000

function xPostId(raw) {
  let url
  try { url = new URL(raw) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || !X_HOSTS.has(url.hostname.toLowerCase())) return null
  return X_PATH.exec(url.pathname)?.[1] ?? null
}

async function readJson(response) {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('json')) throw new Error('X 数据源未返回 JSON')
  if (!response.body) throw new Error('X 数据源返回空内容')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) throw new Error('X 数据内容过大')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('X 数据源返回了无效 JSON') }
}

function noteText(post) {
  return post?.note_tweet?.text ?? post?.note_tweet?.note_tweet_results?.result?.text
}

function postText(post) {
  const note = noteText(post)
  const text = typeof note === 'string' && note.trim() ? note : post?.text
  return typeof text === 'string' ? text.trim() : ''
}

function isPartial(post, text) {
  const urls = Array.isArray(post?.entities?.urls) ? post.entities.urls : []
  return Boolean(post?.truncated || post?.article || post?.note_tweet && !(typeof noteText(post) === 'string' && noteText(post).trim()) || /(?:\.\.\.|…)(?:\s|$)/.test(text) || urls.some(row => /\/i\/article\//i.test(row.expanded_url || '')) || (Array.isArray(post?.mediaDetails) && post.mediaDetails.length))
}

/** Return newly fetched text and its certainty; the original item is never mutated. */
export async function resolveSourceMaterial(item, { signal, fetchImpl = fetch } = {}) {
  const raw = typeof item?.url === 'string' ? item.url.trim() : ''
  const hasMedia = item?.kind === 'image' || item?.kind === 'video'
  if (!raw) return hasMedia
    ? { status: 'partial', text: '', reason: '未读取图片画面或音视频内容，请补充文字说明' }
    : { status: 'local', text: '' }
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')

  try {
    const id = xPostId(raw)
    const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
    if (id) {
      const response = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh-cn&token=0`, { signal: combinedSignal, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`X 数据源返回 ${response.status}`)
      const post = await readJson(response)
      if (String(post?.id_str ?? '') !== id) throw new Error('X 数据源未返回对应帖子')
      const text = postText(post)
      if (!text) throw new Error('未取得 X 帖子正文')
      const quote = post?.quoted_tweet
      const quoteText = postText(quote)
      const combined = quoteText ? `${text}\n\n引用的帖子：\n${quoteText}` : text
      const partial = hasMedia || isPartial(post, text) || (quote && (!quoteText || isPartial(quote, quoteText)))
      return { status: 'partial', text: combined, reason: partial
        ? '帖子含有可能未读取完整的长文、引用或媒体；后续线程及图片、音视频内容也未读取，请核对原文'
        : '已读取这条帖子的文字；后续线程及图片、音视频内容未读取，请核对原文' }
    }
    const page = await harvestText(raw, (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.any([combinedSignal, options.signal]) }))
    if (!page.text.trim()) throw new Error('页面没有可读取的正文')
    return { status: 'partial', text: page.text, reason: hasMedia ? '网页文字可能不完整，图片画面或音视频内容未读取，请核对原文' : '网页自动提取可能缺少正文或包含页面杂项，请核对原文' }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    if (error?.code !== 'UNSAFE_SOURCE_URL' && typeof item?.body === 'string' && item.body.trim()) {
      return { status: 'partial', text: '', reason: `原文暂无法重新读取（${error?.message || '读取失败'}）；已使用灵感中保存的正文，请核对它是否完整` }
    }
    return { status: 'failed', text: '', reason: error?.message || '读取原文失败' }
  }
}
