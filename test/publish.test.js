import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPublishSource, createPublishJob, findPublishJob, isPublishJobExpired, updatePublishJob } from '../src/publish.js'

const NOW = '2026-11-12T08:00:00.000Z'

function stateWithContent(overrides = {}) {
  return {
    items: [],
    mergedDrafts: [{
      id: 'md_publish',
      title: '工作台标题',
      kind: 'video',
      tags: ['AI', '观察'],
      production: {
        status: 'done',
        format: 'video',
        title: '最终标题',
        article: '第一段正文\n\n第二段正文',
        cover: { src: 'media-workbench/attachments/cover.png', w: 1200, h: 675 },
        images: [{ src: 'media-workbench/attachments/figure.png', caption: '配图' }],
        shots: [{ src: 'media-workbench/attachments/shot.png', seconds: 5 }],
      },
      ...overrides,
    }],
    publishJobs: [],
  }
}

test('发布任务：从已完成成稿生成正文、Markdown 和素材引用', () => {
  const state = stateWithContent()
  const source = buildPublishSource(state.mergedDrafts[0])
  assert.deepEqual(source, {
    title: '最终标题',
    body: '第一段正文\n\n第二段正文',
    markdown: '# 最终标题\n\n第一段正文\n\n第二段正文\n',
    format: 'video',
    tags: ['AI', '观察'],
    media: [
      { role: 'cover', src: 'media-workbench/attachments/cover.png', w: 1200, h: 675 },
      { role: 'image', index: 0, src: 'media-workbench/attachments/figure.png' },
      { role: 'shot', index: 0, src: 'media-workbench/attachments/shot.png' },
    ],
  })
})

test('发布任务：只允许已完成成稿，并在十五分钟内通过 nonce 查询', () => {
  const state = stateWithContent()
  const job = createPublishJob(state, 'md_publish', { now: NOW })
  assert.equal(job.adapter, 'aibeike')
  assert.equal(job.status, 'ready')
  assert.equal(job.attempts, 0)
  assert.equal(findPublishJob(state, job.id), job)
  assert.equal(isPublishJobExpired(job, '2026-11-12T08:14:59.999Z'), false)
  assert.equal(isPublishJobExpired(job, '2026-11-12T08:15:00.000Z'), true)

  assert.throws(() => createPublishJob(stateWithContent({ production: { status: 'running', article: '' } }), 'md_publish', { now: NOW }), /请先完成成稿/)
  assert.throws(() => createPublishJob(state, 'missing', { now: NOW }), /找不到这条内容/)
})

test('发布任务：交接、确认后记录外链和发布时间', () => {
  const state = stateWithContent()
  const job = createPublishJob(state, 'md_publish', { now: NOW })
  updatePublishJob(state, job.id, { status: 'handed_off', attempts: 1 }, new Date(NOW))
  const published = updatePublishJob(state, job.id, {
    status: 'published',
    externalUrl: 'https://example.com/post/1',
    externalId: 'post_1',
  }, '2026-11-12T08:03:00.000Z')
  assert.equal(published.status, 'published')
  assert.equal(published.attempts, 1)
  assert.equal(published.externalUrl, 'https://example.com/post/1')
  assert.equal(published.externalId, 'post_1')
  assert.equal(published.publishedAt, '2026-11-12T08:03:00.000Z')
})

function writtenState(format, merged = false) {
  const content = {
    id: 'written_publish', title: '素材标题', tags: ['写作'],
    production: {
      status: 'done', textStatus: 'done', format, title: '成稿标题',
      article: '开场内容\n\n## 收集\n先收集信息。\n\n## 整理\n再按主题归纳。',
      imageCount: 2,
      images: [
        { status: 'done', anchor: '整理', caption: '主题归纳', src: 'media-workbench/attachments/organize.png' },
        { status: 'done', anchor: '收集', caption: '收集信息', src: 'media-workbench/attachments/collect.png' },
      ],
      cover: { src: 'media-workbench/attachments/old-cover.png' },
      shots: [{ src: 'media-workbench/attachments/old-shot.png' }],
    },
  }
  return { items: merged ? [] : [content], mergedDrafts: merged ? [content] : [], publishJobs: [] }
}

for (const format of ['article', 'image_text']) {
  for (const merged of [false, true]) {
    const label = `${merged ? '合并稿' : '普通稿'} ${format}`
    test(`发布任务：${label} 的结构草稿、缺图和失败图片必须先补齐`, () => {
      for (const change of [
        p => { p.textStatus = 'fallback' },
        p => { delete p.textStatus; p.engine = 'local'; p.notice = '旧版结构草稿' },
        p => { p.images.pop() },
        p => { p.images[0].status = 'failed' },
        p => { p.images[0].status = 'running' },
        p => { delete p.images[0].src },
      ]) {
        const state = writtenState(format, merged)
        const content = [...state.items, ...state.mergedDrafts][0]
        change(content.production)
        const before = structuredClone(state)
        assert.equal(buildPublishSource(content), null)
        assert.throws(() => createPublishJob(state, content.id, { now: NOW }), /请先完成成稿/)
        assert.deepEqual(state, before, 'Rejected readiness checks must not create a publish job or mutate content')
      }
    })

    test(`发布任务：${label} 完成后正文和图片位置符合内容形式`, () => {
      const state = writtenState(format, merged)
      const content = [...state.items, ...state.mergedDrafts][0]
      const job = createPublishJob(state, content.id, { now: NOW })
      assert.equal(job.contentId, content.id)
      assert.equal(job.source.format, format)
      assert.equal(job.source.body, content.production.article)
      assert.equal(job.source.title, '成稿标题')
      assert.deepEqual(job.source.media.map(row => row.role), ['image', 'image'], 'Written formats must not include stale video cover or shots')
      assert.deepEqual(job.source.media.map(row => row.index), [0, 1])
      assert.equal((job.source.markdown.match(/!\[/g) ?? []).length, 2)
      if (format === 'article') {
        assert.match(job.source.markdown, /先收集信息。\s+!\[收集信息\]\(media-workbench\/attachments\/collect.png\)\s+## 整理/)
        assert.match(job.source.markdown, /再按主题归纳。\s+!\[主题归纳\]\(media-workbench\/attachments\/organize.png\)/)
      } else {
        assert.ok(job.source.markdown.startsWith(`# 成稿标题\n\n${content.production.article}\n\n`))
        assert.ok(job.source.markdown.indexOf('organize.png') < job.source.markdown.indexOf('collect.png'), 'Image-text must retain its ordered image set regardless of section anchors')
      }
      assert.equal(state.publishJobs.length, 1)
    })
  }
}

test('发布任务：零图文章可发布，零图图文仍不能通过完整性检查', () => {
  for (const format of ['article', 'image_text']) {
    const state = writtenState(format)
    const content = state.items[0]
    content.production.images = []
    content.production.imageCount = 0
    if (format === 'article') assert.ok(buildPublishSource(content))
    else assert.equal(buildPublishSource(content), null)
  }
})
