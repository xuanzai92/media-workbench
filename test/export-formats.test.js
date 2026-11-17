import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { productionMarkdown } from '../src/content-output.js'
import { saveProduction } from '../src/export.js'
import { withLang } from '../src/i18n.js'
import { importMarkdown, parseFrontmatter, writeContentMarkdown } from '../src/markdown.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-delivery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filesDir = join(root, 'attachments')
  await mkdir(filesDir)
  await writeFile(join(filesDir, 'one.png'), Buffer.from('first-image'))
  await writeFile(join(filesDir, 'two.png'), Buffer.from('second-image'))
  return { root, filesDir, exportDir: join(root, 'exports') }
}

function content(format = 'article') {
  return {
    status: 'done', textStatus: 'done', format, title: '可交付内容',
    article: '开头。\n\n## 改过的标题\n\n正文细节。\n\n## 自己补充\n\n保留自定义内容。', imageCount: 2,
    images: [
      { status: 'done', anchor: '旧标题', caption: '首图说明', src: 'media-workbench/attachments/one.png' },
      { status: 'done', caption: '第二张说明', src: 'media-workbench/attachments/two.png' },
    ],
  }
}

test('文章导出复制全部附件，图片位置与预览共用组装结果', async t => {
  const options = await fixture(t)
  const production = content()
  const saved = await saveProduction(production, options)
  assert.deepEqual(saved.warnings, [])
  assert.deepEqual(saved.files, ['配图01.png', '配图02.png', '文章.md', '导出说明.txt'])
  assert.equal(await readFile(join(saved.path, '文章.md'), 'utf8'), productionMarkdown(production, { imageSrc: (_, index) => `配图0${index + 1}.png` }))
  assert.equal(await readFile(join(saved.path, '配图01.png'), 'utf8'), 'first-image')
  assert.equal(await readFile(join(saved.path, '配图02.png'), 'utf8'), 'second-image')
})

test('图文导出独立短配文与有序图片，英文交付文件名也明确', async t => {
  const options = await fixture(t)
  const production = content('image_text')
  production.article = '可以独立阅读的短正文。'
  production.images.reverse()
  const saved = await withLang('en', () => saveProduction(production, options))
  assert.deepEqual(saved.files, ['image-01.png', 'image-02.png', 'post.md', 'export-notes.txt'])
  assert.equal(await readFile(join(saved.path, 'image-01.png'), 'utf8'), 'second-image')
  assert.equal(await readFile(join(saved.path, 'post.md'), 'utf8'), '# 可交付内容\n\n可以独立阅读的短正文。\n\n![第二张说明](image-01.png)\n\n![首图说明](image-02.png)\n')
})

test('正文和图片齐全时仍保留示意规划提醒，避免把规划降级当作完成核对', async t => {
  const options = await fixture(t)
  const production = content()
  const planNotice = '规划生成失败，暂用示意方案；请核对图片内容。'
  production.planNotice = ` ${planNotice} `
  const saved = await saveProduction(production, options)
  assert.deepEqual(saved.warnings, [planNotice])
  const notes = await readFile(join(saved.path, '导出说明.txt'), 'utf8')
  assert.equal(notes.split(planNotice).length - 1, 1)
  assert.doesNotMatch(notes, /正文和所需图片已齐全/)
})

test('部分结果可明确导出，补齐后刷新说明，保留用户额外文件', async t => {
  const options = await fixture(t)
  const production = content('image_text')
  production.images[1] = { status: 'failed', caption: '第二张', error: 'timeout' }
  production.textStatus = 'fallback'
  const first = await saveProduction(production, options)
  assert.equal(first.warnings.length, 2)
  assert.match(await readFile(join(first.path, '导出说明.txt'), 'utf8'), /结构草稿[\s\S]*图片尚未齐全（1\/2）/)
  assert.doesNotMatch(await readFile(join(first.path, '图文.md'), 'utf8'), /图片02/)
  await writeFile(join(first.path, '自己的备注.txt'), '不要覆盖')
  const second = await saveProduction({ ...content('image_text'), savedPath: first.path }, options)
  assert.deepEqual(second.warnings, [])
  assert.match(await readFile(join(first.path, '导出说明.txt'), 'utf8'), /正文和所需图片已齐全/)
  assert.doesNotMatch(await readFile(join(first.path, '导出说明.txt'), 'utf8'), /结构草稿|尚未齐全/)
  assert.equal(await readFile(join(first.path, '自己的备注.txt'), 'utf8'), '不要覆盖')
})

test('丢失或远程附件在覆盖任何文件之前明确报错', async t => {
  const options = await fixture(t)
  const targetDir = join(options.root, 'existing-export')
  await mkdir(targetDir)
  await writeFile(join(targetDir, '文章.md'), '保留上次导出')
  for (const src of ['media-workbench/attachments/missing.png', 'https://example.com/photo.png', 'media-workbench/assets/../../secret.png']) {
    const production = content()
    production.images[1].src = src
    await assert.rejects(saveProduction(production, { ...options, targetDir }), /第 2 张图/)
    assert.deepEqual(await readdir(targetDir), ['文章.md'])
    assert.equal(await readFile(join(targetDir, '文章.md'), 'utf8'), '保留上次导出')
  }
})

test('空正文或生成中不能被导出为完整成品', async t => {
  const options = await fixture(t)
  await assert.rejects(saveProduction({ ...content(), article: '' }, options), /正文为空/)
  await assert.rejects(saveProduction({ ...content(), status: 'running' }, options), /仍在生成/)
  await assert.rejects(readdir(options.exportDir), { code: 'ENOENT' })
})

test('重画失败保留旧图时，导出明确区分上一版图片与新图完成', async t => {
  const options = await fixture(t)
  const production = content('image_text')
  production.images[1].status = 'failed'
  production.images[1].error = 'retry failed'
  const saved = await saveProduction(production, options)
  assert.match(saved.warnings.join('\n'), /图片尚未齐全（1\/2）[\s\S]*第 2 张图未生成成功[\s\S]*上一版图片/)
  assert.equal(await readFile(join(saved.path, '图片02.png'), 'utf8'), 'second-image')
  assert.match(await readFile(join(saved.path, '图文.md'), 'utf8'), /图片02\.png/)
})

test('减少配图后再次导出不删除旧文件，并明确列出本次版本不包含的文件', async t => {
  const options = await fixture(t)
  const production = content('image_text')
  const first = await saveProduction(production, options)
  production.images.pop()
  production.imageCount = 1
  const second = await saveProduction(production, options)
  assert.ok(!second.files.includes('图片02.png'))
  assert.match(second.warnings.join('\n'), /不属于本次版本[\s\S]*图片02\.png/)
  assert.match(await readFile(join(second.path, '导出说明.txt'), 'utf8'), /不属于本次版本[\s\S]*图片02\.png/)
  assert.equal(await readFile(join(first.path, '图片02.png'), 'utf8'), 'second-image')
  assert.doesNotMatch(await readFile(join(second.path, '图文.md'), 'utf8'), /图片02\.png/)
})

test('导出目标存在同名目录时，提前报错而不改动其他导出文件', async t => {
  const options = await fixture(t)
  const targetDir = join(options.root, 'conflicting-export')
  await mkdir(join(targetDir, '文章.md'), { recursive: true })
  await assert.rejects(saveProduction(content(), { ...options, targetDir }), /不是普通文件/)
  assert.deepEqual(await readdir(targetDir), ['文章.md'])
})

test('普通稿与合并稿 Markdown 投影往返不重复配图，保留来源与自定义正文', async t => {
  const { root } = await fixture(t)
  const ordinary = { id: 'it_article', title: '原标题', status: 'draft', createdAt: '2026-11-17T01:00:00.000Z', production: content() }
  const merged = { id: 'md_images', sourceIds: ['it_article'], status: 'draft', createdAt: ordinary.createdAt, production: { ...content('image_text'), markdownMeta: { user_note: '自定义字段' } } }
  const state = { items: [ordinary], mergedDrafts: [merged] }
  for (const item of [ordinary, merged]) {
    const originalArticle = item.production.article
    const path = await writeContentMarkdown(root, item, state)
    const first = await readFile(path, 'utf8')
    assert.equal((first.match(/media-workbench:image:\d+/g) ?? []).length, 2)
    assert.match(first, /\.\.\/\.\.\/attachments\/one.png/)
    await importMarkdown(root, state)
    assert.equal(item.production.article, originalArticle)
    await writeContentMarkdown(root, item, state)
    const second = await readFile(path, 'utf8')
    assert.equal((second.match(/media-workbench:image:\d+/g) ?? []).length, 2)
    assert.match(second, /## 自己补充\n\n保留自定义内容/)
    if (item === merged) {
      assert.equal(parseFrontmatter(second).fields.user_note, '自定义字段')
      assert.match(second, /## 来源灵感/)
    }
  }
})
