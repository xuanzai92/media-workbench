// 首页：一句话记一个灵感。灵感可以散落在空间里，也可以按时间排成信息流。
import React from 'react'
import { Card, openCapture } from './card.jsx'
import { captureFiles, captureUrl, clearItemSelection, dispatchOps, getDesk, openItem, openItems, setDesk, toggleItemSelection, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Icon, IconButton, Segmented } from './ui.jsx'
import { MiniStamps } from './stamps.jsx'
import { cardSize, scatterLayout } from './layout.js'
import { relatedIdeas, relatedLayout } from './related.js'
import { SPRING_SOFT, computeStreak, displayItem, hash, posterOf, reducedMotion, isIdea } from './util.js'

function useCamera(stageRef, worldRef) {
  const cam = React.useRef({ x: 0, y: 0, s: 1, vx: 0, vy: 0, vs: 0, tx: 0, ty: 0, ts: 1, raf: 0 })
  const apply = React.useCallback(() => {
    const c = cam.current
    const world = worldRef.current
    const stage = stageRef.current
    if (!world || !stage) return
    world.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.s})`
    world.style.setProperty('--px', `${c.x / c.s}px`)
    world.style.setProperty('--py', `${c.y / c.s}px`)
    stage.style.setProperty('--grid-x', `${c.x}px`)
    stage.style.setProperty('--grid-y', `${c.y}px`)
    stage.style.setProperty('--grid-size', `${28 * c.s}px`)
  }, [stageRef, worldRef])
  const tick = React.useCallback(() => {
    const c = cam.current
    const k = c.stiffness ?? 90
    const d = c.damping ?? 17
    const dt = 1 / 60
    c.vx += (k * (c.tx - c.x) - d * c.vx) * dt
    c.vy += (k * (c.ty - c.y) - d * c.vy) * dt
    c.vs += (k * (c.ts - c.s) - d * c.vs) * dt
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.s += c.vs * dt
    apply()
    const idle = Math.abs(c.tx - c.x) < 0.2 && Math.abs(c.ty - c.y) < 0.2 && Math.abs(c.ts - c.s) < 0.0005 && Math.abs(c.vx) + Math.abs(c.vy) < 0.5
    if (idle) {
      Object.assign(c, { x: c.tx, y: c.ty, s: c.ts, vx: 0, vy: 0, vs: 0, raf: 0 })
      apply()
      return
    }
    c.raf = requestAnimationFrame(tick)
  }, [apply])
  const flyTo = React.useCallback((target, { instant = false, stiffness = 90, damping = 17 } = {}) => {
    const c = cam.current
    Object.assign(c, { tx: target.x, ty: target.y, ts: target.s, stiffness, damping })
    if (instant || reducedMotion()) {
      cancelAnimationFrame(c.raf)
      Object.assign(c, { x: c.tx, y: c.ty, s: c.ts, vx: 0, vy: 0, vs: 0, raf: 0 })
      apply()
      return
    }
    if (!c.raf) c.raf = requestAnimationFrame(tick)
  }, [apply, tick])
  const halt = React.useCallback(() => {
    const c = cam.current
    cancelAnimationFrame(c.raf)
    Object.assign(c, { raf: 0, vx: 0, vy: 0, vs: 0, tx: c.x, ty: c.y, ts: c.s })
  }, [])
  React.useEffect(() => () => cancelAnimationFrame(cam.current.raf), [])
  return { cam, flyTo, halt }
}

function Inline({ src }) {
  if (!src) return <span className="md-inline-pic is-empty" />
  return <img className="md-inline-pic" src={src} alt="" draggable={false} />
}

/** 首屏那句话：有图、有字、有数字，下面是一句话记灵感和最近的邮票。 */
function Hero() {
  const items = useDesk(s => s.state.items)
  const roots = items.filter(isIdea)
  const pending = roots.filter(i => i.status === 'idea' && !i.production)
  const week = new Date()
  week.setDate(week.getDate() + 7)
  const upcoming = items.filter(i => i.scheduledAt && i.status !== 'published' && new Date(i.scheduledAt) >= new Date() && new Date(i.scheduledAt) <= week)
  const streak = computeStreak(items)
  const pic = list => list.map(posterOf).find(Boolean)
  const related = useDesk(s => s.related)
  const [text, setText] = React.useState('')
  const submit = async (event) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    setText('')
    if (/^https?:\/\//i.test(value)) return captureUrl(value)
    // 记下的同时，把提到同一件事的旧灵感拉到眼前
    const ids = relatedIdeas(roots, value)
    setDesk({ related: ids.length ? { query: value, ids, newId: null } : null })
    await dispatchOps([{ op: 'add_item', kind: 'note', title: value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 60), body: value.length > 60 ? value : '' }], { label: t('记下灵感') })
  }
  const now = new Date()
  return (
    <section className="md-hero" onPointerDown={e => e.stopPropagation()}>
      <p className="md-hero-date">{now.getFullYear()} · {t('{m} 月 {d} 日', { m: now.getMonth() + 1, d: now.getDate(), mon: now.toLocaleString('en-US', { month: 'short' }) })} · {t(WEEKDAYS[now.getDay()])}</p>
      <h1 className="md-hero-line">
        {t('还有')} <Inline src={pic(pending)} /> <b>{t('{n} 个灵感', { n: pending.length, s: plural(pending.length, '', 's') })}</b> {t('等你成稿，')}
        <br />
        <Inline src={pic(upcoming)} /> <b>{t('{n} 条内容', { n: upcoming.length, s: plural(upcoming.length, '', 's') })}</b> {t('排在本周，')}
        <br />
        {t('你已经连续记录')} <b className="md-hero-streak">{t('{n} 天', { n: streak, s: plural(streak, '', 's') })}</b>{t('。')}
      </h1>
      <form className="md-hero-input" onSubmit={submit}>
        <Icon name="spark" size={16} />
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('记下一个灵感，或贴一个链接')} aria-label={t('记下灵感')} />
        <button type="submit" className="md-send" aria-label={t('记下')} disabled={!text.trim()}><Icon name="send" size={15} /></button>
      </form>
      {related ? (
        <p className="md-hero-related">
          <span>{t('找到 {n} 条相关的灵感，放在了旁边', { n: related.ids.length, s: plural(related.ids.length, '', 's') })}</span>
          <button type="button" className="md-inline-link" onClick={() => setDesk({ related: null })}>{t('放回去')}</button>
        </p>
      ) : null}
      {roots.length === 0 ? <p className="md-hero-hint">{t('写一句话、贴一个链接，或者把图片和视频拖进来。右上角的助手也能替你记。')}</p> : null}
      <MiniStamps />
    </section>
  )
}

function Node({ item, pos, index, entered, onOpen, tone, selected, drafted, draftFormat }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => {
    if (entered.current.has(item.id)) return
    entered.current.add(item.id)
    const el = ref.current?.firstElementChild
    if (!el || reducedMotion()) return
    const k = 0.25
    el.animate([
      { transform: `translate(${-pos.x * k}px, ${-pos.y * k}px) scale(.8) rotate(${(hash(item.id) % 20) - 10}deg)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ], { duration: SPRING_SOFT.duration + 200, easing: SPRING_SOFT.easing, delay: Math.min(index * 32, 620), fill: 'backwards' })
  }, [entered, index, item.id, pos.x, pos.y])
  const size = cardSize(item)
  return (
    <div ref={ref} className={`md-node${item._merged ? ' is-merged' : ''}${tone ? ` is-${tone}` : ''}${selected ? ' is-selected' : ''}`} data-node={item.id} style={{ left: pos.x, top: pos.y, width: size.w, '--r': `${pos.r ?? 0}deg`, '--d': pos.d ?? 0 }}>
      <div className="md-pop"><Card item={item} onOpen={onOpen} selected={selected} drafted={drafted} draftFormat={draftFormat} /></div>
    </div>
  )
}

/** 把合并成稿和来源灵感连起来。线条放在节点下面，点击节点仍由卡片处理。 */
function RelationLinks({ groups, byId, positionOf, activeIds, visibleIds }) {
  const lines = []
  for (const group of groups) {
    const draft = byId.get(group.draftId)
    const draftPos = draft ? positionOf(draft) : null
    if (!draftPos || !visibleIds.has(group.draftId)) continue
    for (const sourceId of group.sourceIds) {
      const source = byId.get(sourceId)
      const sourcePos = source ? positionOf(source) : null
      if (!sourcePos || !visibleIds.has(sourceId)) continue
      const midX = (sourcePos.x + draftPos.x) / 2
      const active = activeIds?.includes(group.draftId) && activeIds.includes(sourceId)
      lines.push(
        <path
          key={`${group.draftId}:${sourceId}`}
          className={active ? 'is-active' : undefined}
          d={`M ${sourcePos.x} ${sourcePos.y} C ${midX} ${sourcePos.y}, ${midX} ${draftPos.y}, ${draftPos.x} ${draftPos.y}`}
        />,
      )
    }
  }
  if (!lines.length) return null
  return <svg className="md-links" aria-hidden="true">{lines}</svg>
}

function mergedCanvasItem(draft, source) {
  const base = source ?? { id: draft.id, title: draft.title || t('合并成稿'), body: '', kind: 'note', status: 'draft', createdAt: draft.createdAt }
  const production = draft.production
  const format = production?.format ?? 'video'
  return {
    ...base,
    id: draft.id,
    title: production?.title || draft.title || t('合并成稿'),
    source: t('合并成稿'),
    status: 'draft',
    createdAt: draft.createdAt || base.createdAt,
    production,
    sourceIds: draft.sourceIds ?? [],
    ...(draft.pos ? { pos: draft.pos } : {}),
    _merged: true,
    // 让输出形式筛选对合并成稿也有意义；已完成的图文会由 displayItem 显示封面。
    kind: format === 'video' ? 'video' : format === 'image_text' ? 'image' : 'note',
  }
}

function originOf(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function Scatter() {
  const items = useDesk(s => s.state.items)
  const mergedDrafts = useDesk(s => s.state?.mergedDrafts ?? [])
  const stageRef = React.useRef(null)
  const worldRef = React.useRef(null)
  const { cam, flyTo, halt } = useCamera(stageRef, worldRef)
  const dragPos = React.useRef({})
  const [, force] = React.useReducer(v => v + 1, 0)
  const entered = React.useRef(new Set())
  const suppressClick = React.useRef(false)

  const kind = useDesk(s => s.kindFilter)
  const selectedIds = useDesk(s => s.selectedIds)
  const related = useDesk(s => s.related)
  const roots = React.useMemo(() => items.filter(isIdea), [items])
  const mergedNodes = React.useMemo(() => mergedDrafts
    .filter(draft => draft?.production?.status === 'running' || draft?.production?.status === 'done')
    // 防御旧数据里误用 item id 的情况：同一个 id 只保留原灵感节点。
    .filter(draft => !items.some(item => item.id === draft.id))
    .map(draft => mergedCanvasItem(draft, items.find(item => draft.sourceIds?.includes(item.id)))), [items, mergedDrafts])
  const allNodes = React.useMemo(() => [...roots, ...mergedNodes], [mergedNodes, roots])
  const draftedIds = React.useMemo(() => new Set([
    ...allNodes.filter(item => item.production?.status === 'done').map(item => item.id),
    ...mergedDrafts.filter(draft => draft.production?.status === 'done').flatMap(draft => draft.sourceIds ?? []),
  ]), [allNodes, mergedDrafts])
  const shown = React.useMemo(() => allNodes.filter(item => kind === 'pending'
    ? !draftedIds.has(item.id)
    : kind === 'all' || displayItem(item).kind === kind), [allNodes, draftedIds, kind])
  const allById = React.useMemo(() => new Map(allNodes.map(item => [item.id, item])), [allNodes])
  const visibleIds = React.useMemo(() => new Set(shown.map(item => item.id)), [shown])
  const linkGroups = React.useMemo(() => {
    const merged = mergedNodes
      .map(draft => ({ draftId: draft.id, sourceIds: [...new Set(draft.sourceIds ?? [])] }))
      .filter(group => group.sourceIds.length)
    // 单篇成稿仍复用原 item 节点；如果未来 sourceIds 包含额外来源，直接把这条
    // item 当作成稿端点连过去，避免为了连线再复制一张同 id 的卡片。
    const single = roots
      .filter(item => ['running', 'done'].includes(item.production?.status))
      .map(item => ({ draftId: item.id, sourceIds: [...new Set((item.production?.sourceIds ?? []).filter(id => id !== item.id))] }))
      .filter(group => group.sourceIds.length)
    return [...merged, ...single]
  }, [mergedNodes, roots])
  const draftedSourceIds = React.useMemo(() => new Set(linkGroups
    .filter(group => allById.get(group.draftId)?.production?.status === 'done')
    .flatMap(group => group.sourceIds)), [allById, linkGroups])
  const draftFormatBySource = React.useMemo(() => {
    const map = new Map()
    for (const group of linkGroups) {
      const draft = allById.get(group.draftId)
      if (draft?.production?.status !== 'done' || !draft.production.format) continue
      for (const sourceId of group.sourceIds) if (!map.has(sourceId)) map.set(sourceId, draft.production.format)
    }
    return map
  }, [allById, linkGroups])
  const [linkFocus, setLinkFocus] = React.useState(null)
  const rootKey = roots.map(i => `${i.id}:${i.pos ? `${i.pos.x},${i.pos.y}` : ''}:${i.production?.cover?.src ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = React.useMemo(() => scatterLayout(roots), [rootKey])

  const relatedSpots = React.useMemo(() => {
    if (!related) return {}
    const byId = new Map(roots.map(i => [i.id, i]))
    return relatedLayout(related.ids.filter(id => byId.has(id)).map(id => ({ id, ...cardSize(byId.get(id)) })))
  }, [related, roots])

  // 来源节点的位置逻辑独立出来，合并成稿的位置可以围绕它们计算，避免相互依赖。
  const sourcePosOf = React.useCallback((item) => {
    if (!item) return { x: 0, y: 0, r: 0, d: 0 }
    if (dragPos.current[item.id]) return dragPos.current[item.id]
    if (related) {
      // 相关的围在中间那句话四周，刚记下的那条放在正上方，不被底部工具条挡住
      if (item.id === related.newId) return { x: 0, y: -200 - cardSize(item).h / 2, r: 0, d: 0 }
      const spot = relatedSpots[item.id]
      if (spot) return { ...spot, r: 0, d: 0 }
    }
    if (item.pos) return { d: 0, ...item.pos }
    return layout[item.id] ?? { x: 0, y: 0, r: 0, d: 0 }
  }, [layout, related, relatedSpots])

  const mergeSpots = React.useMemo(() => {
    const spots = {}
    for (const [index, draft] of mergedNodes.entries()) {
      if (draft.pos) {
        spots[draft.id] = { d: 0, ...draft.pos }
        continue
      }
      const points = draft.sourceIds.map(id => {
        const source = allById.get(id)
        return source ? sourcePosOf(source) : null
      }).filter(Boolean)
      const center = points.length
        ? points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
        : { x: 320, y: 0 }
      // 把成稿放在来源右侧，留出一段线条和卡片间距。
      // 多次合并同一组来源时，按稳定顺序错开，避免成稿卡片互相遮住。
      const offsetY = (index % 5 - 2) * 180
      spots[draft.id] = { x: center.x + 300, y: center.y + offsetY, r: 0, d: 0 }
    }
    return spots
  }, [allById, mergedNodes, sourcePosOf])

  const posOf = React.useCallback((item) => mergeSpots[item?.id] ?? sourcePosOf(item), [mergeSpots, sourcePosOf])

  const linkIdsFor = React.useCallback((id) => {
    const ids = new Set([id])
    let changed = true
    // 共享来源的多个合并稿也属于同一组，递归合并直到稳定。
    while (changed) {
      changed = false
      for (const group of linkGroups) {
        if (!group.sourceIds.some(sourceId => ids.has(sourceId)) && !ids.has(group.draftId)) continue
        if (!ids.has(group.draftId)) { ids.add(group.draftId); changed = true }
        for (const sourceId of group.sourceIds) {
          if (!ids.has(sourceId)) { ids.add(sourceId); changed = true }
        }
      }
    }
    return [...ids]
  }, [linkGroups])

  // 拉出相关卡片后，镜头缩放到能把它们和中间那句话一起装下
  React.useEffect(() => {
    if (!related) return
    const byId = new Map(roots.map(i => [i.id, i]))
    let half = { x: 300, y: 240 }
    for (const [id, p] of Object.entries(relatedSpots)) {
      const size = cardSize(byId.get(id))
      half = { x: Math.max(half.x, Math.abs(p.x) + size.w / 2), y: Math.max(half.y, Math.abs(p.y) + size.h / 2) }
    }
    const fresh = related.newId && byId.get(related.newId)
    if (fresh) half.y = Math.max(half.y, 200 + cardSize(fresh).h)
    const home = frameHome()
    const { w, h } = stageBox()
    flyTo({ ...home, s: Math.min(home.s, (w - 80) / (half.x * 2), (h - 150) / (half.y * 2)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedSpots, related?.newId])

  const toneOf = (item) => {
    if (linkFocus) return linkFocus.includes(item.id) ? 'related' : 'dim'
    if (!related) return null
    if (item.id === related.newId || related.ids.includes(item.id)) return 'related'
    return 'dim'
  }

  const stageBox = React.useCallback(() => {
    const el = stageRef.current
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1000, h: 700 }
  }, [])

  const frameHome = React.useCallback(() => {
    const { w, h } = stageBox()
    return { x: w / 2, y: h / 2 + 8, s: w < 760 ? 0.66 : w < 1040 ? 0.8 : w < 1400 ? 0.92 : 1 }
  }, [stageBox])

  React.useLayoutEffect(() => {
    flyTo(frameHome(), { instant: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新记下的灵感可能落在屏幕外：相机带过去，让人看到它去了哪里
  const known = React.useRef(null)
  React.useEffect(() => {
    const previous = known.current
    known.current = new Set(roots.map(i => i.id))
    if (!previous) return
    const added = roots.find(i => !previous.has(i.id))
    if (!added) return
    if (related && !related.newId) {
      setDesk({ related: { ...related, newId: added.id } })
      return
    }
    const p = posOf(added)
    const size = cardSize(added)
    const { w, h } = stageBox()
    const c = cam.current
    const margin = 90
    const left = c.tx + c.ts * (p.x - size.w / 2)
    const right = c.tx + c.ts * (p.x + size.w / 2)
    const top = c.ty + c.ts * (p.y - size.h / 2)
    const bottom = c.ty + c.ts * (p.y + size.h / 2)
    const dx = left < margin ? margin - left : right > w - margin ? w - margin - right : 0
    const dy = top < margin ? margin - top : bottom > h - margin ? h - margin - bottom : 0
    if (dx || dy) flyTo({ x: c.tx + dx, y: c.ty + dy, s: c.ts })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots])

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    let last = el.clientWidth
    const observer = new ResizeObserver(() => {
      const delta = el.clientWidth - last
      last = el.clientWidth
      if (!delta) return
      const c = cam.current
      flyTo({ x: c.tx + delta / 2, y: c.ty, s: c.ts }, { stiffness: 140, damping: 24 })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [cam, flyTo])

  const openCard = React.useCallback((item, event) => {
    if (suppressClick.current) return
    if (event.metaKey || event.ctrlKey) {
      toggleItemSelection(item.id)
      return
    }
    const linked = linkIdsFor(item.id)
    setLinkFocus(linked.length > 1 ? linked : null)
    if (selectedIds.length) clearItemSelection()
    if (item._merged) {
      // 合并稿节点需要走合并工作区；来源节点始终进入自己的灵感详情。
      setDesk({ focusId: item.id, focusIds: [item.id], selectedIds: [], mergedId: item.id, outputFormat: null, sheetOrigin: originOf(event) })
    } else {
      openItem(item.id, originOf(event))
    }
  }, [allById, linkIdsFor, selectedIds.length])

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('input,textarea,button:not(.md-card),.md-toolrow,.md-ministamps')) return
    const cardEl = event.target.closest('[data-node]')
    const startX = event.clientX
    const startY = event.clientY
    const c = cam.current
    let moved = false
    suppressClick.current = false
    halt()
    if (cardEl) {
      const id = cardEl.dataset.node
      const dragItem = allById.get(id)
      if (!dragItem) return
      const origin = posOf(dragItem)
      const onMove = (e) => {
        const dx = (e.clientX - startX) / c.s
        const dy = (e.clientY - startY) / c.s
        if (!moved && Math.hypot(dx, dy) < 4) return
        if (!moved) {
          moved = true
          cardEl.classList.add('is-dragging')
          suppressClick.current = true
        }
        const next = { x: origin.x + dx, y: origin.y + dy, r: origin.r, d: 0 }
        dragPos.current[id] = next
        cardEl.style.left = `${next.x}px`
        cardEl.style.top = `${next.y}px`
      }
      const onUp = async () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        cardEl.classList.remove('is-dragging')
        if (!moved) return
        const next = dragPos.current[id]
        setTimeout(() => { suppressClick.current = false }, 0)
        // 成稿节点可能在拖拽期间因生成完成、删除或刷新而从状态中消失。
        // 旧的 pointerup 不应再把它当成真实对象提交位置更新。
        const state = getDesk().state
        const exists = state?.items?.some(item => item.id === id) || state?.mergedDrafts?.some(item => item.id === id)
        if (!next || !exists) {
          delete dragPos.current[id]
          return
        }
        await dispatchOps([{ op: 'update_item', id, pos: { x: Math.round(next.x), y: Math.round(next.y), r: next.r } }], { undoable: false, silent: true })
        delete dragPos.current[id]
        force()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }
    const baseX = c.x
    const baseY = c.y
    let lastX = startX
    let lastY = startY
    let lastT = performance.now()
    let vx = 0
    let vy = 0
    stageRef.current.classList.add('is-panning')
    const onMove = (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true
      const now = performance.now()
      const dt = Math.max(now - lastT, 1)
      vx = (e.clientX - lastX) / dt
      vy = (e.clientY - lastY) / dt
      lastX = e.clientX
      lastY = e.clientY
      lastT = now
      flyTo({ x: baseX + e.clientX - startX, y: baseY + e.clientY - startY, s: c.s }, { instant: true })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      stageRef.current?.classList.remove('is-panning')
      if (moved) flyTo({ x: c.x + vx * 180, y: c.y + vy * 180, s: c.s }, { stiffness: 42, damping: 13 })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const zoomAt = React.useCallback((factor, cx, cy, instant = true) => {
    const c = cam.current
    const s = Math.max(0.3, Math.min(2.2, c.ts * factor))
    const k = s / c.ts
    flyTo({ x: cx - (cx - c.tx) * k, y: cy - (cy - c.ty) * k, s }, { instant, stiffness: 160, damping: 24 })
  }, [cam, flyTo])

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top)
      } else {
        const c = cam.current
        flyTo({ x: c.tx - event.deltaX, y: c.ty - event.deltaY, s: c.ts }, { instant: true })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cam, flyTo, zoomAt])

  // 键盘 Tab 到屏幕外的卡片时，相机跟过去
  const onFocusIn = (event) => {
    const node = event.target.closest?.('[data-node]')
    if (!node || !event.target.matches(':focus-visible')) return
    const stageRect = stageRef.current.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    const c = cam.current
    const margin = 72
    let dx = 0
    let dy = 0
    if (rect.left < stageRect.left + margin) dx = stageRect.left + margin - rect.left
    else if (rect.right > stageRect.right - margin) dx = stageRect.right - margin - rect.right
    if (rect.top < stageRect.top + margin) dy = stageRect.top + margin - rect.top
    else if (rect.bottom > stageRect.bottom - margin) dy = stageRect.bottom - margin - rect.bottom
    if (dx || dy) flyTo({ x: c.tx + dx, y: c.ty + dy, s: c.ts })
  }

  const center = () => {
    const { w, h } = stageBox()
    return [w / 2, h / 2]
  }

  return (
    <div
      className="md-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onFocus={onFocusIn}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        if (related) setDesk({ related: null })
        if (linkFocus) setLinkFocus(null)
      }}
      onDragOver={e => e.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const files = [...(event.dataTransfer?.files ?? [])]
        if (files.length) captureFiles(files)
      }}
    >
      <div className="md-world" ref={worldRef}>
        <div className="md-hero-anchor"><Hero /></div>
        <RelationLinks groups={linkGroups} byId={allById} positionOf={posOf} activeIds={linkFocus} visibleIds={visibleIds} />
        {shown.map((item, index) => <Node key={item.id} item={item} pos={posOf(item)} index={index} entered={entered} onOpen={openCard} tone={toneOf(item)} selected={selectedIds.includes(item.id)} drafted={draftedSourceIds.has(item.id)} draftFormat={item._merged ? item.production?.format : draftFormatBySource.get(item.id)} />)}
      </div>
      <div className="md-toolrow md-toolrow-right" onPointerDown={e => e.stopPropagation()}>
        <IconButton icon="zoomOut" label={t('缩小')} onClick={() => zoomAt(0.8, ...center(), false)} />
        <IconButton icon="target" label={t('回到中心')} onClick={() => flyTo(frameHome())} />
        <IconButton icon="zoomIn" label={t('放大')} onClick={() => zoomAt(1.25, ...center(), false)} />
      </div>
    </div>
  )
}

/** 信息流：原来的瀑布流卡片，按时间从新到旧排。 */
function Feed() {
  const items = useDesk(s => s.state.items)
  const mergedDrafts = useDesk(s => s.state?.mergedDrafts ?? [])
  const kind = useDesk(s => s.kindFilter)
  const selectedIds = useDesk(s => s.selectedIds)
  const related = useDesk(s => s.related)
  const draftedSourceIds = React.useMemo(() => new Set(mergedDrafts
    .filter(draft => draft.production?.status === 'done')
    .flatMap(draft => draft.sourceIds ?? [])), [mergedDrafts])
  const draftedIds = React.useMemo(() => new Set([
    ...items.filter(item => item.production?.status === 'done').map(item => item.id),
    ...draftedSourceIds,
  ]), [draftedSourceIds, items])
  const draftFormatBySource = React.useMemo(() => {
    const map = new Map()
    for (const draft of mergedDrafts) {
      if (draft.production?.status !== 'done' || !draft.production.format) continue
      for (const sourceId of draft.sourceIds ?? []) if (!map.has(sourceId)) map.set(sourceId, draft.production.format)
    }
    return map
  }, [mergedDrafts])
  const rank = id => (related ? related.ids.indexOf(id) : -1)
  const sorted = React.useMemo(() => items
    .filter(item => isIdea(item) && (kind === 'pending'
      ? !draftedIds.has(item.id)
      : kind === 'all' || displayItem(item).kind === kind))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    // 有相关的灵感时排在最前面，按相关程度
    .sort((a, b) => {
      const ra = rank(a.id)
      const rb = rank(b.id)
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [draftedIds, items, kind, related])
  return (
    <div className="md-wall-scroll">
      <div className="md-feed-hero"><Hero /></div>
      <div className="md-wall">
        {sorted.map((item, index) => (
          <div key={item.id} className={`md-wall-cell${rank(item.id) >= 0 ? ' is-related' : ''}`} style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}>
            <Card item={item} selected={selectedIds.includes(item.id)} drafted={draftedSourceIds.has(item.id)} draftFormat={draftFormatBySource.get(item.id)} onOpen={(row, event) => {
              if (event.metaKey || event.ctrlKey) {
                toggleItemSelection(row.id)
                return
              }
              if (selectedIds.length) clearItemSelection()
              openItem(row.id, originOf(event))
            }} />
          </div>
        ))}
      </div>
    </div>
  )
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const KIND_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'pending', label: '待成稿' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'web', label: '网页' }, { value: 'quote', label: '金句' }, { value: 'note', label: '笔记' }]

function SelectionBar() {
  const selectedIds = useDesk(s => s.selectedIds)
  if (!selectedIds.length) return null
  return (
    <div className="md-selectionbar" role="toolbar" aria-label={t('批量选择')}>
      <span className="md-selectionbar-count">{t('已选 {n} 条灵感', { n: selectedIds.length })}</span>
      <button type="button" className="md-btn is-small" onClick={() => clearItemSelection()}>{t('取消选择')}</button>
      <button type="button" className="md-btn is-small is-primary" onClick={() => openItems(selectedIds)}>{t('进入详情')}</button>
    </div>
  )
}

export function HomeView() {
  const mode = useDesk(s => s.mode)
  const kind = useDesk(s => s.kindFilter)
  return (
    <div className="md-home">
      {mode === 'feed' ? <Feed /> : <Scatter />}
      <SelectionBar />
      <div className="md-dockbar" role="toolbar" aria-label={t('灵感视图')}>
        <Segmented
          label={t('展示方式')}
          value={mode}
          onChange={value => setDesk({ mode: value })}
          options={[{ value: 'scatter', icon: 'scatter', title: t('散落') }, { value: 'feed', icon: 'wall', title: t('信息流') }]}
        />
        <span className="md-dockbar-sep" />
        <div className="md-chips">
          {KIND_OPTIONS.map(option => (
            <button type="button" key={option.value} className={kind === option.value ? 'is-on' : ''} onClick={() => setDesk({ kindFilter: option.value })}>{t(option.label)}</button>
          ))}
        </div>
        <span className="md-dockbar-sep" />
        <button type="button" className="md-round is-primary" aria-label={t('记下灵感')} title={t('记下灵感')} onClick={() => openCapture('text')}><Icon name="plus" size={18} /></button>
      </div>
    </div>
  )
}
