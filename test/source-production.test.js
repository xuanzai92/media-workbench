import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Producer } from '../src/produce.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'

async function fixture(t, resolveMaterial) {
  const dir = await mkdtemp(join(tmpdir(), 'media-source-production-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 0, shotCount: 0 })
  const calls = []
  const producer = new Producer({
    store, settings, resolveMaterial, ready: () => false,
    generate: () => assert.fail('No images requested'),
    callText: async request => {
      calls.push(request)
      return { text: request.light ? JSON.stringify({ title: '策划', outline: ['要点'], images: [] }) : '根据素材写出的正文。', model: 'mock' }
    },
  })
  return { store, producer, calls }
}

async function waitDone(producer, id) {
  for (let i = 0; i < 400 && producer.isRunning(id); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(producer.isRunning(id), false, 'Generation must finish')
}

function promptMaterials(call) {
  return JSON.parse(call.user.replace(/^<material>|<\/material>$/g, '')).素材
}

test('单条成稿保留用户正文，并让策划和写作看到完整抓取原文', async t => {
  const fullText = `${'完整正文'.repeat(3500)}末尾证据`
  const { store, producer, calls } = await fixture(t, async () => ({ status: 'fetched', text: fullText }))
  await store.mutate('test', draft => {
    Object.assign(draft.items.find(row => row.id === 'seed_2'), { body: '用户自己的笔记', url: 'https://example.com/story' })
    return draft
  })
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const item = (await store.read()).items.find(row => row.id === 'seed_2')
  assert.equal(item.body, '用户自己的笔记', '抓取不应覆盖灵感中的用户笔记')
  assert.equal(item.production.sourceMaterials[0].text, fullText)
  assert.equal(item.production.sourceMaterials[0].status, 'fetched')
  assert.equal(calls.length, 3, '正文过短时可再请求一次按目标字数改写')
  for (const call of calls) {
    const [material] = promptMaterials(call)
    assert.equal(material.正文, '用户自己的笔记')
    assert.equal(material.抓取原文, fullText, '正文超过 12,000 字时也不能丢失末尾证据')
    assert.equal(material.原文抓取状态, 'fetched')
  }
})

test('合并稿和引用逐条保留获取状态，失败不能冒充完整原文', async t => {
  const attempted = []
  const { store, producer, calls } = await fixture(t, async item => {
    attempted.push(item.id)
    if (item.id === 'seed_2') return { status: 'fetched', text: '第一条完整原文' }
    if (item.id === 'seed_3') return { status: 'failed', text: '', reason: '需要登录' }
    return { status: 'partial', text: '第三条节选', reason: '页面只提供摘要' }
  })
  await store.mutate('test', draft => {
    for (const id of ['seed_2', 'seed_3', 'seed_4']) Object.assign(draft.items.find(row => row.id === id), { url: `https://example.com/${id}`, body: `笔记 ${id}` })
    draft.items.find(row => row.id === 'seed_4').imported = true
    return draft
  })
  const id = await producer.startMerge(['seed_2', 'seed_3'], { format: 'article', references: ['seed_4'], imageCount: 0 })
  await waitDone(producer, id)
  const production = (await store.read()).mergedDrafts.find(row => row.id === id).production
  assert.deepEqual(attempted.sort(), ['seed_2', 'seed_3', 'seed_4'])
  assert.deepEqual(production.sourceMaterials.map(row => row.status), ['fetched', 'failed', 'partial'])
  assert.equal(production.sourceMaterials[1].reason, '需要登录')
  for (const call of calls) {
    const materials = promptMaterials(call)
    assert.deepEqual(materials.map(row => row.原文抓取状态), ['fetched', 'failed', 'partial'])
    assert.equal(materials[1].正文, '笔记 seed_3')
    assert.equal(materials[2].抓取原文, '第三条节选')
    assert.match(call.system, /不能假装已经读到全文/)
  }
})

test('原文超过单次上限时明确失败，不让模型悄悄使用截断素材', async t => {
  const longText = '详'.repeat(300_001)
  const { store, producer, calls } = await fixture(t, async () => ({ status: 'fetched', text: longText }))
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const production = (await store.read()).items.find(row => row.id === 'seed_2').production
  assert.equal(production.status, 'failed')
  assert.match(production.error, /超过单次成稿.*上限/)
  assert.equal(production.sourceMaterials[0].text.length, longText.length)
  assert.equal(calls.length, 0)
})

test('保存正文与抓取原文完全相同时只送模型一份，不重复占用素材上限', async t => {
  const sameText = '资料'.repeat(80_000)
  const { store, producer, calls } = await fixture(t, async () => ({ status: 'fetched', text: sameText }))
  await store.mutate('test', draft => {
    draft.items.find(row => row.id === 'seed_2').body = sameText
    return draft
  })
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const item = (await store.read()).items.find(row => row.id === 'seed_2')
  assert.equal(item.production.status, 'done')
  assert.equal(item.production.sourceMaterials[0].text, sameText)
  assert.equal(promptMaterials(calls[0])[0].正文, sameText)
  assert.equal(promptMaterials(calls[0])[0].抓取原文, undefined)
})

test('抓取过程中取消成稿后不调用模型', async t => {
  let started
  const fetching = new Promise(resolve => { started = resolve })
  const { store, producer, calls } = await fixture(t, (_, { signal }) => new Promise((resolve, reject) => {
    started()
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await fetching
  await producer.cancel('seed_2')
  await waitDone(producer, 'seed_2')
  assert.equal((await store.read()).items.find(row => row.id === 'seed_2').production.status, 'cancelled')
  assert.equal(calls.length, 0)
})

test('来源过多或缺失时明确拒绝，不能静默省略来源生成', async t => {
  const { store, producer } = await fixture(t, async () => ({ status: 'local', text: '' }))
  await assert.rejects(producer.startMerge(Array.from({ length: 13 }, (_, i) => `id_${i}`)), /最多合并 12/)
  await assert.rejects(producer.startMerge(['seed_2', 'seed_3', 'missing']), /来源灵感已不存在/)
  await assert.rejects(producer.startMerge(['seed_2', 'seed_3'], { references: Array.from({ length: 13 }, (_, i) => `id_${i}`) }), /最多使用 12/)
  assert.equal((await store.read()).mergedDrafts.length, 0, '拒绝请求不得留下看似已建立的合并稿')
})
