import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { articlePrompts, chatPrompts, planPrompts } from '../src/ai.js'
import { withLang } from '../src/i18n.js'
import { applyRevision, normalizePlan, Producer } from '../src/produce.js'
import { buildSeed } from '../src/seed.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const PLAN = {
  title: '整理信息的两个步骤',
  facts: ['先收集，再整理'],
  outline: ['收集', '整理'],
  images: [
    { anchor: '收集', caption: '先收集信息', prompt: 'collect-notes' },
    { anchor: '整理', caption: '再归纳主题', prompt: 'organize-notes' },
  ],
}
const isPlan = system => system.includes('策划案')
const target = (state, id) => state.items.find(row => row.id === id) ?? state.mergedDrafts?.find(row => row.id === id)

async function fixture(t, { callText, generate, ready = true, imageCount = 2 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'media-workbench-formats-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount, shotCount: 0 })
  const textCalls = []
  const imageCalls = []
  const producer = new Producer({
    store,
    settings,
    ready: () => ready,
    callText: async request => {
      textCalls.push(request)
      return callText ? callText(request) : { text: isPlan(request.system) ? JSON.stringify(PLAN) : '先收集有价值的信息，再按主题整理。', model: 'mock-text' }
    },
    generate: async (...args) => {
      imageCalls.push(args[1])
      return generate ? generate(...args) : { buffer: PNG, ext: '.png' }
    },
  })
  return { store, producer, textCalls, imageCalls }
}

async function waitDone(producer, id) {
  for (let i = 0; i < 400 && (producer.isRunning(id) || producer.anyAssetActive(id)); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(producer.isRunning(id) || producer.anyAssetActive(id), false, 'Mock generation must finish before assertions or temporary-file cleanup')
}

test('文章写完整论证，图文写短配文并将阅读顺序交给图片', () => {
  const state = buildSeed(new Date('2026-11-17T00:00:00Z'))
  const item = state.items[0]
  const article = articlePrompts(state, item, '', PLAN, 'article')
  const imageText = articlePrompts(state, item, '', PLAN, 'image_text')
  assert.match(article.system, /1000 到 1800 字/)
  assert.match(article.system, /完整论证/)
  assert.match(imageText.system, /300 到 600 字/)
  assert.match(imageText.system, /不强制小标题/)
  assert.doesNotMatch(imageText.system, /3 到 5|1000 到 1800|段落小标题依次使用/)
  assert.match(imageText.system, /不能把规划当作已验证的事实/)
  const material = JSON.parse(imageText.user.replace(/^<material>|<\/material>$/g, ''))
  assert.deepEqual(material.图片顺序.map(row => [row.序号, row.内容]), [[1, '先收集信息'], [2, '再归纳主题']])
  assert.equal(material.图片顺序[0].用途, '首图介绍主题')
  const planning = planPrompts(state, item, { imageCount: 2, voice: '' }, 'image_text')
  assert.match(planning.system, /第一张是首图/)
  assert.match(planning.system, /后续每张展开一个不同的信息点/)
  assert.doesNotMatch(planning.system, /3 到 5 个小标题/)
  withLang('en', () => {
    assert.match(articlePrompts(state, item, '', PLAN, 'image_text').system, /150 到 300 个英文单词/)
    assert.match(articlePrompts(state, item, '', PLAN, 'article').system, /600 到 1000 个英文单词/)
  })
})

test('图文按目标字数重写灵感观点，合并文章按论证顺序融合多条正文', () => {
  const state = buildSeed(new Date('2026-11-17T00:00:00Z'))
  const sources = state.items.slice(0, 2).map((item, index) => ({ ...item, body: `作者观点 ${index + 1}：先核对事实再表达判断。` }))
  const imageText = articlePrompts(state, sources[0], '', PLAN, 'image_text', [sources[0]], 520)
  const article = articlePrompts(state, sources[0], '', PLAN, 'article', sources, 1600)
  assert.match(imageText.system, /目标约 520 字/)
  assert.match(imageText.system, /重新写正文/)
  assert.match(article.system, /目标约 1600 字/)
  assert.match(article.system, /不要按「素材一、素材二」分段/)
  assert.match(planPrompts(state, sources[0], { imageCount: 0, shotCount: 0 }, 'article', sources).system, /outline 按论证顺序安排/)
  assert.deepEqual(JSON.parse(article.user.replace(/^<material>|<\/material>$/g, '')).素材.map(row => row.正文), sources.map(row => row.body))
})

test('模型直接拼接多条灵感时重试；仍然拼接则只交付待补全草稿', async t => {
  const { store, producer, textCalls } = await fixture(t, {
    ready: false,
    callText: async request => ({
      text: isPlan(request.system) ? JSON.stringify(PLAN) : '【素材 1】\n正文：第一篇原文\n\n【素材 2】\n正文：第二篇原文',
      model: 'mock-text',
    }),
  })
  await store.mutate('test', state => {
    state.items.find(row => row.id === 'seed_2').body = '第一篇原文'
    state.items.find(row => row.id === 'seed_3').body = '第二篇原文'
    return state
  })
  const id = await producer.startMerge(['seed_2', 'seed_3'], { format: 'article', imageCount: 0, targetLength: 1600 })
  await waitDone(producer, id)
  const production = target(await store.read(), id).production
  assert.equal(production.targetLength, 1600)
  assert.equal(production.textStatus, 'fallback')
  assert.match(production.notice, /素材原文拼接/)
  assert.doesNotMatch(production.article, /第一篇原文|第二篇原文|【素材/)
  assert.equal(textCalls.length, 3, 'First source dump should trigger one rewriting attempt')
  assert.match(textCalls[2].system, /上一次输出直接拼接/)
})

test('两篇短灵感不带素材标签地平铺，也不能被当成新文章', async t => {
  const first = '先核对原始数据，再写自己的判断。'
  const second = '保留不同观点的分歧，再提出结论。'
  const { store, producer } = await fixture(t, {
    ready: false,
    callText: async request => ({ text: isPlan(request.system) ? JSON.stringify(PLAN) : `${first}\n\n${second}`, model: 'mock-text' }),
  })
  await store.mutate('test', state => {
    state.items.find(row => row.id === 'seed_2').body = first
    state.items.find(row => row.id === 'seed_3').body = second
    return state
  })
  const id = await producer.startMerge(['seed_2', 'seed_3'], { format: 'article', imageCount: 0 })
  await waitDone(producer, id)
  const production = target(await store.read(), id).production
  assert.equal(production.textStatus, 'fallback')
  assert.doesNotMatch(production.article, /先核对原始数据|保留不同观点/)
})

test('个人默认字数用于新稿，重新成稿沿用原稿字数', async t => {
  const { store, producer, textCalls } = await fixture(t, { ready: false, imageCount: 0 })
  await producer.settings.update({ articleTargetLength: 1700, imageTextTargetLength: 480 })
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  assert.equal(target(await store.read(), 'seed_2').production.targetLength, 1700)
  assert.match(textCalls[1].system, /目标约 1700 字/)
  assert.match(target(await store.read(), 'seed_2').production.notice, /目标约 1700 字/)
  assert.equal(target(await store.read(), 'seed_2').production.textStatus, 'done', 'Length warning should not pretend the model failed')
  await producer.settings.update({ articleTargetLength: 2000 })
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  assert.equal(target(await store.read(), 'seed_2').production.targetLength, 1700)
  await producer.start('seed_2', { format: 'image_text', imageCount: 1 })
  await waitDone(producer, 'seed_2')
  assert.equal(target(await store.read(), 'seed_2').production.targetLength, 480)
})

test('素材足够而初稿明显偏短时按目标字数重写一次', async t => {
  let writes = 0
  const { store, producer, textCalls } = await fixture(t, {
    ready: false,
    imageCount: 0,
    callText: async request => ({
      text: isPlan(request.system) ? JSON.stringify(PLAN) : ++writes === 1 ? '只写了一句。' : '新的观点和论证。'.repeat(55),
      model: 'mock-text',
    }),
  })
  await store.mutate('test', state => {
    state.items.find(row => row.id === 'seed_2').body = '可供核实的事实与观点。'.repeat(35)
    return state
  })
  await producer.start('seed_2', { format: 'image_text', targetLength: 450, imageCount: 1 })
  await waitDone(producer, 'seed_2')
  const production = target(await store.read(), 'seed_2').production
  assert.equal(textCalls.length, 3)
  assert.match(textCalls[2].system, /上一次正文与目标字数差距较大/)
  assert.equal(production.textStatus, 'done')
  assert.equal(production.notice, null)
})

test('图文不依赖文章锚点，图片顺序和主题仍保持；文章保留段落锚点', () => {
  const settings = { imageCount: 2, shotCount: 3 }
  const imageText = normalizePlan({ ...PLAN, cover: 'cover', shots: [{ prompt: 'shot' }] }, settings, 'T', 'image_text')
  assert.deepEqual(imageText.images.map(row => row.caption), ['先收集信息', '再归纳主题'])
  assert.deepEqual(imageText.images.map(row => row.anchor), ['', ''])
  assert.equal(imageText.cover, '')
  assert.deepEqual(imageText.shots, [])
  assert.deepEqual(normalizePlan(PLAN, settings, 'T', 'article').images.map(row => row.anchor), ['收集', '整理'])
})

test('对话改稿保留文章和图文各自形式；视频继续使用原脚本指引', () => {
  const state = buildSeed(new Date('2026-11-17T00:00:00Z'))
  const item = state.items[0]
  const promptsFor = format => {
    item.production = { ...PLAN, status: 'done', format, article: '已有正文' }
    return chatPrompts(state, '整篇改写得自然一些', { focusId: item.id })
  }
  for (const format of ['article', 'image_text', 'video']) {
    const prompts = promptsFor(format)
    const brief = JSON.parse(prompts.user.match(/<production>(.*?)<\/production>/s)[1])
    assert.equal(brief.format, format, 'The revision model must know which output format it is editing')
    if (format === 'video') {
      assert.match(prompts.system, /完整的 Markdown 脚本/)
      assert.match(prompts.system, /"shots"/)
      assert.doesNotMatch(prompts.system, /短配文/)
    } else {
      assert.doesNotMatch(prompts.system, /完整的 Markdown 脚本|"shots"|"coverText"/)
      assert.match(prompts.system, /保留其他正文和图片/)
      if (format === 'article') assert.match(prompts.system, /完整论证/)
      else {
        assert.match(prompts.system, /300 到 600 字/)
        assert.match(prompts.system, /不强制小标题/)
        assert.match(prompts.system, /保持现有阅读顺序，首图交代主题/)
      }
    }
  }
  withLang('en', () => assert.match(promptsFor('image_text').system, /150 到 300 个英文单词/))
  assert.match(articlePrompts(state, item, '', PLAN, 'video').system, /这些事实已经定好，数字、人名、案例必须一字不差/)
  assert.doesNotMatch(articlePrompts(state, item, '', PLAN, 'video').system, /素材不足时写短一些/)
  assert.match(planPrompts(state, item, { imageCount: 2, shotCount: 1 }, 'video').system, /具体事实：数字、人名、案例，3 到 6 条/)
})

test('纯文字文章允许零张配图，成功正文具有独立完成状态', async t => {
  const { store, producer, imageCalls } = await fixture(t)
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const p = target(await store.read(), 'seed_2').production
  assert.equal(p.status, 'done')
  assert.equal(p.textStatus, 'done')
  assert.match(p.notice, /目标约 1400 字/)
  assert.equal(p.planNotice, null)
  assert.equal(p.imageCount, 0)
  assert.deepEqual(p.images, [])
  assert.equal(p.cover, null)
  assert.deepEqual(p.shots, [])
  assert.deepEqual(imageCalls, [])
})

test('图文至少规划一张图片；没接生图时保留正文且明确图片未完成', async t => {
  const { store, producer, imageCalls } = await fixture(t, { ready: false, imageCount: 0 })
  await producer.start('seed_2', { format: 'image_text', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const p = target(await store.read(), 'seed_2').production
  assert.equal(p.status, 'done')
  assert.equal(p.textStatus, 'done')
  assert.equal(p.imageCount, 1)
  assert.equal(p.images.length, 1)
  assert.equal(p.images[0].status, 'skipped')
  assert.equal(p.needsProvider, true)
  assert.deepEqual(imageCalls, [])
})

for (const format of ['article', 'image_text']) {
  test(`${format} 模型失败后保留可修改草稿，但不能冒充完成的正文`, async t => {
    const { store, producer } = await fixture(t, { ready: false, callText: async () => { throw new Error('mock provider unavailable') } })
    await producer.start('seed_2', { format })
    await waitDone(producer, 'seed_2')
    const p = target(await store.read(), 'seed_2').production
    assert.equal(p.status, 'done')
    assert.equal(p.textStatus, 'fallback')
    assert.equal(p.engine, 'local')
    assert.match(p.article, /结构草稿/)
    assert.match(p.notice, /结构草稿/)
    assert.match(p.planNotice, /规划生成失败/)
    if (format === 'image_text') assert.doesNotMatch(p.article, /^## /m)
  })
}

test('模型只返回标题时视为正文失败；空规划也必须公开降级提醒', async t => {
  const { store, producer } = await fixture(t, {
    callText: async ({ system }) => ({ text: isPlan(system) ? '{}' : '# 只有标题', model: 'mock-text' }),
  })
  await producer.start('seed_2', { format: 'article', imageCount: 0 })
  await waitDone(producer, 'seed_2')
  const p = target(await store.read(), 'seed_2').production
  assert.equal(p.textStatus, 'fallback')
  assert.equal(p.engine, 'local')
  assert.match(p.planNotice, /规划生成失败/)
  assert.match(p.article, /结构草稿/)
})

test('模型漏掉图片规划时补齐占位方案，并提示核对；不误报正文失败', async t => {
  const { store, producer } = await fixture(t, {
    ready: false,
    callText: async ({ system }) => ({ text: isPlan(system) ? JSON.stringify({ ...PLAN, images: PLAN.images.slice(0, 1) }) : '有效正文', model: 'mock-text' }),
  })
  await producer.start('seed_2', { format: 'image_text' })
  await waitDone(producer, 'seed_2')
  const p = target(await store.read(), 'seed_2').production
  assert.equal(p.textStatus, 'done')
  assert.equal(p.images.length, 2)
  assert.match(p.planNotice, /图片规划不完整/)
})

for (const format of ['article', 'image_text', 'video']) {
  test(`${format} 规划仅缺少标题时保留有效图像和分镜，避免丢掉模型已完成的工作`, async t => {
    const { store, producer } = await fixture(t, {
      ready: false,
      callText: async ({ system }) => ({
        text: isPlan(system) ? JSON.stringify({ ...PLAN, title: '', cover: 'planned-cover', shots: [{ prompt: 'planned-shot', visual: 'planned-scene' }] }) : '有效正文',
        model: 'mock-text',
      }),
    })
    const originalTitle = target(await store.read(), 'seed_2').title
    await producer.start('seed_2', { format, shotCount: 1 })
    await waitDone(producer, 'seed_2')
    const p = target(await store.read(), 'seed_2').production
    assert.equal(p.title, originalTitle)
    assert.deepEqual(p.images.map(image => image.prompt), ['collect-notes', 'organize-notes'])
    assert.deepEqual(p.outline, PLAN.outline)
    assert.deepEqual(p.facts, PLAN.facts)
    assert.match(p.planNotice, /规划未返回标题/)
    assert.doesNotMatch(p.planNotice, /示意方案/)
    assert.equal(p.textStatus, 'done')
    if (format === 'video') {
      assert.equal(p.cover.prompt, 'planned-cover')
      assert.equal(p.shots[0].prompt, 'planned-shot')
    }
  })
}

test('规划缺标题且缺图片时，两种降级都可见', async t => {
  const { store, producer } = await fixture(t, {
    ready: false,
    callText: async ({ system }) => ({ text: isPlan(system) ? JSON.stringify({ outline: ['有效信息点'] }) : '有效正文', model: 'mock-text' }),
  })
  await producer.start('seed_2', { format: 'image_text' })
  await waitDone(producer, 'seed_2')
  const p = target(await store.read(), 'seed_2').production
  assert.match(p.planNotice, /规划未返回标题/)
  assert.match(p.planNotice, /图片规划不完整/)
})

for (const merged of [false, true]) {
  test(`${merged ? '合并稿' : '普通稿'}：单图失败和重试保留正文、其他图片及源素材`, async t => {
    let fail = true
    const { store, producer, textCalls, imageCalls } = await fixture(t, {
      generate: async (_, prompt) => {
        if (fail && prompt.includes('organize-notes')) throw new Error('mock image unavailable')
        return { buffer: PNG, ext: '.png' }
      },
    })
    const beforeItems = structuredClone((await store.read()).items)
    const id = merged ? await producer.startMerge(['seed_2', 'seed_3'], { format: 'image_text' }) : 'seed_2'
    if (!merged) await producer.start(id, { format: 'image_text' })
    await waitDone(producer, id)
    let p = target(await store.read(), id).production
    assert.equal(p.status, 'done')
    assert.equal(p.textStatus, 'done')
    assert.deepEqual(p.images.map(row => row.status), ['done', 'failed'])
    const article = p.article
    const title = p.title
    const firstImage = structuredClone(p.images[0])
    await store.mutate('Add edited body', state => {
      target(state, id).production.article = `${article}\n\n用户补充内容。`
      return state
    }, { undoable: false })
    await producer.regenerate(id, 'image:1')
    await waitDone(producer, id)
    p = target(await store.read(), id).production
    assert.equal(p.images[1].status, 'failed')
    assert.equal(p.images[1].error, 'mock image unavailable')
    assert.deepEqual(p.images[0], firstImage)
    assert.equal(p.article, `${article}\n\n用户补充内容。`)
    fail = false
    await producer.regenerate(id, 'image:1')
    await waitDone(producer, id)
    p = target(await store.read(), id).production
    assert.equal(p.images[1].status, 'done')
    assert.equal(p.images[1].error, null)
    assert.ok(p.images[1].src)
    const previousImageSrc = p.images[1].src
    fail = true
    await producer.regenerate(id, 'image:1')
    await waitDone(producer, id)
    p = target(await store.read(), id).production
    assert.equal(p.images[1].status, 'failed')
    assert.equal(p.images[1].src, previousImageSrc, 'A failed redraw must preserve the previous usable image')
    assert.deepEqual(p.images[0], firstImage)
    assert.equal(p.article, `${article}\n\n用户补充内容。`)
    assert.equal(p.title, title)
    assert.equal(p.textStatus, 'done')
    assert.equal(textCalls.length, 2, 'Retry must not call the planning or writing model again')
    assert.equal(imageCalls.length, 5, 'Each retry must draw only the selected image')
    if (merged) {
      assert.deepEqual((await store.read()).items, beforeItems)
      assert.deepEqual(target(await store.read(), id).sourceIds, ['seed_2', 'seed_3'])
      assert.match(textCalls[0].user, /seed_2/)
      assert.match(textCalls[0].user, /seed_3/)
    }
  })
}

test('修改结构草稿不能自动视为已人工确认，完整改写也保留明确的 fallback 状态', () => {
  const p = { article: '待补充结构', textStatus: 'fallback', notice: '需要核对', images: [], shots: [] }
  applyRevision(p, { edits: [{ find: '待补充', replace: '已补充' }] })
  assert.equal(p.article, '已补充结构')
  assert.equal(p.textStatus, 'fallback')
  applyRevision(p, { article: '# 标题\n\n新正文' })
  assert.equal(p.article, '新正文')
  assert.equal(p.textStatus, 'fallback')
  assert.equal(p.notice, '需要核对')
})
