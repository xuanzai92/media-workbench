import React from 'react'
import { useDesk } from './desk.js'
import { HotView } from './hot.jsx'
import { XbangdanView } from './xbangdan.jsx'
import { t, useLang } from './i18n.js'
import { Segmented } from './ui.jsx'

const SOURCES = [
  { value: 'aihot', label: 'AI Hot' },
  { value: 'x', label: 'X' },
]

/** 将 AIHOT 与 X 榜单放进同一个一级热点入口，二级只切换数据来源。 */
export function HotHubView() {
  useLang()
  const view = useDesk(state => state.view)
  const [source, setSource] = React.useState(view === 'xbangdan' ? 'x' : 'aihot')

  React.useEffect(() => {
    if (view === 'xbangdan') setSource('x')
  }, [view])

  return (
    <div className="md-hot-hub">
      <div className="md-hot-hub-tabs">
        <Segmented value={source} options={SOURCES.map(option => ({ ...option, label: t(option.label) }))} onChange={setSource} label={t('热点来源')} />
      </div>
      <div className="md-hot-hub-body">
        {source === 'x' ? <XbangdanView /> : <HotView />}
      </div>
    </div>
  )
}
