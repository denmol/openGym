import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">admin</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red-t)' }}>disabled</span>}
      {u.invitedBy && <span className="tag">invite {u.invitedBy}</span>}
      <span className="tag">joined {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? 'Enable account' : 'Disable account'}</button>}
    <h4 className="sec">Workout history</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">No workouts logged.</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast('Code ' + invite.code + ' created & copied'); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Generate</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} unused · {used.length} redeemed</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast('Copied ' + i.code) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red-t)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">No codes yet — generate one to invite someone.</div>}
  </div>
}

const FEATURE_NAME = { trainer: 'Trainer check-in', nutrition: 'Nutrition highlights', plan: 'Program writer' }
const pct = r => Math.round(r * 100) + '%'

// How often the models' answers pass their checks (api/quality.js). Counts only: what the outcome
// was and which kind of rule an answer broke, never the answer, the question or who asked.
function QualityCard({ data }) {
  const features = data ? Object.entries(data.features) : []
  return <div className="card">
    <h2 style={{ margin: 0 }}>AI answers</h2>
    <div className="small muted" style={{ margin: '6px 0 8px' }}>Last {data ? data.days : 30} days. Every answer is checked against the person's own numbers before it is shown.</div>
    {!data && <div className="dim small">Loading…</div>}
    {data && !features.length && <div className="dim small">Nothing recorded yet — it fills as the trainer and the other AI features are used.</div>}
    {features.map(([name, t]) => <div key={name} style={{ padding: '8px 2px', borderTop: '1px solid var(--sep)' }}>
      <div className="row between"><span className="small" style={{ fontWeight: 600 }}>{FEATURE_NAME[name] || name}</span><span className="dim small">{t.calls} calls</span></div>
      {t.rates
        ? <div className="small" style={{ marginTop: 3 }}>
          {pct(t.rates.ok1)} accepted first try · {pct(t.rates.ok2)} after a repair · <span style={{ color: t.rates.rejected > 0.2 ? 'var(--orange-t)' : undefined }}>{pct(t.rates.rejected)} rejected</span>
        </div>
        : <div className="dim small" style={{ marginTop: 3 }}>No answers to judge yet.</div>}
      <div className="dim small" style={{ marginTop: 2 }}>{t.error} provider {t.error === 1 ? 'error' : 'errors'} · {t.local} kept local · {t.scope} outside the log's scope</div>
      {Object.keys(t.problems).length > 0 && <div className="dim small" style={{ marginTop: 4 }}>
        Most common reason an answer was refused: {Object.entries(t.problems).slice(0, 3).map(([k, n]) => k + ' (' + n + ')').join(', ')}
      </div>}
      {t.rates && t.rates.rejected > 0.2 && t.rejected >= 5 && <div className="small" style={{ marginTop: 4, color: 'var(--orange-t)' }}>
        More than one in five answers failed its checks twice. The wording the model is given probably needs work.
      </div>}
    </div>)}
  </div>
}

// Everyone's data as a file. The copy in the store is for accidents; the file is for you to keep
// somewhere else. Passkeys, secrets and invitation codes are never in it.
function BackupCard({ users, status, toast }) {
  const [busy, setBusy] = useState(null)
  const download = async (key, path, fallback) => {
    setBusy(key)
    try {
      const r = await fetch(path)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
      const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || fallback
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    } catch (e) { toast(e.message || 'Download failed') } finally { setBusy(null) }
  }
  const last = status && status.last
  const when = last ? new Date(last.at).toLocaleString() : null
  return <div className="card" style={{ marginBottom: 14 }}>
    <h4 className="sec" style={{ marginTop: 0 }}>Backup</h4>
    <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
      Everyone's data as one file. It holds plans, workouts, food and weight, and who the users are, but no passkeys,
      secrets or invitation codes. After a total loss people register again with an invitation and import their own file.
    </div>
    <div className="small" style={{ marginBottom: 10 }}>
      {last
        ? <>Automatic copy in the store: <b>{when}</b> ({last.users} {last.users === 1 ? 'user' : 'users'}), kept {status.keepDays} days.</>
        : status
          ? <span style={{ color: 'var(--orange-t)' }}>No automatic copy yet.{status.cron || status.auto ? ' The first one is made within a day.' : ' Set CRON_SECRET to turn on the daily copy (see docs/VERCEL.md).'}</span>
          : <span className="dim">Loading…</span>}
    </div>
    <Button variant="primary" icon="download" disabled={busy !== null} onClick={() => download('all', '/api/admin/backup', 'pass-all.json')}>
      {busy === 'all' ? 'Preparing…' : 'Download everything'}
    </Button>
    {(users || []).length > 0 && <div style={{ marginTop: 10 }}>
      {users.map(u => <div key={u.id} className="row between" style={{ padding: '6px 2px', borderTop: '1px solid var(--sep)' }}>
        <span className="small">{u.name}</span>
        <Button size="sm" disabled={busy !== null}
          onClick={() => download(u.id, '/api/admin/backup?user=' + encodeURIComponent(u.id), 'pass-backup.json')}>
          {busy === u.id ? 'Preparing…' : 'Download'}
        </Button>
      </div>)}
    </div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [qualityData, setQualityData] = useState(null)
  const [backupStatus, setBackupStatus] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadQuality = () => api('/api/admin/quality').then(setQualityData).catch(() => {})
  const loadBackup = () => api('/api/admin/backup/status').then(setBackupStatus).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadQuality(); loadBackup(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label="refresh">↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Users</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">Active 7d</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">Disabled</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green-t)' }} />Training now</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} />
    <QualityCard data={qualityData} />
    <BackupCard users={users} status={backupStatus} toast={toast} />

    <h4 className="sec">Users</h4>
    <div className="list">
      {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green-t)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>admin</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red-t)' }}>off</span>}</div>
          <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · synced ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-t)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">No users yet.</div>}
    </div>
  </div>
}
