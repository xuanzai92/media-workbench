import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSourceMaterial } from '../src/source-material.js'

const postId = '2121264664571269160'
const postUrl = `https://x.com/example/status/${postId}`
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

test('本地文字保留内容，图片和视频不会误报已读取媒体', async () => {
  assert.deepEqual(await resolveSourceMaterial({ body: '我的笔记' }), { status: 'local', text: '' })
  for (const kind of ['image', 'video']) {
    const result = await resolveSourceMaterial({ kind, body: '已有说明' })
    assert.equal(result.status, 'partial')
    assert.equal(result.text, '')
    assert.match(result.reason, /图片|音视频/)
  }
})

test('X 数据源提供长文和引用时读取它们，并提示未读取线程', async () => {
  let requested
  const result = await resolveSourceMaterial({ url: postUrl, body: '榜单摘要' }, { fetchImpl: async (url, opts) => {
    requested = { url, opts }
    return json({ id_str: postId, text: '截断的文本…', note_tweet: { text: '完整长文第二段' }, quoted_tweet: { text: '引用帖子的正文' } })
  } })
  assert.equal(new URL(requested.url).hostname, 'cdn.syndication.twimg.com')
  assert.equal(requested.opts.redirect, 'error')
  assert.match(result.text, /完整长文第二段/)
  assert.match(result.text, /引用帖子的正文/)
  assert.equal(result.status, 'partial')
  assert.match(result.reason, /线程/)
})

test('X 附件、缺失引用和无法访问时不假装内容完整', async () => {
  const withPhoto = await resolveSourceMaterial({ url: postUrl }, { fetchImpl: async () => json({ id_str: postId, text: '正文', mediaDetails: [{ type: 'photo' }] }) })
  assert.equal(withPhoto.status, 'partial')
  assert.match(withPhoto.reason, /媒体/)
  const missingNote = await resolveSourceMaterial({ url: postUrl }, { fetchImpl: async () => json({ id_str: postId, text: '长文预览', note_tweet: { id: '123' } }) })
  assert.equal(missingNote.status, 'partial')
  assert.match(missingNote.reason, /长文/)
  const saved = await resolveSourceMaterial({ url: postUrl, body: '原始摘要' }, { fetchImpl: async () => new Response('', { status: 403 }) })
  assert.equal(saved.status, 'partial')
  assert.equal(saved.text, '')
  assert.match(saved.reason, /已使用灵感中保存的正文/)
  const failed = await resolveSourceMaterial({ url: postUrl }, { fetchImpl: async () => new Response('', { status: 403 }) })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.text, '')
})

test('X 数据源必须返回请求的帖子且限制响应大小', async () => {
  const wrong = await resolveSourceMaterial({ url: postUrl }, { fetchImpl: async () => json({ id_str: '2', text: '无关内容' }) })
  assert.equal(wrong.status, 'failed')
  const large = await resolveSourceMaterial({ url: postUrl }, { fetchImpl: async () => json({ id_str: postId, text: 'x'.repeat(1_500_001) }) })
  assert.equal(large.status, 'failed')
  assert.match(large.reason, /过大/)
})

test('普通网页正文只能视作部分内容，内网与跳转仍被拒绝', async () => {
  const result = await resolveSourceMaterial({ url: 'https://93.184.216.34/article', body: '摘要' }, { fetchImpl: async () => new Response('<article><p>这里是一段足够长的公开页面正文。</p></article>', { headers: { 'content-type': 'text/html' } }) })
  assert.equal(result.status, 'partial')
  assert.match(result.text, /公开页面正文/)
  const blocked = await resolveSourceMaterial({ url: 'https://93.184.216.34/article', body: '已保存的完整正文' }, { fetchImpl: async () => new Response('', { status: 403 }) })
  assert.equal(blocked.status, 'partial')
  assert.match(blocked.reason, /已使用灵感中保存的正文/)
  const denied = await resolveSourceMaterial({ url: 'http://127.0.0.1/private', body: '保留' })
  assert.equal(denied.status, 'failed')
  assert.equal(denied.text, '')
  const redirect = await resolveSourceMaterial({ url: 'https://93.184.216.34/article' }, { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) })
  assert.equal(redirect.status, 'failed')
})

test('用户取消会中止抓取，而不是继续生成', async () => {
  const controller = new AbortController()
  const promise = resolveSourceMaterial({ url: postUrl }, { signal: controller.signal, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) })
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
})
