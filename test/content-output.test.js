import assert from 'node:assert/strict'
import { test } from 'node:test'
import { articleSections, productionMarkdown, productionReadiness } from '../src/content-output.js'

const article = '开头。\n\n## 第一节\n\n第一个观点。\n\n## 第二节\n\n第二个观点。\n\n## 结尾\n\n最后一个观点。'

test('修改小标题后，预览与 Markdown 仍按同一规则安排未匹配的配图', () => {
  const images = [
    { caption: '第一张', anchor: '第一节', src: 'one.png' },
    { caption: '第二张', anchor: '旧小标题', src: 'two.png' },
  ]
  const sections = articleSections(article, images)
  assert.deepEqual(sections.map(section => section.images.map(row => row.index)), [[], [0], [], [1]])
  const output = productionMarkdown({ format: 'article', title: '文章标题', article, images })
  assert.ok(output.indexOf('第一个观点。') < output.indexOf('![第一张]'))
  assert.ok(output.indexOf('![第一张]') < output.indexOf('## 第二节'))
  assert.ok(output.indexOf('最后一个观点。') < output.indexOf('![第二张]'))
  assert.match(output, /^# 文章标题\n\n/)
})

test('图文按图片数组顺序交付，与文章小标题无关，复制纯文案包含标题', () => {
  const production = {
    format: 'image_text', title: '图文标题', article: '短正文。',
    images: [{ caption: '首图', anchor: '不存在', src: 'first.png' }, { caption: '内页', src: 'second.png' }],
  }
  assert.equal(productionMarkdown(production), '# 图文标题\n\n短正文。\n\n![首图](first.png)\n\n![内页](second.png)\n')
  assert.equal(productionMarkdown(production, { includeImages: false }), '# 图文标题\n\n短正文。\n')
  assert.equal(productionMarkdown(production, { imageSrc: (_, index) => `图片${index + 1}.png` }).includes('![首图](图片1.png)'), true)
})

test('缺图不产生损坏的 Markdown 链接，图注不能注入额外链接', () => {
  const output = productionMarkdown({
    format: 'image_text', title: '标题', article: '正文',
    images: [{ caption: '没有图' }, { caption: '图]([链接])\n第二行', src: 'folder/a (1).png' }],
  })
  assert.doesNotMatch(output, /undefined|没有图/)
  assert.ok(output.includes('![图\\](\\[链接\\]) 第二行](folder/a%20%281%29.png)'))
})

test('整体生成结束不代表图片齐全，计划缺项也必须计入待完成', () => {
  const readiness = productionReadiness({
    status: 'done', format: 'article', article: '正文', textStatus: 'done', imageCount: 3,
    images: [{ status: 'done', src: 'one.png' }, { status: 'failed', error: 'timeout' }],
  })
  assert.deepEqual(readiness, { textReady: true, textDraft: false, imagesDone: 1, imagesTotal: 3, imagesMissing: 2, busy: false, complete: false })
  const skipped = productionReadiness({ status: 'done', article: '正文', imageCount: 1, images: [{ status: 'skipped' }] })
  assert.equal(skipped.complete, false)
  assert.equal(skipped.imagesMissing, 1)
})

test('结构草稿和旧版模型降级正文都不能当成可交付文章', () => {
  for (const fallback of [{ textStatus: 'fallback' }, { engine: 'local', notice: '结构草稿' }]) {
    const readiness = productionReadiness({ status: 'done', format: 'article', article: '草稿', ...fallback })
    assert.equal(readiness.textDraft, true)
    assert.equal(readiness.textReady, false)
    assert.equal(readiness.complete, false)
  }
  assert.equal(productionReadiness({ status: 'done', article: '手动修改', textStatus: 'done', engine: 'local', notice: '旧通知' }).textReady, true)
})

test('纯文字文章可完整交付，图文至少需要一张图，重画期间不报完成', () => {
  assert.equal(productionReadiness({ format: 'article', article: '正文', imageCount: 0 }).complete, true)
  assert.equal(productionReadiness({ format: 'image_text', article: '正文', imageCount: 0 }).imagesMissing, 1)
  assert.equal(productionReadiness({ format: 'article', article: '正文', images: [{ status: 'running', src: 'old.png' }] }).complete, false)
  assert.equal(productionReadiness({ format: 'article', article: '正文', images: [{ status: 'running', src: 'old.png' }] }).busy, true)
  assert.equal(productionReadiness(null).complete, false)
})
