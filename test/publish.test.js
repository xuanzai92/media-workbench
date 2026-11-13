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
