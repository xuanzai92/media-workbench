import React from 'react'
import { dispatchOps, fetchXbangdanPosts, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { Icon } from './ui.jsx'

const SECTIONS = [
  { value: 'rate', label: '增速最快', note: '近 12 小时发布' },
  { value: 'views', label: '曝光最高', note: '近 24 小时发布' },
]
const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'ai', label: 'AI' },
  { value: 'finance', label: '财经' },
  { value: 'self_media', label: '自媒体' },
]
const HOURS = [3, 6, 12, 24]
const COUNT_FORMATTERS = {
  standard: new Intl.NumberFormat('zh-CN', { notation: 'standard', maximumFractionDigits: 1 }),
  compact: new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }),
}
const UPDATED_FORMATTER = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const RESULT_CACHE_TTL_MS = 5 * 60 * 1000
const INITIAL_ROW_LIMIT = 40
const ROW_PAGE_SIZE = 40
const resultCache = new Map()
const pendingResults = new Map()

function formatCount(value) {
  if (!Number.isFinite(value)) return '—'
  return (value >= 10000 ? COUNT_FORMATTERS.compact : COUNT_FORMATTERS.standard).format(value)
}

function formatUpdated(value) {
  if (!value) return t('更新时间未知')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('更新时间未知')
  return UPDATED_FORMATTER.format(date)
}

function categoryLabel(value) {
  const aliases = { none: '全部', ai_coding: 'AI', finance: '财经', growth: '自媒体' }
  return aliases[value] || CATEGORIES.find(item => item.value === value)?.label || value || t('全部')
}

function PostRow({ row, saved, onSave }) {
  return (
    <article className="md-xbangdan-row">
      <span className="md-xbangdan-rank">{row.rank}</span>
      <div className="md-xbangdan-main">
        <a className="md-xbangdan-text" href={row.url} target="_blank" rel="noreferrer">{row.text}</a>
        <div className="md-xbangdan-meta">
          <span>{row.name} · @{row.handle}</span>
          {row.category !== 'none' ? <span>{categoryLabel(row.category)}</span> : null}
          {row.age !== null ? <span>{t('{n} 小时前', { n: row.age < 1 ? '<1' : Math.round(row.age) })}</span> : null}
        </div>
      </div>
      <div className="md-xbangdan-stats">
        <span><small>{t('点赞')}</small><b>{formatCount(row.likes)}</b></span>
        <span><small>{t(row.section === 'rate' ? '曝光/时' : '曝光')}</small><b>{formatCount(row.exposure)}</b></span>
        <span><small>{t('互动')}</small><b>{formatCount(row.interactions)}</b></span>
      </div>
      <button type="button" className={`md-pill is-small ${saved ? 'is-saved' : 'is-primary'}`} onClick={() => onSave(row)} disabled={saved}>
        <Icon name={saved ? 'check' : 'plus'} size={13} />{saved ? t('已在灵感') : t('收藏到灵感')}
      </button>
    </article>
  )
}

export function XbangdanView() {
  useLang()
  const items = useDesk(state => state.state?.items ?? [])
  const [section, setSection] = React.useState('rate')
  const [category, setCategory] = React.useState('all')
  const [hours, setHours] = React.useState(24)
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_ROW_LIMIT)
  const refreshSeen = React.useRef(0)
  const savedUrls = React.useMemo(() => new Set(items.filter(item => item.url).map(item => item.url)), [items])

  React.useEffect(() => {
    let alive = true
    const key = `${section}:${category}:${hours}`
    const forceRefresh = refreshKey !== refreshSeen.current
    refreshSeen.current = refreshKey
    const cached = resultCache.get(key)
    const cacheFresh = cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS
    if (cacheFresh && !forceRefresh) {
      setData(cached.data)
      setLoading(false)
      setError(null)
      return () => { alive = false }
    }
    setLoading(true)
    setError(null)
    const pending = pendingResults.get(key) ?? fetchXbangdanPosts({ section, category, hours })
    pendingResults.set(key, pending)
    pending.then(next => {
      resultCache.set(key, { data: next, at: Date.now() })
      if (alive) setData(next)
    }).catch(err => {
      if (alive) setError(err.message || t('xbangdan 暂时无法更新'))
    }).finally(() => {
      if (pendingResults.get(key) === pending) pendingResults.delete(key)
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [category, hours, refreshKey, section])

  React.useEffect(() => {
    setVisibleCount(INITIAL_ROW_LIMIT)
  }, [category, hours, refreshKey, section])

  const savePost = async row => {
    const details = [
      row.text,
      `${t('作者')}：${row.name} (@${row.handle})`,
      `${t('点赞')}：${formatCount(row.likes)} · ${t('曝光')}：${formatCount(row.exposure)} · ${t('互动')}：${formatCount(row.interactions)}`,
    ].join('\n')
    await dispatchOps([{
      op: 'add_item',
      kind: 'web',
      title: row.text.slice(0, 80),
      body: details,
      url: row.url,
      source: 'X榜单 · xbangdan.com',
      platform: 'X',
      tags: ['X榜单', 'xbangdan', categoryLabel(row.category)],
    }], { label: t('收藏 X 热门内容') })
  }

  const rows = data?.rows ?? []
  const visibleRows = rows.slice(0, visibleCount)
  return (
    <div className="md-page md-xbangdan-page">
      <header className="md-page-head md-xbangdan-head">
        <div><h1>{t('X 热门内容')}</h1><p className="md-page-sub">{t('来自 xbangdan 的公开 X 内容榜单 · 每小时更新')}</p></div>
        <span style={{ flex: 1 }} />
        <a className="md-btn" href="https://xbangdan.com/posts/" target="_blank" rel="noreferrer"><Icon name="upRight" size={13} />{t('打开原榜单')}</a>
        <button type="button" className="md-btn" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}><Icon name="refresh" size={13} />{loading ? t('读取中…') : t('刷新')}</button>
      </header>
      <section className="md-xbangdan-controls">
        <div className="md-xbangdan-section-tabs" role="tablist" aria-label={t('榜单分区')}>
          {SECTIONS.map(item => <button type="button" key={item.value} role="tab" aria-selected={section === item.value} className={section === item.value ? 'is-on' : ''} onClick={() => setSection(item.value)}><b>{t(item.label)}</b><small>{t(item.note)}</small></button>)}
        </div>
        <div className="md-xbangdan-filter-group" aria-label={t('赛道')}>
          {CATEGORIES.map(item => <button type="button" key={item.value} className={category === item.value ? 'is-on' : ''} onClick={() => setCategory(item.value)}>{t(item.label)}</button>)}
        </div>
        <label className="md-xbangdan-hours"><span>{t('时间范围')}</span><select value={hours} onChange={event => setHours(Number(event.target.value))}>{HOURS.map(value => <option key={value} value={value}>{t('最近 {n} 小时', { n: value })}</option>)}</select></label>
      </section>
      {data?.updated ? <p className="md-xbangdan-updated">{t('榜单更新时间')}：{formatUpdated(data.updated)} · {t('当前 {n} 条', { n: rows.length })}</p> : null}
      {error ? <section className="md-tile md-ranking-error"><Icon name="alert" size={16} /><span>{error}</span><button type="button" className="md-inline-link" onClick={() => setRefreshKey(value => value + 1)}>{t('重试')}</button></section> : null}
      {loading && !data ? <section className="md-tile md-ranking-loading"><span className="md-shimmer">{t('正在读取 X 热门内容…')}</span></section> : null}
      {!loading && !error && !rows.length ? <section className="md-tile md-ranking-loading"><span>{t('当前筛选没有内容')}</span></section> : null}
      {rows.length ? <section className="md-tile md-xbangdan-list"><header><div><h2>{t(SECTIONS.find(item => item.value === section)?.label || 'X 热门内容')}</h2><p>{categoryLabel(category)} · {t('最近 {n} 小时', { n: hours })}</p></div><span className="md-ranking-source">xbangdan.com</span></header><div>{visibleRows.map(row => <PostRow key={`${row.section}:${row.id}`} row={row} saved={savedUrls.has(row.url)} onSave={savePost} />)}</div>{visibleCount < rows.length ? <button type="button" className="md-btn md-xbangdan-more" onClick={() => setVisibleCount(count => Math.min(count + ROW_PAGE_SIZE, rows.length))}>{t('加载更多')}</button> : null}</section> : null}
    </div>
  )
}

