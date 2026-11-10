import React from 'react'
import { dispatchOps, fetchAihot, fetchAihotStory, useDesk } from './desk.js'
import { lang, t } from './i18n.js'
import { Empty, Icon, IconButton, Segmented } from './ui.jsx'

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

function StoryReportCard({ report }) {
  const aihot = externalLink(report.links?.aihot)
  const original = externalLink(report.links?.original)
  return <article className="md-hot-story-report">
    <span className="md-hot-story-dot" aria-hidden="true" />
    <div className="md-hot-story-report-body">
      <header className="md-hot-story-report-head">
        <time>{formatTime(report.publishedAt)}</time>
        <span>{report.source}</span>
        {report.firstParty ? <em>{t('官方一手')}</em> : null}
      </header>
      <h4>{report.title}</h4>
      {report.summary ? <p>{report.summary}</p> : null}
      <footer>
        {aihot ? <a className="md-pill is-small" href={aihot} target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('查看 AIHOT')}</a> : null}
        {original ? <a className="md-pill is-small" href={original} target="_blank" rel="noreferrer"><Icon name="link" size={13} />{t('查看原文')}</a> : null}
      </footer>
    </div>
  </article>
}

function StoryPanel({ story, loading, error, onRetry }) {
  if (!story && loading) {
    return <section className="md-hot-story-panel"><div className="md-hot-loading"><span className="md-shimmer">{t('正在读取事件详情…')}</span></div></section>
  }
  if (!story && error) {
    return <section className="md-hot-story-panel"><div className="md-hot-error" role="alert"><span>{error}</span><button type="button" className="md-pill is-small" onClick={onRetry}>{t('重试')}</button></div></section>
  }
  if (!story) return null
  const reports = Array.isArray(story.reports) ? story.reports : []
  const neighbors = [...(story.storyline || []), ...(story.related || [])].filter((row, index, rows) => row.publicId && rows.findIndex(item => item.publicId === row.publicId) === index)
  return <section className="md-hot-story-panel">
    <header className="md-hot-story-head">
      <div>
        <p className="md-hot-story-kicker">{t('相关事件')}</p>
        <h3>{story.title}</h3>
      </div>
      <div className="md-hot-story-counts">
        {story.reportCount !== null ? <span>{t('{n} 篇报道', { n: story.reportCount })}</span> : null}
        {story.sourceCount !== null ? <span>{t('{n} 个来源', { n: story.sourceCount })}</span> : null}
        {loading ? <span>{t('更新中…')}</span> : null}
      </div>
    </header>
    {error ? <div className="md-hot-story-inline-error" role="alert"><span>{error}</span><button type="button" className="md-pill is-small" onClick={onRetry}>{t('重试')}</button></div> : null}
    {story.digest ? <div className="md-hot-story-digest"><strong>{t('事件概览')}</strong><p>{story.digest}</p></div> : null}
    {story.latest ? <div className="md-hot-story-latest"><strong>{t('最新进展')} · {formatTime(story.latestAt)}</strong><p>{story.latest}</p></div> : null}
    <div className="md-hot-story-timeline">
      <div className="md-hot-story-section-head">
        <h3>{t('事件进展')}</h3>
        <span>{story.status === 'active' ? t('持续更新') : t('事件已基本落定')}</span>
      </div>
      {reports.length ? <div className="md-hot-story-reports">{reports.map(report => <StoryReportCard key={report.id || report.links.aihot} report={report} />)}</div> : <p className="md-hot-story-empty">{t('暂无事件报道')}</p>}
    </div>
    {neighbors.length ? <div className="md-hot-story-related">
      <div className="md-hot-story-section-head"><h3>{t('关联事件')}</h3></div>
      <div className="md-hot-story-neighbors">{neighbors.map(neighbor => {
        const href = externalLink(neighbor.links?.aihot)
        return href ? <a key={neighbor.publicId} href={href} target="_blank" rel="noreferrer"><span>{neighbor.title}</span><small>{neighbor.relation}</small><Icon name="upRight" size={13} /></a> : null
      })}</div>
    </div> : null}
  </section>
}

function HotDetailPage({ selected, saved, onSave, story, storyLoading, storyError, onStoryRetry }) {
  if (!selected) return null
  const item = selected.kind === 'item' ? selected.value : null
  const topic = selected.kind === 'topic' ? selected.value : null
  const value = item || topic
  const aihot = externalLink(value.links?.aihot)
  const original = externalLink(value.links?.original)
  const storyLink = externalLink(value.links?.story)
  return <div className="md-hot-detail">
    <article className="md-hot-detail-page">
      <p className="md-hot-detail-meta">
        {item ? `${sourceLabel(item)} · ${formatTime(item.publishedAt || item.discoveredAt)}` : `${t('热点榜')} · ${formatTime(topic.latestAt)}`}
      </p>
      <h2>{value.title}</h2>
      {item?.summary ? <p className="md-hot-detail-summary">{item.summary}</p> : null}
      {item?.reason ? <div className="md-hot-detail-block"><strong>{t('推荐理由')}</strong><p>{item.reason}</p></div> : null}
      {item?.score !== null && item?.score !== undefined ? <div className="md-hot-detail-stats"><span>{t('热度')} {item.score}</span></div> : null}
      {topic ? <div className="md-hot-detail-stats">
        {topic.sourceCount !== null ? <span>{t('{n} 个来源', { n: topic.sourceCount })}</span> : null}
        {topic.signalCount !== null ? <span>{t('{n} 条信号', { n: topic.signalCount })}</span> : null}
        {topic.participantCount !== null ? <span>{t('{n} 位参与者', { n: topic.participantCount })}</span> : null}
      </div> : null}
      {topic?.sourceNames?.length ? <div className="md-hot-detail-block"><strong>{t('参与来源')}</strong><p>{topic.sourceNames.join(' · ')}</p></div> : null}
      <div className="md-hot-detail-foot">
        {item ? <button type="button" className={`md-pill is-small ${saved ? 'is-saved' : 'is-primary'}`} onClick={() => onSave(item)} disabled={saved}><Icon name={saved ? 'check' : 'plus'} size={13} />{saved ? t('已收藏') : t('记到灵感墙')}</button> : null}
        <span style={{ flex: 1 }} />
        {aihot ? <a className="md-pill is-small is-primary" href={aihot} target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('查看 AIHOT')}</a> : null}
        {storyLink ? <a className="md-pill is-small" href={storyLink} target="_blank" rel="noreferrer"><Icon name="branch" size={13} />{t('查看事件')}</a> : null}
        {original ? <a className="md-pill is-small" href={original} target="_blank" rel="noreferrer"><Icon name="link" size={13} />{t('查看原文')}</a> : null}
      </div>
    </article>
    {topic ? <StoryPanel story={story} loading={storyLoading} error={storyError} onRetry={onStoryRetry} /> : null}
  </div>
}

function dayKey(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(value) {
  if (value === 'unknown') return t('时间未知')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date)
}

function TimelineFeed({ items, savedUrls, onSave, onOpen, hasMore, loading, onLoadMore }) {
  const groups = React.useMemo(() => {
    const result = []
    const byDay = new Map()
    for (const item of items) {
      const key = dayKey(item.publishedAt || item.discoveredAt)
      let group = byDay.get(key)
      if (!group) {
        group = { key, items: [] }
        byDay.set(key, group)
        result.push(group)
      }
      group.items.push(item)
    }
    return result
  }, [items])
  return <div className="md-hot-timeline">
    {groups.map(group => <section className="md-hot-timeline-day" key={group.key}>
      <time className="md-hot-timeline-label">{dayLabel(group.key)}</time>
      <div className="md-hot-timeline-items">
        {group.items.map(item => <div className="md-hot-timeline-item" key={item.id || item.links.aihot}>
          <span className="md-hot-timeline-dot" aria-hidden="true" />
          <FeedCard item={item} saved={savedUrls.has(item.links.aihot)} onSave={onSave} onOpen={onOpen} />
        </div>)}
      </div>
    </section>)}
    {hasMore ? <button type="button" className="md-btn md-hot-more" onClick={onLoadMore} disabled={loading}>{loading ? t('加载中…') : t('加载更多')}</button> : null}
  </div>
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
  const [story, setStory] = React.useState(null)
  const [storyLoading, setStoryLoading] = React.useState(false)
  const [storyError, setStoryError] = React.useState(null)
  const [storyRefreshKey, setStoryRefreshKey] = React.useState(0)
  const requestId = React.useRef(0)
  const storyRequestId = React.useRef(0)

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

  React.useEffect(() => {
    const storyUrl = selected?.kind === 'topic' ? selected.value.links?.story : null
    const id = ++storyRequestId.current
    let alive = true
    setStory(null)
    setStoryError(null)
    if (!storyUrl) {
      setStoryLoading(false)
      return () => { alive = false }
    }
    setStoryLoading(true)
    fetchAihotStory(storyUrl, { refresh: storyRefreshKey > 0 }).then(next => {
      if (!alive || id !== storyRequestId.current) return
      setStory(next)
    }).catch(err => {
      if (!alive || id !== storyRequestId.current) return
      setStoryError(err.message || t('AIHOT 暂时无法更新'))
    }).finally(() => {
      if (alive && id === storyRequestId.current) setStoryLoading(false)
    })
    return () => { alive = false }
  }, [selected, storyRefreshKey])

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
    setStory(null)
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
  const refresh = () => {
    if (selected?.kind === 'topic') setStoryRefreshKey(value => value + 1)
    else setRefreshKey(value => value + 1)
  }

  return (
    <div className="md-page md-hot-page">
      <div className="md-page-head md-hot-head">
        {selected ? <IconButton icon="chevL" label={t('返回热点')} onClick={() => setSelected(null)} /> : null}
        <div>
          <h1>{selected ? t('热点详情') : t('热点')}</h1>
          <p className="md-page-sub">{t('关注 AI 圈最近发生的事情')}</p>
        </div>
        <span style={{ flex: 1 }} />
        {selected ? <IconButton icon="refresh" label={selected.kind === 'topic' ? t('刷新事件') : t('刷新热点')} onClick={refresh} active={selected.kind === 'topic' ? storyLoading : loading} /> : <>
          <span className="md-hot-source-badge"><Icon name="spark" size={13} />{t('数据来自 AIHOT')}</span>
          <IconButton icon="refresh" label={t('刷新热点')} onClick={refresh} active={loading} />
        </>}
      </div>

      {selected ? <HotDetailPage selected={selected} saved={savedSelected} onSave={onSave} story={story} storyLoading={storyLoading} storyError={storyError} onStoryRetry={() => setStoryRefreshKey(value => value + 1)} /> : <>
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

      {data && tab !== 'hot' && shownItems.length ? <TimelineFeed items={shownItems} savedUrls={savedUrls} onSave={saveItem} onOpen={value => setSelected({ kind: 'item', value })} hasMore={data.page?.hasMore} loading={loading} onLoadMore={loadMore} /> : null}

      {data && tab === 'hot' && shownTopics.length ? <div className="md-hot-topics">
        {shownTopics.map(topic => <TopicCard key={topic.id || topic.rank} topic={topic} onOpen={value => setSelected({ kind: 'topic', value })} />)}
      </div> : null}

      </>}
    </div>
  )
}

