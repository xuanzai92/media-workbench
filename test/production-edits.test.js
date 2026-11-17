import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let directory
let bundle
let instance = 0

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'media-workbench-edits-'))
  bundle = join(directory, 'desk.mjs')
  await build({
    entryPoints: [fileURLToPath(new URL('../client/desk.js', import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'react-state-only-stub',
      setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-stub' }))
        // These tests exercise exported store actions, without rendering React hooks.
        builder.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({ contents: 'export default {}', loader: 'js' }))
      },
    }],
  })
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve))
const production = () => ({ title: '原有标题', article: '原有正文', format: 'article', status: 'done', textStatus: 'done', images: [] })
const find = (state, id) => state.items.find(item => item.id === id) ?? state.mergedDrafts.find(item => item.id === id)

async function fixture(t, handle = async () => null) {
  const desk = await import(`${pathToFileURL(bundle).href}?instance=${++instance}`)
  const state = {
    items: [{ id: 'single', production: production() }],
    mergedDrafts: [{ id: 'merged', sourceIds: ['single'], production: production() }],
  }
  const calls = []
  desk.setDesk({ state: structuredClone(state) })
  const timeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, ...args) => {
    const timer = timeout(callback, ...args)
    timer.unref?.()
    return timer
  })
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, 'media-workbench/ops', 'Editing must use the normal operations API')
    const [op] = JSON.parse(options.body).ops
    calls.push(op)
    const failure = await handle(op, calls.length)
    if (failure === 'network') throw new Error('Injected network failure')
    if (failure === 'operation') return { ok: true, json: async () => ({ state: structuredClone(state), errors: ['Injected operation failure'] }) }
    if (failure) return { ok: false, status: 503, json: async () => ({ error: 'Injected save failure' }) }
    const { id, op: name, ...patch } = op
    assert.equal(name, 'update_production')
    Object.assign(find(state, id).production, patch)
    return { ok: true, json: async () => ({ state: structuredClone(state), errors: [] }) }
  })
  return { desk, state, calls }
}

test('标题保存失败后正文成功，仍须阻止复制或导出未完整保存的版本', async t => {
  const { desk } = await fixture(t, async op => Object.hasOwn(op, 'title') ? 'network' : null)
  const title = desk.updateProduction('single', { title: '未保存的新标题' })
  const article = desk.updateProduction('single', { article: '已保存的新正文' })
  assert.equal(await title, false)
  assert.equal(await article, true)
  assert.equal(await desk.flushProduction('single'), null, 'A successful body edit cannot hide an unresolved title failure')
})

test('成功重试失败字段后，合并稿也可复制和导出最新标题及正文', async t => {
  let rejectTitle = true
  const { desk } = await fixture(t, async op => rejectTitle && Object.hasOwn(op, 'title') ? 'operation' : null)
  assert.equal(await desk.updateProduction('merged', { title: '新标题' }), false)
  assert.equal(await desk.updateProduction('merged', { article: '新正文' }), true)
  assert.equal(await desk.flushProduction('merged'), null)
  rejectTitle = false
  assert.equal(await desk.updateProduction('merged', { title: '新标题' }), true)
  const current = await desk.flushProduction('merged')
  assert.equal(current.title, '新标题')
  assert.equal(current.article, '新正文')
})

test('同一成稿的字段按提交顺序保存，flush 等最后一次修改完成', async t => {
  const first = deferred()
  const second = deferred()
  const { desk, calls } = await fixture(t, async (_op, index) => {
    await (index === 1 ? first : second).promise
  })
  t.after(() => { first.resolve(); second.resolve() })
  const title = desk.updateProduction('single', { title: '新标题' })
  const article = desk.updateProduction('single', { article: '新正文' })
  let flushed = false
  const ready = desk.flushProduction('single').then(value => { flushed = true; return value })
  await nextTurn()
  assert.equal(calls.length, 1, 'The second request must not race a prior update to the same draft')
  assert.equal(flushed, false)
  first.resolve()
  await title
  await nextTurn()
  assert.equal(calls.length, 2)
  assert.equal(flushed, false, 'The first response is insufficient while another edit is queued')
  second.resolve()
  await article
  const current = await ready
  assert.equal(current.title, '新标题')
  assert.equal(current.article, '新正文')
})

test('flush 期间新加入的编辑也必须完成，避免快速连续修改导出旧版本', async t => {
  const gate = deferred()
  const { desk } = await fixture(t, async (_op, index) => { if (index === 1) await gate.promise })
  t.after(() => gate.resolve())
  const first = desk.updateProduction('single', { title: '第一次标题' })
  const ready = desk.flushProduction('single')
  await nextTurn()
  const second = desk.updateProduction('single', { title: '最终标题' })
  gate.resolve()
  await Promise.all([first, second])
  assert.equal((await ready).title, '最终标题')
})

test('不同成稿独立保存，单篇请求卡住不会阻塞其他成稿', async t => {
  const gate = deferred()
  const { desk, calls } = await fixture(t, async op => { if (op.id === 'single') await gate.promise })
  t.after(() => gate.resolve())
  const single = desk.updateProduction('single', { title: '等待中的标题' })
  const merged = desk.updateProduction('merged', { title: '另一篇标题' })
  await nextTurn()
  assert.deepEqual(calls.map(op => op.id).sort(), ['merged', 'single'])
  assert.equal(await merged, true)
  assert.equal((await desk.flushProduction('merged')).title, '另一篇标题')
  gate.resolve()
  assert.equal(await single, true)
})

test('放弃正文编辑须等在途失败结束，再解除该字段的导出阻塞', async t => {
  const gate = deferred()
  const { desk, calls } = await fixture(t, async () => { await gate.promise; return 'network' })
  t.after(() => gate.resolve())
  const saving = desk.updateProduction('single', { article: '放弃的正文' })
  let discarded = false
  const discard = desk.discardProductionEdit('single', { article: '原有正文' }).then(() => { discarded = true })
  await nextTurn()
  assert.equal(discarded, false, 'An in-flight failure must not re-block the field after it was discarded')
  gate.resolve()
  assert.equal(await saving, false)
  await discard
  const current = await desk.flushProduction('single')
  assert.equal(current.article, '原有正文')
  assert.equal(calls.length, 1, 'Discarding an unsaved draft must not submit another edit')
})

test('放弃一个字段不能掩盖另一个字段的保存失败', async t => {
  const { desk } = await fixture(t, async () => 'operation')
  assert.equal(await desk.updateProduction('single', { title: '未保存标题' }), false)
  assert.equal(await desk.updateProduction('single', { article: '未保存正文' }), false)
  await desk.discardProductionEdit('single', { article: '原有正文' })
  assert.equal(await desk.flushProduction('single'), null, 'Discarding body changes must leave the failed title unresolved')
  await desk.discardProductionEdit('single', { title: '原有标题' })
  assert.equal((await desk.flushProduction('single')).title, '原有标题')
})
