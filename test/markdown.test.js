import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importMarkdown, parseFrontmatter, removeMarkdown, syncMarkdown, writeContentMarkdown, writeInspirationMarkdown } from '../src/markdown.js'
import { applyOps } from '../src/ops.js'

test('Markdown frontmatter 解析字符串、数组和空值', () => {
  const parsed = parseFrontmatter(`---\nid: "it_1"\n发布时间: 2026-11-10\ntags:\n  - "AI"\n  - "观察"\nsource_url: null\n---\n# 标题\n\n正文`)
  assert.equal(parsed.fields.id, 'it_1')
  assert.equal(parsed.fields['发布时间'], '2026-11-10')
  assert.deepEqual(parsed.fields.tags, ['AI', '观察'])
  assert.equal(parsed.fields.source_url, null)
  assert.match(parsed.body, /^# 标题/)
})

test('同步兼容内容选题目录和内容目录下的普通 Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-local-'))
  try {
    await mkdir(join(root, '内容选题', '作者甲'), { recursive: true })
    await mkdir(join(root, '内容'), { recursive: true })
    await writeFile(join(root, '内容选题', '作者甲', '篮球选题.md'), `---\n发布时间: 2026-11-10\n发布状态: true\ntype:\n  - video\n发布渠道:\n  - 抖音\ntags:\n  - 篮球\n---\n\n# 篮球选题\n\n这是一个本地选题。`)
    await writeFile(join(root, '内容选题', '汇总.md'), '# 不应该被导入')
    await writeFile(join(root, '内容', '本地文章.md'), '# 本地文章\n\n没有 frontmatter 也应该能导入。')
    const state = { items: [], mergedDrafts: [] }
    const result = await importMarkdown(root, state, { now: '2026-11-10T12:00:00.000Z' })
    assert.equal(result.imported, 2)
    const topic = state.items.find(item => item.title === '篮球选题')
    assert.ok(topic)
    assert.equal(topic.importedFromMarkdown, true)
    assert.equal(topic.kind, 'video')
    assert.equal(topic.platform, '抖音')
    assert.deepEqual(topic.tags, ['篮球'])
    assert.equal(topic.scheduledAt, '2026-11-10T00:00:00.000Z')
    assert.equal(topic.source, '内容选题 · 作者甲')
    const content = state.mergedDrafts.find(item => item.title === '本地文章')
    assert.ok(content)
    assert.equal(content.production.article, '没有 frontmatter 也应该能导入。')
    assert.match(content.id, /^md_local_[0-9a-f]{12}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Markdown 导入新增和更新灵感，保留运行态字段并去掉生成的来源区块', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-import-'))
  try {
    await mkdir(join(root, '灵感'), { recursive: true })
    await writeFile(join(root, '灵感', 'external.md'), `---\nid: "it_external"\ntype: inspiration\nkind: web\ntitle: "外部标题"\ncreated_at: "2026-11-10T10:00:00.000Z"\nupdated_at: "2026-11-10T11:00:00.000Z"\nstatus: idea\nsource: "插件"\nsource_url: "https://example.com"\nplugin_note: "保留这个字段"\ntags:\n  - "外部"\n---\n# 外部标题\n\n外部正文\n\n## 插件补充\n\n这个区块也应该保留。\n\n## 来源\n来源：插件\n原文：https://example.com\n`)
    await writeFile(join(root, '灵感', 'ignored.md'), '# 没有 frontmatter')
    const state = { items: [{ id: 'it_external', title: '旧标题', body: '旧正文', kind: 'note', tags: [], status: 'draft', createdAt: '2026-11-09T10:00:00.000Z', production: { status: 'done' }, pos: { x: 10, y: 20 } }] }
    const first = await importMarkdown(root, state, { now: '2026-11-10T12:00:00.000Z' })
    assert.equal(first.imported, 0)
    assert.equal(first.updated, 1)
    assert.equal(first.skipped, 1)
    assert.deepEqual(first.skippedFiles, ['灵感/ignored.md: 缺少可用的 id'])
    const item = state.items[0]
    assert.equal(item.title, '外部标题')
    assert.match(item.body, /^外部正文\n\n## 插件补充/)
    assert.equal(item.source, '插件')
    assert.deepEqual(item.tags, ['外部'])
    assert.equal(item.markdownMeta.plugin_note, '保留这个字段')
    assert.match(item.body, /## 插件补充/)
    assert.deepEqual(item.pos, { x: 10, y: 20 })
    assert.deepEqual(item.production, { status: 'done' })

    await writeInspirationMarkdown(root, item, { now: '2026-11-10T12:30:00.000Z' })
    const roundTripped = await readFile(join(root, '灵感', 'it_external.md'), 'utf8')
    assert.match(roundTripped, /plugin_note: "保留这个字段"/)
    assert.match(roundTripped, /## 插件补充/)

    await writeFile(join(root, '灵感', 'new.md'), `---\nid: "it_new"\ntype: inspiration\ntitle: "新的灵感"\n---\n# 新的灵感\n\n新正文`)
    const second = await importMarkdown(root, state, { now: '2026-11-10T12:00:00.000Z' })
    assert.equal(second.imported, 1)
    assert.equal(state.items[0].id, 'it_new')
    assert.equal(state.items[1].id, 'it_external')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Markdown 投影写入灵感和合并成稿，并使用稳定 ID 幂等更新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-'))
  try {
    const state = {
      items: [{
        id: 'it_source', kind: 'web', title: '第一条灵感', body: '采集到的正文', source: 'AIHOT', url: 'https://example.com/story', tags: ['AI', '观察'], status: 'idea', createdAt: '2026-11-10T10:00:00.000Z', scheduledAt: null,
        media: { src: 'media-workbench/attachments/source.png' },
      }],
      mergedDrafts: [{
        id: 'md_content', sourceIds: ['it_source'], title: '旧标题', status: 'draft', createdAt: '2026-11-10T10:05:00.000Z', scheduledAt: null, platform: '抖音', production: {
          status: 'done', format: 'video', title: '新标题', article: '正文内容', sourceIds: ['it_source'],
          cover: { src: 'media-workbench/attachments/cover.png' },
          images: [{ src: 'media-workbench/attachments/figure.png', caption: '配图说明' }],
          shots: [{ no: 1, shot: '近景', visual: '画面', voice: '口播', seconds: 5, src: 'media-workbench/attachments/shot.png' }],
        },
      }],
    }

    const written = await syncMarkdown(root, state, { now: '2026-11-10T12:00:00.000Z' })
    assert.equal(written.length, 2)

    const inspirationPath = join(root, '灵感', 'it_source.md')
    const contentPath = join(root, '内容', 'md_content', '内容.md')
    const inspiration = await readFile(inspirationPath, 'utf8')
    const content = await readFile(contentPath, 'utf8')
    const storyboard = content

    assert.match(inspiration, /^---\nid: "it_source"\n/)
    assert.match(inspiration, /source_url: "https:\/\/example\.com\/story"/)
    assert.match(inspiration, /# 第一条灵感/)
    assert.match(inspiration, /!\[图片\]\(\.\.\/attachments\/source\.png\)/)
    assert.match(content, /^---\nid: "md_content"\n/)
    assert.match(content, /format: "video"/)
    assert.match(content, /source_ids:\n  - "it_source"/)
    assert.match(content, /!\[封面\]\(\.\.\/\.\.\/attachments\/cover\.png\)/)
    assert.match(content, /!\[配图说明\]\(\.\.\/\.\.\/attachments\/figure\.png\)/)
    assert.match(content, /\[第一条灵感\]\(\.\.\/\.\.\/灵感\/it_source\.md\)/)
    assert.match(storyboard, /## 分镜脚本/)
    assert.match(storyboard, /!\[第 1 镜\]\(\.\.\/\.\.\/attachments\/shot\.png\)/)

    state.mergedDrafts[0].production.title = '改过的标题'
    await writeContentMarkdown(root, state.mergedDrafts[0], state, { now: '2026-11-10T13:00:00.000Z' })
    assert.match(await readFile(contentPath, 'utf8'), /# 改过的标题/)
    assert.deepEqual(await readdir(join(root, '内容', 'md_content')), ['内容.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Markdown 投影可以单独写入灵感和普通成稿', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-single-'))
  try {
    const item = { id: 'it_one', title: '一条灵感', body: '内容', kind: 'note', status: 'idea', createdAt: '2026-11-10T10:00:00Z' }
    const itemPath = await writeInspirationMarkdown(root, item, { now: '2026-11-10T10:01:00Z' })
    assert.equal(itemPath, join(root, '灵感', 'it_one.md'))
    const contentItem = { id: 'it_one', title: '一条灵感', createdAt: item.createdAt, status: 'draft', production: { status: 'done', format: 'article', title: '一篇文章', article: '文章正文', sourceIds: [] } }
    const contentPath = await writeContentMarkdown(root, contentItem, { items: [item] }, { now: '2026-11-10T10:02:00Z' })
    assert.equal(contentPath, join(root, '内容', 'it_one', '内容.md'))
    assert.match(await readFile(contentPath, 'utf8'), /format: "article"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Markdown 投影默认跳过示例数据', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-samples-'))
  try {
    const written = await syncMarkdown(root, { items: [{ id: 'sample_1', sample: true, title: '示例', body: '不会导出' }], mergedDrafts: [] })
    assert.deepEqual(written, [])
    assert.deepEqual((await readdir(root)).sort(), ['内容', '灵感'])
    await assert.rejects(readFile(join(root, '灵感', 'sample_1.md')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('删除记录时可以清理对应的灵感和内容 Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-remove-'))
  try {
    await writeInspirationMarkdown(root, { id: 'it_remove', title: '待删除灵感', body: '正文' })
    await writeContentMarkdown(root, { id: 'md_remove', title: '待删除成稿', production: { title: '待删除成稿', article: '正文', sourceIds: [] } }, { items: [] })
    const removed = await removeMarkdown(root, { inspirationIds: ['it_remove'], contentIds: ['md_remove'] })
    assert.equal(removed.length, 2)
    await assert.rejects(readFile(join(root, '灵感', 'it_remove.md')))
    await assert.rejects(readFile(join(root, '内容', 'md_remove', '内容.md')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('删除操作回执带出 Markdown 清理范围', () => {
  const state = { items: [{ id: 'it_remove', title: '待删除灵感', body: '正文', production: { title: '成稿', article: '正文' } }], mergedDrafts: [], metrics: [] }
  const result = applyOps(state, [{ op: 'delete_item', id: 'it_remove' }])
  assert.deepEqual(result.receipts[0].cleanup, { inspirationIds: ['it_remove'], contentIds: ['it_remove'] })
})

test('Markdown 导入内容只更新标题和正文，保留媒体与分镜运行态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-workbench-markdown-content-import-'))
  try {
    await mkdir(join(root, '内容', 'md_content'), { recursive: true })
    await writeFile(join(root, '内容', 'md_content', '内容.md'), `---\nid: "md_content"\ntype: content\ntitle: "Obsidian 改过的标题"\nformat: article\nstatus: ready\nproduction_status: done\nsource_ids:\n  - "it_source"\nplugin_note: "保留内容字段"\n---\n# Obsidian 改过的标题\n\n这是在 Obsidian 里改过的正文。\n\n## 封面\n\n![封面](../../attachments/cover.png)\n\n## 分镜脚本\n\n| 镜号 | 景别 | 画面 | 口播 | 时长 | 画面文件 |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 近景 | 原有画面 | 原有口播 | 5 秒 | ![第 1 镜](../../attachments/shot.png) |\n`)
    const cover = { src: 'media-workbench/attachments/cover.png' }
    const shots = [{ no: 1, shot: '近景', visual: '原有画面', voice: '原有口播', seconds: 5, src: 'media-workbench/attachments/shot.png' }]
    const state = {
      items: [],
      mergedDrafts: [{ id: 'md_content', title: '旧标题', sourceIds: ['it_source'], status: 'draft', updatedAt: '2026-11-10T10:00:00.000Z', production: { title: '旧标题', article: '旧正文', format: 'video', status: 'done', sourceIds: ['it_source'], cover, shots } }],
    }
    const result = await importMarkdown(root, state, { now: '2026-11-10T12:00:00.000Z' })
    assert.equal(result.updated, 1)
    const item = state.mergedDrafts[0]
    assert.equal(item.title, 'Obsidian 改过的标题')
    assert.equal(item.production.title, 'Obsidian 改过的标题')
    assert.equal(item.production.article, '这是在 Obsidian 里改过的正文。')
    assert.equal(item.production.format, 'article')
    assert.deepEqual(item.production.cover, cover)
    assert.deepEqual(item.production.shots, shots)
    assert.equal(item.production.markdownMeta.plugin_note, '保留内容字段')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
