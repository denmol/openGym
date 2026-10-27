import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { tabBarFolded, moreActive, moreItemsFor } from '../lib/chrome.js'
import { useUI } from '../store/useUI.js'
import { Row, Section } from './ui.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const [folded, setFolded] = useState(false)
  // Fold to icons while scrolling down through content; open on the first scroll up.
  useEffect(() => {
    let last = window.scrollY, raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY
        // React runs the updater later, so the previous position has to be captured now —
        // reading `last` inside it would see the position already overwritten below.
        const prev = last
        last = y
        setFolded(f => tabBarFolded(f, y, prev))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [])
  // a new screen starts at the top, so it starts open
  useEffect(() => { setFolded(false) }, [loc.pathname])
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k
  const openMore = () => useUI.getState().openSheet(close => <>
    <h3>{t('Menu')}</h3>
    <Section>
      {moreItemsFor(!!user?.admin).map(([k, icon, label]) =>
        <Row key={k} icon={icon} title={t(label)} accessory="chevron" onClick={() => { close(); nav('/' + k) }} />)}
    </Section>
    <div style={{ height: 8 }} />
  </>)

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar" className={folded ? 'min' : ''}>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="food" icon="forkKnife" to="/food" label={t('Food')} />
      <button className={moreActive(cur) ? 'on' : ''} onClick={openMore}>
        <Icon name="more" /><span>{t('Menu')}</span>
      </button>
    </nav>
  )
}
