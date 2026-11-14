// RedFox 社媒榜单：只在用户主动打开/切换筛选时读取，避免无意中消耗榜单接口额度。
import React from 'react'
import { dispatchOps, fetchRedfoxRankings, setDesk, useDesk } from './desk.js'
import { compact } from './util.js'
import { t, useLang } from './i18n.js'
import { Icon } from './ui.jsx'

const PLATFORMS = [
  { id: 'xiaohongshu', label: '小红书', note: '爆款笔记' },
  { id: 'douyin', label: '抖音', note: '热门作品' },
]
const BOARD_DEFS = {
  xiaohongshu: [
    { id: 'xhs_weekly_viral', label: '小红书7日爆款笔记', note: '近 7 日互动量靠前', period: 'week' },
    { id: 'xhs_daily_viral', label: '小红书每日爆款笔记榜单', note: '单日互动量靠前', period: 'day' },
    { id: 'xhs_breakout', label: '小红书黑马爆文榜', note: '低粉账号的爆发作品', period: 'day' },
  ],
  douyin: [
    { id: 'douyin_hot_works', label: '抖音每日热门作品榜', note: '每日热门作品', period: 'day' },
    { id: 'douyin_daily_rising', label: '抖音每日点赞飙升榜', note: '单日点赞增长', period: 'day' },
    { id: 'douyin_weekly_rising', label: '抖音7日点赞飙升榜', note: '近 7 日点赞增长', period: 'week' },
  ],
}
const FIXED_CATEGORY = '数码科技'
const INITIAL_ROW_LIMIT = 32
const ROW_PAGE_SIZE = 32

function yesterday() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

function metric(value) {
  if (typeof value === 'string' && value) return value
  return compact(Number(value) || 0)
}

function Stat({ label, value }) {
  return <span className="md-ranking-stat"><small>{label}</small><b>{metric(value)}</b></span>
}

function RankingRow({ row, onCollect, collecting, collected }) {
  return (
    <article className="md-ranking-row">
      <span className={`md-ranking-rank is-${row.rank <= 3 ? row.rank : 'normal'}`}>{row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}</span>
      <span className="md-ranking-avatar">{row.avatar ? <img src={row.avatar} alt="" loading="lazy" /> : <Icon name="user" size={16} />}</span>
      <div className="md-ranking-main">
        <div className="md-ranking-title">
          {row.title ? (row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.title}</a> : <strong>{row.title}</strong>) : null}
          {row.category ? <span>{row.category}</span> : null}
        </div>
        {row.name ? <p>{row.name}</p> : null}
      </div>
      <div className="md-ranking-stats">
        <Stat label={t('点赞')} value={row.stats?.likes} /><Stat label={t('评论')} value={row.stats?.comments} /><Stat label={t('收藏')} value={row.stats?.saves} /><Stat label={t('分享')} value={row.stats?.shares} />
      </div>
      <div className="md-ranking-actions">
        {row.url ? <a className="md-ranking-open" href={row.url} target="_blank" rel="noreferrer"><Icon name="upRight" size={12} />{t('查看原文')}</a> : null}
        <button type="button" className="md-pill is-small" onClick={() => onCollect(row)} disabled={collecting || collected}>{collected ? t('已采集') : collecting ? t('采集中…') : t('采集')}</button>
      </div>
    </article>
  )
}

export function RankingsView() {
  useLang()
  const hasKey = useDesk(s => Boolean(s.settings?.redfox?.hasKey))
  const items = useDesk(s => s.state?.items)
  const [platform, setPlatform] = React.useState('xiaohongshu')
  const [ranking, setRanking] = React.useState(BOARD_DEFS.xiaohongshu[0].id)
  const [date, setDate] = React.useState(yesterday)
  const [result, setResult] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [collectingKeys, setCollectingKeys] = React.useState(() => new Set())
  const [collectedKeys, setCollectedKeys] = React.useState(() => new Set())
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_ROW_LIMIT)
  const boards = BOARD_DEFS[platform] ?? BOARD_DEFS.xiaohongshu
  const activeBoard = boards.find(item => item.id === ranking) ?? boards[0]

  const load = React.useCallback(async () => {
    if (!hasKey || !activeBoard) return
    setLoading(true)
    setError(null)
    try {
      const next = await fetchRedfoxRankings({ platform, ranking: activeBoard.id, period: activeBoard.period, date, category: FIXED_CATEGORY })
      setResult(next)
    } catch (err) {
      setResult(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeBoard, date, hasKey, platform])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => { setVisibleCount(INITIAL_ROW_LIMIT) }, [platform, ranking, date])

  const selectPlatform = next => {
    const nextBoard = BOARD_DEFS[next]?.[0]
    setPlatform(next)
    setRanking(nextBoard?.id ?? '')
    setResult(null)
  }
  const selectBoard = next => { setRanking(next); setResult(null) }
  const rowKey = row => `${platform}:${row.rank}:${row.url || row.title || row.name}`
  const isCollected = row => collectedKeys.has(rowKey(row)) || (row.url && (items ?? []).some(item => item.url === row.url))
  const collectRow = async row => {
    const key = rowKey(row)
    if (collectingKeys.has(key) || isCollected(row)) return
    setCollectingKeys(current => new Set(current).add(key))
    try {
      const platformLabel = platform === 'douyin' ? '抖音' : '小红书'
      const body = [
        row.body || row.title,
        row.name ? `${t('作者')}：${row.name}` : '',
        `${t('赛道')}：${row.category || FIXED_CATEGORY}`,
      ].filter(Boolean).join('\n')
      const data = await dispatchOps([{
        op: 'add_item',
        kind: 'web',
        title: row.title || row.name || t('无标题'),
        body,
        ...(row.url ? { url: row.url } : {}),
        source: `RedFox · ${platformLabel}`,
        platform: platformLabel,
        tags: ['RedFox', platformLabel, FIXED_CATEGORY],
      }], { label: t('采集社媒榜单内容') })
      if (data) setCollectedKeys(current => new Set(current).add(key))
    } finally {
      setCollectingKeys(current => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  if (!hasKey) {
    return <div className="md-board-page"><section className="md-tile md-ranking-empty"><div><Icon name="chart" size={28} /><h1>{t('社媒榜单')}</h1><p>{t('从 RedFox 读取小红书和抖音的公开榜单，帮助你找到值得跟进的账号和选题。')}</p><button type="button" className="md-btn is-primary" onClick={() => setDesk({ settingsOpen: true })}>{t('去设置 RedFox')}</button></div></section></div>
  }

  const rows = result?.rows ?? []
  const visibleRows = rows.slice(0, visibleCount)

  return (
    <div className="md-board-page md-rankings-page">
      <header className="md-page-head md-ranking-head">
        <div><h1>{t('社媒榜单')}</h1><p className="md-page-sub">{t('来自 RedFox 的公开榜单 · 数据按榜单日期更新')}</p></div>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-btn" onClick={() => load()} disabled={loading}><Icon name="refresh" size={13} />{loading ? t('读取中…') : t('刷新榜单')}</button>
      </header>
      <section className="md-ranking-controls">
        <div className="md-ranking-selection">
          <div className="md-ranking-platforms" role="tablist" aria-label={t('榜单平台')}>
            {PLATFORMS.map(item => <button type="button" key={item.id} role="tab" aria-selected={platform === item.id} className={platform === item.id ? 'is-on' : ''} onClick={() => selectPlatform(item.id)}><b>{t(item.label)}</b><small>{t(item.note)}</small></button>)}
          </div>
          <div className="md-ranking-board-tabs" role="tablist" aria-label={t('榜单类型')}>
            {boards.map(item => <button type="button" key={item.id} role="tab" aria-selected={activeBoard.id === item.id} className={activeBoard.id === item.id ? 'is-on' : ''} onClick={() => selectBoard(item.id)}><b>{t(item.label)}</b><small>{t(item.note)}</small></button>)}
          </div>
        </div>
        <div className="md-ranking-filters">
          <label><span>{t('榜单日期')}</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        </div>
      </section>
      {error ? <section className="md-tile md-ranking-error"><Icon name="alert" size={16} /><span>{error}</span><button type="button" className="md-inline-link" onClick={load}>{t('重试')}</button></section> : null}
      {!error && loading && !result ? <section className="md-tile md-ranking-loading"><span className="md-shimmer">{t('正在读取 RedFox 榜单…')}</span></section> : null}
      {!error && result && !result.rows.length ? <section className="md-tile md-ranking-loading"><span>{t('这个日期没有榜单数据')}</span></section> : null}
      {rows.length ? <section className="md-tile md-ranking-list">
        <header><div><h2>{t(activeBoard.label)}</h2><p>{result.date} · {t(result.category === 'all' ? '全部' : result.category)} · {t('展示 {n} 条', { n: result.rows.length })}</p></div><span className="md-ranking-source">RedFox</span></header>
        <div className="md-ranking-rows">{visibleRows.map(row => <RankingRow key={rowKey(row)} row={row} onCollect={collectRow} collecting={collectingKeys.has(rowKey(row))} collected={isCollected(row)} />)}</div>
        {visibleCount < rows.length ? <button type="button" className="md-btn md-ranking-more" onClick={() => setVisibleCount(count => Math.min(count + ROW_PAGE_SIZE, rows.length))}>{t('加载更多')}</button> : null}
      </section> : null}
    </div>
  )
}
