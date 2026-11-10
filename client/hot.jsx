import React from 'react'
import { dispatchOps, fetchAihot, useDesk } from './desk.js'
import { lang, t } from './i18n.js'
import { Dialog, Empty, Icon, IconButton, Segmented } from './ui.jsx'

const TABS = [
  { value: 'selected', label: '精选' },
  { value: 'all', label: '全部 AI 动态' },
  { value: 'hot', label: '热点榜' },
]

const CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'ai-models', label: '模型' },
  { value: 'ai-products', label: '产品' },
  { value: 'industry', label: '行业' },
  { value: 'paper', label: '论文' },
  { value: 'tip', label: '技巧' },
  { value: 'opinion', label: '观点' },
]

function formatTime(value) {
  if (!value) return t('时间未知')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('时间未知')
  return new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function categoryLabel(value) {
  return CATEGORIES.find(row => row.value === value)?.label || value || t('AI 动态')
}

function externalLink(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function sourceLabel(item) {
  return item.source || item.attribution?.name || 'AIHOT'
}

function FeedCard({ item, saved, onSave, onOpen }) {
  return (
    <article className="md-hot-card">
      <header className="md-hot-card-head">
        <span className="md-hot-source">{sourceLabel(item)} · {formatTime(item.publishedAt || item.discoveredAt)}</span>
        {item.category ? <span className="md-hot-category">{categoryLabel(item.category)}</span> : null}
      </header>
      <button type="button" className="md-hot-title" onClick={() => onOpen(item)}>{item.title}</button>
      {item.summary ? <p className="md-hot-summary">{item.summary}</p> : null}
      {item.reason ? <p className="md-hot-reason"><span>{t('推荐理由')}</span>{item.reason}</p> : null}
      <footer className="md-hot-card-foot">
        <span className="md-hot-score">{item.score === null ? null : <>{t('热度')} {item.score}</>}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={`md-pill is-small ${saved ? 'is-saved' : ''}`} onClick={() => onSave(item)} disabled={saved}>
          <Icon name={saved ? 'check' : 'plus'} size={13} />{saved ? t('已收藏') : t('记到灵感墙')}
        </button>
        {externalLink(item.links?.aihot) ? <a className="md-pill is-small" href={externalLink(item.links.aihot)} target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('查看 AIHOT')}</a> : null}
      </footer>
    </article>
  )
}

function TopicCard({ topic, onOpen }) {
  return (
    <article className="md-hot-topic">
      <button type="button" className="md-hot-rank" onClick={() => onOpen(topic)}>{String(topic.rank ?? '—').padStart(2, '0')}</button>
      <div className="md-hot-topic-body">
        <button type="button" className="md-hot-topic-title" onClick={() => onOpen(topic)}>{topic.title}</button>
        <p className="md-hot-topic-meta">
          {topic.sourceCount === null ? null : t('{n} 个来源', { n: topic.sourceCount })}
          {topic.participantCount === null ? null : ` · ${t('{n} 位参与者', { n: topic.participantCount })}`}
        </p>
        <p className="md-hot-topic-time">{formatTime(topic.latestAt)}</p>
      </div>
    </article>
  )
}

function DetailDialog({ selected, saved, onSave, onClose }) {
  if (!selected) return null
  const item = selected.kind === 'item' ? selected.value : null
  const topic = selected.kind === 'topic' ? selected.value : null
  const value = item || topic
  const aihot = externalLink(value.links?.aihot)
  const original = externalLink(value.links?.original)
  const story = externalLink(value.links?.story)
  return (
    <Dialog title={value.title} onClose={onClose} width={600}>
      <div className="md-hot-detail">
        <p className="md-hot-detail-meta">
          {item ? `${sourceLabel(item)} · ${formatTime(item.publishedAt || item.discoveredAt)}` : `${t('热点榜')} · ${formatTime(topic.latestAt)}`}
        </p>
        {item?.summary ? <p className="md-hot-detail-summary">{item.summary}</p> : null}
        {item?.reason ? <div className="md-hot-detail-block"><strong>{t('推荐理由')}</strong><p>{item.reason}</p></div> : null}
        {topic ? <div className="md-hot-detail-stats">
          {topic.sourceCount !== null ? <span>{t('{n} 个来源', { n: topic.sourceCount })}</span> : null}
          {topic.signalCount !== null ? <span>{t('{n} 条信号', { n: topic.signalCount })}</span> : null}
          {topic.participantCount !== null ? <span>{t('{n} 位参与者', { n: topic.participantCount })}</span> : null}
        </div> : null}
        {topic?.sourceNames?.length ? <div className="md-hot-detail-block"><strong>{t('参与来源')}</strong><p>{topic.sourceNames.join(' · ')}</p></div> : null}
        <div className="md-form-foot md-hot-detail-foot">
          {item ? <button type="button" className={`md-pill is-small ${saved ? 'is-saved' : 'is-primary'}`} onClick={() => onSave(item)} disabled={saved}><Icon name={saved ? 'check' : 'plus'} size={13} />{saved ? t('已收藏') : t('记到灵感墙')}</button> : null}
          <span style={{ flex: 1 }} />
          {aihot ? <a className="md-pill is-small" href={aihot} target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('查看 AIHOT')}</a> : null}
          {story ? <a className="md-pill is-small" href={story} target="_blank" rel="noreferrer"><Icon name="branch" size={13} />{t('查看事件')}</a> : null}
          {original ? <a className="md-pill is-small" href={original} target="_blank" rel="noreferrer"><Icon name="link" size={13} />{t('查看原文')}</a> : null}
        </div>
      </div>
    </Dialog>
  )
}

export function HotView() {
  const items = useDesk(s => s.state?.items ?? [])
  const [tab, setTab] = React.useState('selected')
  const [category, setCategory] = React.useState('')
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [selected, setSelected] = React.useState(null)
  const requestId = React.useRef(0)

  const savedUrls = React.useMemo(() => new Set(items.filter(item => item.kind === 'web' && item.url).map(item => item.url)), [items])

  React.useEffect(() => {
    const id = ++requestId.current
    let alive = true
    setLoading(true)
    setError(null)
    setData(null)
    fetchAihot({ tab, category: tab === 'hot' ? '' : category, q: tab === 'hot' ? '' : query, limit: 30 }).then(next => {
      if (!alive || id !== requestId.current) return
      setData(next)
    }).catch(err => {
      if (!alive || id !== requestId.current) return
      setError(err.message || t('AIHOT 暂时无法更新'))
    }).finally(() => {
      if (alive && id === requestId.current) setLoading(false)
    })
    return () => { alive = false }
  }, [tab, category, query, refreshKey])

  const saveItem = async (item) => {
    const url = externalLink(item.links?.aihot)
    if (!url) return
    const body = [item.summary, item.reason ? `${t('推荐理由')}：${item.reason}` : ''].filter(Boolean).join('\n\n')
    await dispatchOps([{
      op: 'add_item',
      kind: 'web',
      title: item.title,
      body,
      url,
      source: `AIHOT · ${sourceLabel(item)}`,
      tags: ['AIHOT', ...(item.category ? [categoryLabel(item.category)] : [])],
    }], { label: t('收藏 AIHOT 资讯') })
  }

  const loadMore = async () => {
    if (loading || tab === 'hot' || !data?.page?.hasMore || !data.page.nextCursor) return
    setLoading(true)
    try {
      const next = await fetchAihot({ tab, category, q: query, cursor: data.page.nextCursor, limit: 30 })
      setData(current => current ? { ...next, items: [...current.items, ...next.items] } : next)
    } catch (err) {
      setError(err.message || t('AIHOT 暂时无法更新'))
    } finally {
      setLoading(false)
    }
  }

  const search = (event) => {
    event.preventDefault()
    const value = queryInput.trim()
    if (value && [...value].length < 2) {
      setError(t('热点搜索词至少需要两个字'))
      return
    }
    setQuery(value)
  }

  const onTabChange = (next) => {
    setTab(next)
    setSelected(null)
    setError(null)
  }

  const onSave = async (item) => {
    await saveItem(item)
    setSelected(current => current ? { ...current } : current)
  }

  const shownItems = data?.items ?? []
  const shownTopics = data?.topics ?? []
  const selectedValue = selected?.kind === 'item' ? selected.value : null
  const savedSelected = selectedValue ? savedUrls.has(selectedValue.links?.aihot) : false

  return (
    <div className="md-page md-hot-page">
      <div className="md-page-head md-hot-head">
        <div>
          <h1>{t('热点')}</h1>
          <p className="md-page-sub">{t('关注 AI 圈最近发生的事情')}</p>
        </div>
        <span style={{ flex: 1 }} />
        <a className="md-pill is-small" href="https://aihot.news/" target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('数据来自 AIHOT')}</a>
        <IconButton icon="refresh" label={t('刷新热点')} onClick={() => setRefreshKey(value => value + 1)} active={loading} />
      </div>

      <div className="md-hot-controls">
        <Segmented value={tab} options={TABS.map(option => ({ ...option, label: t(option.label) }))} onChange={onTabChange} label={t('热点内容')} />
        {tab !== 'hot' ? <>
          <div className="md-hot-category-filter" aria-label={t('热点分类')}>
            {CATEGORIES.map(option => <button type="button" key={option.value || 'all'} className={category === option.value ? 'is-on' : ''} onClick={() => setCategory(option.value)}>{t(option.label)}</button>)}
          </div>
          <form className="md-hot-search" onSubmit={search}>
            <Icon name="search" size={14} />
            <input value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder={t('搜索热点')} aria-label={t('搜索热点')} />
            {queryInput ? <button type="button" aria-label={t('清除搜索')} onClick={() => { setQueryInput(''); setQuery('') }}><Icon name="close" size={13} /></button> : null}
          </form>
        </> : null}
      </div>

      {data?.stale ? <p className="md-hot-stale">{t('暂时显示上次内容，稍后会自动恢复更新')}</p> : null}
      {error ? <div className="md-hot-error" role="alert"><span>{error}</span><button type="button" className="md-pill is-small" onClick={() => setRefreshKey(value => value + 1)}>{t('重试')}</button></div> : null}

      {loading && !data ? <div className="md-hot-loading"><span className="md-shimmer">{t('正在读取热点…')}</span></div> : null}
      {!loading && !error && tab !== 'hot' && data && shownItems.length === 0 ? <Empty title={t('还没有找到热点')} hint={query ? t('换个关键词再试试') : t('AIHOT 暂时没有返回内容')} /> : null}
      {!loading && !error && tab === 'hot' && data && shownTopics.length === 0 ? <Empty title={t('暂时没有热点榜')} hint={t('稍后再来看看')} /> : null}

      {data && tab !== 'hot' && shownItems.length ? <div className="md-hot-feed">
        {shownItems.map(item => <FeedCard key={item.id || item.links.aihot} item={item} saved={savedUrls.has(item.links.aihot)} onSave={saveItem} onOpen={value => setSelected({ kind: 'item', value })} />)}
        {data.page?.hasMore ? <button type="button" className="md-btn md-hot-more" onClick={loadMore} disabled={loading}>{loading ? t('加载中…') : t('加载更多')}</button> : null}
      </div> : null}

      {data && tab === 'hot' && shownTopics.length ? <div className="md-hot-topics">
        {shownTopics.map(topic => <TopicCard key={topic.id || topic.rank} topic={topic} onOpen={value => setSelected({ kind: 'topic', value })} />)}
      </div> : null}

      {selected ? <DetailDialog selected={selected} saved={savedSelected} onSave={onSave} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}

