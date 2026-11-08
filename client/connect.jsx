// 导入账号：使用用户在设置中填写的 RedFox API Key。
import React from 'react'
import { importAccount, redfoxStatus, setDesk, toast, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { Dialog, Icon } from './ui.jsx'

function detect(text) {
  const value = String(text ?? '')
  if (/xiaohongshu\.com|xhslink\.com/i.test(value)) return '小红书'
  if (/douyin\.com/i.test(value)) return '抖音'
  if (/bilibili\.com|b23\.tv/i.test(value)) return 'B站'
  if (/tiktok\.com/i.test(value)) return 'TikTok'
  if (/instagram\.com/i.test(value)) return 'Instagram'
  if (/(?:^|[/.])(?:x|twitter)\.com/i.test(value)) return 'X'
  return null
}

function SetupGuide({ status, checking, onCheck }) {
  return (
    <div className="md-setup">
      <p className="md-setup-lead">{t('账号公开数据通过 RedFox 读取。请先到设置里填写 RedFox API Key，再回来导入。')}</p>
      {status?.state === 'nokey' ? <p className="md-setup-note">{t('还没有配置 RedFox API Key。')}</p> : null}
      {status?.state === 'error' ? <p className="md-setup-note is-error">{status.message}</p> : null}
      <div className="md-form-foot">
        <button type="button" className="md-btn" onClick={() => setDesk({ settingsOpen: true })}>{t('打开设置')}</button>
        <button type="button" className="md-btn is-primary md-setup-check" onClick={onCheck} disabled={checking}>{checking ? <span className="md-shimmer">{t('正在检查…')}</span> : t('检查 API Key')}</button>
      </div>
    </div>
  )
}

function AccountForm({ onClose }) {
  const accounts = useDesk(s => s.state.accounts)
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const found = detect(text)
  const saved = accounts.filter(row => row.externalId && row.url)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    const ok = await importAccount({ text })
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <form className="md-form" onSubmit={submit}>
      <label className="md-field">
        <span>{t('你的账号主页链接')}</span>
        <textarea rows={3} required value={text} onChange={e => setText(e.target.value)} placeholder={t('小红书、抖音、B 站、TikTok、Instagram 或 X 的主页链接，App 分享出来的文字也可以')} />
        <small>{t('请只抓自己的账号。会读取最近 20 条公开内容和互动数据，放进内容和复盘，并提炼成你的风格。')}</small>
      </label>
      {saved.length ? (
        <div className="md-saved-accounts">
          {saved.map(row => <button type="button" key={row.id} className="md-pill is-small" onClick={() => setText(row.url)}><Icon name="refresh" size={12} />{t(row.platform)} · {row.handle}</button>)}
        </div>
      ) : null}
      <p className="md-setup-foot">{t('链接会发给 RedFox。只能读取公开内容，实际可用字段和费用以 RedFox 服务为准。')}</p>
      <div className="md-form-foot">
        <span className="md-redfox-status">{t('RedFox 已连接')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
        <button type="submit" className="md-btn is-primary" disabled={busy}>
          {busy ? <span className="md-shimmer">{t('正在导入和提炼…')}</span> : found ? t('导入{platform}（RedFox）', { platform: t(found) }) : t('导入')}
        </button>
      </div>
    </form>
  )
}

export function ConnectDialog({ onClose }) {
  useLang()
  const [status, setStatus] = React.useState(null)
  const [checking, setChecking] = React.useState(true)
  const check = React.useCallback(async () => {
    setChecking(true)
    const next = await redfoxStatus()
    setStatus(next)
    setChecking(false)
    if (next.state === 'error') toast(next.message, { error: true })
  }, [])
  React.useEffect(() => {
    let alive = true
    redfoxStatus().then((next) => {
      if (!alive) return
      setStatus(next)
      setChecking(false)
    })
    return () => { alive = false }
  }, [])
  const ready = status?.state === 'ready'
  return (
    <Dialog title={ready ? t('导入我的账号') : t('连接 RedFox')} onClose={onClose} width={500}>
      {!status ? <p className="md-setup-lead md-shimmer">{t('正在检查 RedFox…')}</p> : null}
      {status && !ready ? <SetupGuide status={status} checking={checking} onCheck={check} /> : null}
      {ready ? <AccountForm onClose={onClose} /> : null}
    </Dialog>
  )
}
