// RedFox 社媒榜单：只在用户主动打开/切换筛选时读取，避免无意中消耗榜单接口额度。
import React from 'react'
import { fetchRedfoxRankings, setDesk, useDesk } from './desk.js'
import { compact } from './util.js'
import { t, useLang } from './i18n.js'
import { Icon } from './ui.jsx'

const PLATFORMS = [
  { id: 'xiaohongshu', label: '小红书', note: '爆款笔记' },
  { id: 'douyin', label: '抖音', note: '热门作品' },
  { id: 'x', label: 'X', note: '热门账号' },
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
  x: [{ id: 'x_hot_accounts', label: 'X 热门账号榜优质库', note: '热门账号与行业标签', period: 'day' }],
}
const XHS_CATEGORIES = ['综合全部', '数码科技', '美味佳肴', '旅行度假', '时尚穿搭', '化妆美容', '居家装修', '学习教育', '职业发展', '新闻资讯', '体育锻炼']
const DOUYIN_CATEGORIES = ['全部', '小剧场', '财富理财', '二次元', '身体锻炼', '居家装修', '数码科技', '科学普及', '旅行', '美食', '动物', '明星娱乐', '汽车', '亲子', '人文', '三农', '潮流风尚', '游戏', '生活记录', '体育', '舞蹈才艺', '学习教育', '休闲玩乐', '影视', '音乐', '颜值造型', '健康医学', '综艺', '个人成长']
const X_CATEGORIES = ['综合全部', '科技软件', '商业创业', '金融投资', '政治新闻', '娱乐明星', '体育赛事', '游戏电竞', '教育培训', '健康医疗', '生活方式', '旅游出行', '美食餐饮', '时尚美妆', '艺术文化', '科学研究', '其他']
const X_GENDERS = [{ id: 'all', label: '全部性别' }, { id: 'male', label: '男性账号' }, { id: 'female', label: '女性账号' }]

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

function RankingRow({ row, platform }) {
  const xhs = platform === 'xiaohongshu'
  const x = platform === 'x'
  return (
    <article className="md-ranking-row">
      <span className={`md-ranking-rank is-${row.rank <= 3 ? row.rank : 'normal'}`}>{row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}</span>
      <span className="md-ranking-avatar">{row.avatar ? <img src={row.avatar} alt="" loading="lazy" /> : <Icon name="user" size={16} />}</span>
      <div className="md-ranking-main">
        <div className="md-ranking-title">
          {row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : <strong>{row.name}</strong>}
          {row.category ? <span>{row.category}</span> : null}
        </div>
        {row.title ? <p>{row.title}</p> : null}
      </div>
      <div className="md-ranking-stats">
        {x ? <><Stat label={t('粉丝')} value={row.stats?.followers} /><Stat label={t('优质分')} value={row.stats?.score} /><Stat label={t('增幅')} value={row.stats?.growth} /><Stat label={t('地区/网络')} value={row.stats?.networks} /></>
          : <><Stat label={t('点赞')} value={row.stats?.likes} /><Stat label={t('评论')} value={row.stats?.comments} /><Stat label={t('收藏')} value={row.stats?.saves} /><Stat label={t('分享')} value={row.stats?.shares} /></>}
      </div>
    </article>
  )
}

export function RankingsView() {
  useLang()
  const hasKey = useDesk(s => Boolean(s.settings?.redfox?.hasKey))
  const [platform, setPlatform] = React.useState('xiaohongshu')
  const [ranking, setRanking] = React.useState(BOARD_DEFS.xiaohongshu[0].id)
  const [category, setCategory] = React.useState('综合全部')
  const [gender, setGender] = React.useState('all')
  const [date, setDate] = React.useState(yesterday)
  const [result, setResult] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)
  const boards = BOARD_DEFS[platform] ?? BOARD_DEFS.xiaohongshu
  const activeBoard = boards.find(item => item.id === ranking) ?? boards[0]
  const categories = platform === 'xiaohongshu' ? XHS_CATEGORIES : platform === 'douyin' ? DOUYIN_CATEGORIES : X_CATEGORIES

  const load = React.useCallback(async () => {
    if (!hasKey || !activeBoard) return
    setLoading(true)
    setError(null)
    try {
      const next = await fetchRedfoxRankings({ platform, ranking: activeBoard.id, period: activeBoard.period, date, category, gender })
      setResult(next)
    } catch (err) {
      setResult(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeBoard, category, date, gender, hasKey, platform])

  React.useEffect(() => { load() }, [load])

  const selectPlatform = next => {
    const nextBoard = BOARD_DEFS[next]?.[0]
    setPlatform(next)
    setRanking(nextBoard?.id ?? '')
    setCategory(next === 'douyin' ? '全部' : '综合全部')
    setGender('all')
    setResult(null)
  }
  const selectBoard = next => { setRanking(next); setResult(null) }

  if (!hasKey) {
    return <div className="md-board-page"><section className="md-tile md-ranking-empty"><div><Icon name="chart" size={28} /><h1>{t('社媒榜单')}</h1><p>{t('从 RedFox 读取小红书、抖音和 X 的公开榜单，帮助你找到值得跟进的账号和选题。')}</p><button type="button" className="md-btn is-primary" onClick={() => setDesk({ settingsOpen: true })}>{t('去设置 RedFox')}</button></div></section></div>
  }

  return (
    <div className="md-board-page md-rankings-page">
      <header className="md-page-head">
        <div><h1>{t('社媒榜单')}</h1><p className="md-page-sub">{t('来自 RedFox 的公开榜单 · 数据按榜单日期更新')}</p></div>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-btn" onClick={() => load()} disabled={loading}><Icon name="refresh" size={13} />{loading ? t('读取中…') : t('刷新榜单')}</button>
      </header>
      <section className="md-ranking-controls">
        <div className="md-ranking-platforms" role="tablist" aria-label={t('榜单平台')}>
          {PLATFORMS.map(item => <button type="button" key={item.id} role="tab" aria-selected={platform === item.id} className={platform === item.id ? 'is-on' : ''} onClick={() => selectPlatform(item.id)}><b>{t(item.label)}</b><small>{t(item.note)}</small></button>)}
        </div>
        <div className="md-ranking-board-tabs" role="tablist" aria-label={t('榜单类型')}>
          {boards.map(item => <button type="button" key={item.id} role="tab" aria-selected={activeBoard.id === item.id} className={activeBoard.id === item.id ? 'is-on' : ''} onClick={() => selectBoard(item.id)}><b>{t(item.label)}</b><small>{t(item.note)}</small></button>)}
        </div>
        <div className="md-ranking-filters">
          <label><span>{t('赛道')}</span><select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item} value={item}>{t(item)}</option>)}</select></label>
          {platform === 'x' ? <label><span>{t('性别')}</span><select value={gender} onChange={event => setGender(event.target.value)}>{X_GENDERS.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label> : null}
          <label><span>{t('榜单日期')}</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        </div>
      </section>
      {error ? <section className="md-tile md-ranking-error"><Icon name="alert" size={16} /><span>{error}</span><button type="button" className="md-inline-link" onClick={load}>{t('重试')}</button></section> : null}
      {!error && loading && !result ? <section className="md-tile md-ranking-loading"><span className="md-shimmer">{t('正在读取 RedFox 榜单…')}</span></section> : null}
      {!error && result && !result.rows.length ? <section className="md-tile md-ranking-loading"><span>{t('这个日期没有榜单数据')}</span></section> : null}
      {result?.rows.length ? <section className="md-tile md-ranking-list">
        <header><div><h2>{t(activeBoard.label)}</h2><p>{result.date} · {t(result.category === 'all' ? '全部' : result.category)} · {t('展示 {n} 条', { n: result.rows.length })}</p></div><span className="md-ranking-source">RedFox</span></header>
        <div className="md-ranking-rows">{result.rows.map(row => <RankingRow key={`${platform}:${row.rank}:${row.url || row.name}`} row={row} platform={platform} />)}</div>
      </section> : null}
    </div>
  )
}
