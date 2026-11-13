import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchXbangdan } from '../src/xbangdan.js'

function response(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

test('xbangdan：读取公开榜单并统一作品字段', async () => {
  const calls = []
  const updated = Math.floor(Date.parse('2026-11-12T08:00:00Z') / 1000)
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return response({
      updated,
      rate: [
        { id: 1234567890, h: 'maker_one', n: '作者一', t: 'AI 工具实测', c: 'ai_coding', fo: 12000, v: 5600, r: 320, l: 280, age: 2 },
        { id: '1234567891', h: 'maker_two', n: '作者二', t: '太旧的内容', c: 'finance', fo: 9000, v: 1200, r: 10, l: 8, age: 8 },
      ],
      views: [{ id: '1234567892', h: 'maker_three', n: '作者三', t: '曝光内容', c: 'growth', fo: 3000, v: 90000, r: 80, l: 70, age: 1 }],
    })
  }

  const result = await fetchXbangdan({ section: 'rate', category: 'ai', hours: 3 }, fetchImpl)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^https:\/\/xbangdan\.com\/hot\.json\?t=/)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(result.source, 'xbangdan.com')
  assert.equal(result.updated, '2026-11-12T08:00:00.000Z')
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.rows[0], {
    id: '1234567890',
    rank: 1,
    section: 'rate',
    handle: 'maker_one',
    name: '作者一',
    text: 'AI 工具实测',
    category: 'ai_coding',
    followers: 12000,
    exposure: 5600,
    interactions: 320,
    likes: 280,
    age: 2,
    publishedAt: '2026-11-12T06:00:00.000Z',
    url: 'https://x.com/maker_one/status/1234567890',
  })
})

test('xbangdan：曝光榜和赛道筛选使用对应字段', async () => {
  const fetchImpl = async () => response({
    updated: 1_800_000_000,
    rate: [],
    views: [{ id: '1234567892', h: 'maker_three', n: '作者三', t: '曝光内容', c: 'growth', v: 90000, age: 1 }],
  })
  const result = await fetchXbangdan({ section: 'views', category: 'self_media', hours: 24 }, fetchImpl)
  assert.equal(result.rows[0].section, 'views')
  assert.equal(result.rows[0].category, 'growth')
  assert.equal(result.rows[0].exposure, 90000)
  assert.equal(result.rows[0].publishedAt, '2027-01-15T07:00:00.000Z')
})

test('xbangdan：拒绝无效筛选和上游错误', async () => {
  await assert.rejects(fetchXbangdan({ section: 'unknown' }, async () => response({})), /榜单分区无效/)
  await assert.rejects(fetchXbangdan({ category: 'unknown' }, async () => response({})), /赛道无效/)
  await assert.rejects(fetchXbangdan({ hours: 5 }, async () => response({})), /时间范围无效/)
  await assert.rejects(fetchXbangdan({}, async () => response({}, { status: 503 })), /错误（503）/)
  await assert.rejects(fetchXbangdan({}, async () => new Response('{bad json', { status: 200 })), /有效 JSON/)
})
