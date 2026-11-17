import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'

function fixture(merged = false) {
  const item = {
    id: 'review_content',
    title: '原始灵感',
    production: {
      status: 'done', format: 'article', title: '原始标题', article: '需要补全的结构草稿',
      textStatus: 'fallback', notice: '正文需要确认', planNotice: '图片规划需要核对',
      engine: 'local', images: [], shots: [],
    },
  }
  const state = { items: merged ? [] : [item], mergedDrafts: merged ? [item] : [] }
  const update = fields => applyOps(state, [{ op: 'update_production', id: item.id, ...fields }])
  return { state, item, update }
}

for (const merged of [false, true]) {
  const label = merged ? '合并稿' : '普通稿'
  test(`${label}：编辑标题和正文保留 fallback，只有显式确认才完成正文审核`, () => {
    const { item, update } = fixture(merged)
    const edited = update({ title: '新标题', article: '补充后的正文' })
    assert.deepEqual(edited.errors, [])
    assert.equal(item.production.title, '新标题')
    assert.equal(item.production.article, '补充后的正文')
    assert.equal(item.production.textStatus, 'fallback')
    assert.equal(item.production.notice, '正文需要确认')
    assert.equal(item.production.planNotice, '图片规划需要核对')
    const confirmed = update({ textReviewed: true })
    assert.deepEqual(confirmed.errors, [])
    assert.equal(item.production.textStatus, 'done')
    assert.equal(item.production.notice, undefined)
    assert.equal(item.production.planNotice, '图片规划需要核对', 'Text approval must not hide independent image-plan warnings')
    assert.equal(item.production.engine, 'local', 'Human approval must not falsify model provenance')
  })

  test(`${label}：保存修改并确认正文可以同一次操作完成`, () => {
    const { item, update } = fixture(merged)
    const result = update({ article: '用户核实并补全的正文', textReviewed: true })
    assert.deepEqual(result.errors, [])
    assert.equal(item.production.article, '用户核实并补全的正文')
    assert.equal(item.production.textStatus, 'done')
    assert.equal(item.production.notice, undefined)
    assert.equal(item.production.planNotice, '图片规划需要核对')
  })

  test(`${label}：拒绝空标题、空正文和空稿确认，失败不留下部分修改`, () => {
    for (const fields of [
      { title: '  ', article: '不应写入' },
      { title: '不应写入', article: '\n\t', textReviewed: true },
      { article: '', textReviewed: true },
    ]) {
      const { state, update } = fixture(merged)
      const before = structuredClone(state)
      const result = update(fields)
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0], /标题不能为空|正文不能为空/)
      assert.deepEqual(result.receipts, [])
      assert.deepEqual(state, before)
    }
    const { state, item, update } = fixture(merged)
    item.production.article = ''
    const before = structuredClone(state)
    assert.deepEqual(update({ textReviewed: true }).errors, ['正文不能为空'])
    assert.deepEqual(state, before)
  })
}
