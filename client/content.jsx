// 内容管理：看板和表格是同一份数据的两种看法。
import React from 'react'
import { dispatchOps, openItem, openMergedItem, setDesk, useDesk } from './desk.js'
import { Empty, Icon, Segmented } from './ui.jsx'
import { plural, t, useLang } from './i18n.js'
import { KIND_LABEL, STATUSES, STATUS_LABEL, displayItem, fmtWhen, posterOf, relativeDay } from './util.js'

const FORMAT_LABEL = { image_text: '图文', article: '文章', video: '视频脚本' }
const CONTENT_STATUSES = ['draft', 'ready', 'published', 'archived']

function formatOf(item) {
  const format = item.production?.format
  return format ? t(FORMAT_LABEL[format] || format) : null
}

function mergedContentRecord(draft, items) {
  const production = draft.production ?? {}
  const sourceIds = [...new Set(draft.sourceIds ?? [])]
  const sources = sourceIds.map(id => items.find(item => item.id === id)).filter(Boolean)
  const format = production.format ?? null
  return {
    id: draft.id,
    kind: format === 'video' ? 'video' : format === 'image_text' ? 'image' : 'note',
    title: production.title || draft.title || t('合并成稿'),
    body: production.article || sources.map(item => item.body || item.title).join('\n\n'),
    source: t('合并成稿'),
    status: draft.status ?? (production.status === 'done' ? 'draft' : 'outline'),
    scheduledAt: draft.scheduledAt ?? null,
    platform: draft.platform ?? null,
    createdAt: draft.createdAt,
    production,
    sourceIds,
    _sourceTitles: sources.map(item => item.title),
    _merged: true,
  }
}

function openContentItem(item, event = null) {
  const rect = event?.currentTarget?.getBoundingClientRect?.()
  const origin = rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null
  if (item._merged) openMergedItem(item.id, origin)
  else openItem(item.id, origin)
}

function useContentItems() {
  const items = useDesk(s => s.state.items)
  const mergedDrafts = useDesk(s => s.state?.mergedDrafts ?? [])
  const query = useDesk(s => s.query).trim().toLowerCase()
  return React.useMemo(() => {
    // 内容页只展示已经完成成稿的内容；灵感和生成中的任务留在灵感墙/排期页。
    const rows = [
      ...items.filter(item => item.production?.status === 'done' || item.production?.article || item.drafts?.article || item.drafts?.script || ['ready', 'published', 'archived'].includes(item.status)),
      ...mergedDrafts.filter(draft => draft.production?.status === 'done' || draft.production?.article).map(draft => mergedContentRecord(draft, items)),
    ]
    return rows.filter((item) => {
      if (!query) return true
      return [item.title, item.body, item.source, item.platform, item.platform && t(item.platform), formatOf(item), ...(item._sourceTitles ?? []), ...(item.tags ?? [])].some(v => String(v ?? '').toLowerCase().includes(query))
    })
  }, [items, mergedDrafts, query])
}

function BoardCard({ item: raw }) {
  // 有成稿时显示成稿的标题和封面
  const item = displayItem(raw)
  const poster = posterOf(item)
  return (
    <button
      type="button"
      className={`md-board-card${item._merged ? ' is-merged' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/media-workbench-item', item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(event) => openContentItem(item, event)}
    >
      {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : null}
      <strong>{item.title}</strong>
      <span className="md-board-meta">
        {item._merged ? <span>{t('合并成稿')}</span> : item.platform ? <span>{t(item.platform)}</span> : null}
        {item.sourceIds?.length ? <span>{t('{n} 个来源', { n: item.sourceIds.length })}</span> : null}
        {formatOf(item) ? <span className="md-content-format">{formatOf(item)}</span> : null}
        {item.scheduledAt && item.status !== 'published' ? <span className="is-time">{relativeDay(item.scheduledAt)}</span> : null}
        {raw.production?.status === 'done' || item.drafts?.article ? <Icon name="pen" size={12} /> : null}
        {item.drafts?.script ? <Icon name="film" size={12} /> : null}
      </span>
    </button>
  )
}

function Board({ items }) {
  const [over, setOver] = React.useState(null)
  return (
    <div className="md-board">
      {CONTENT_STATUSES.map((status) => {
        const rows = items.filter(i => i.status === status && !(i.parentId && i.status === 'idea'))
        return (
          <section
            key={status}
            className={`md-board-col ${over === status ? 'is-over' : ''}`}
            aria-label={t(STATUS_LABEL[status])}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(status)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOver(null)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setOver(null)
              const id = event.dataTransfer.getData('text/media-workbench-item')
              if (id) dispatchOps([{ op: 'set_status', id, status }], { label: t('修改状态') })
            }}
          >
            <header>
              <span className={`md-dot status-${status}`} />
              <h3>{t(STATUS_LABEL[status])}</h3>
              <span className="md-muted">{rows.length}</span>
            </header>
            <div className="md-board-list">
              {rows.map(item => <BoardCard key={item.id} item={item} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// label 是中文原文，显示时再翻译
const COLUMNS = [
  { key: 'title', label: '内容', get: i => i.title },
  { key: 'status', label: '状态', get: i => STATUSES.indexOf(i.status) },
  { key: 'platform', label: '平台', get: i => i.platform ?? '' },
  { key: 'scheduledAt', label: '排期', get: i => i.scheduledAt ?? '' },
  { key: 'createdAt', label: '记录于', get: i => i.createdAt },
]

function Table({ items }) {
  const [sort, setSort] = React.useState({ key: 'createdAt', dir: -1 })
  const sorted = React.useMemo(() => {
    const column = COLUMNS.find(c => c.key === sort.key)
    return [...items].sort((a, b) => {
      const x = column.get(a)
      const y = column.get(b)
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [items, sort])
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {COLUMNS.map(column => (
              <th key={column.key} aria-sort={sort.key === column.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort(s => ({ key: column.key, dir: s.key === column.key ? -s.dir : 1 }))}>
                  {t(column.label)}
                  {sort.key === column.key ? <Icon name={sort.dir > 0 ? 'send' : 'chevD'} size={11} /> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const poster = posterOf(item)
            return (
              <tr key={item.id} onClick={() => openContentItem(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openContentItem(item) }}>
                <td className="md-table-title">
                  <span className="md-thumb">{poster ? <img src={poster} alt="" loading="lazy" /> : <span>{item.title.slice(0, 1)}</span>}</span>
                  <span><strong>{item.title}</strong><small>{item._merged ? `${t('合并成稿')} · ${t('{n} 个来源', { n: item.sourceIds?.length ?? 0 })}` : `${item.parentId ? `${t('分支')} · ` : ''}${t(KIND_LABEL[item.kind])}${item.source ? ` · ${item.source}` : ''}`}{formatOf(item) ? ` · ${formatOf(item)}` : ''}</small></span>
                </td>
                <td><span className={`md-status status-${item.status}`}>{t(STATUS_LABEL[item.status])}</span></td>
                <td>{item.platform ? t(item.platform) : '—'}</td>
                <td className="md-nowrap">{item.scheduledAt ? fmtWhen(item.scheduledAt) : '—'}</td>
                <td className="md-nowrap">{relativeDay(item.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ContentView() {
  useLang()
  const [mode, setMode] = React.useState('board')
  const items = useContentItems()
  const allItems = useDesk(s => s.state.items)
  const query = useDesk(s => s.query)
  const counts = CONTENT_STATUSES.map(s => items.filter(i => i.status === s).length)
  const ideas = allItems.filter(i => i.status === 'idea' && !i.parentId).length
  const drafts = items.filter(i => i.production?.status === 'done' || i.drafts?.article || i.drafts?.script).length
  return (
    <div className="md-page">
      <header className="md-page-head">
        <div>
          <h1>{t('内容')}</h1>
          <p className="md-page-sub">{[
            t(plural(items.length, '共 1 条', '共 {n} 条'), { n: items.length }),
            t(plural(ideas, '1 个灵感待推进', '{n} 个灵感待推进'), { n: ideas }),
            t('{n} 篇已成稿', { n: drafts }),
            t('{n} 篇已发布', { n: counts[2] }),
          ].join(' · ')}</p>
        </div>
        <span style={{ flex: 1 }} />
        <label className="md-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={e => setDesk({ query: e.target.value })} placeholder={t('搜索标题、标签、平台')} aria-label={t('搜索内容')} />
        </label>
        <Segmented label={t('显示方式')} value={mode} onChange={setMode} options={[{ value: 'board', label: t('看板') }, { value: 'table', label: t('表格') }]} />
      </header>
      {items.length === 0 ? <Empty title={query ? t('没有匹配的内容') : t('还没有内容')} hint={query ? t('换个关键词试试。') : t('到灵感页记下第一条。')} /> : mode === 'board' ? <Board items={items} /> : <Table items={items} />}
    </div>
  )
}
