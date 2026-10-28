import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtDate } from './lib/format.js'
import { Button } from './components/ui.jsx'
import { readActivityFiles } from './lib/import-files.js'
import { planImport, importedWorkout } from './lib/import-activities.js'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = (...a) => useStore.getState().update(...a)

const KIND = { walk: 'Walk', hike: 'Hike', run: 'Run (outdoor)', bike: 'Cycling (outdoor)', swim: 'Swimming', other: 'Other activity' }

/** Read the chosen files, then show what an import would add. */
export async function importActivities(files) {
  if (!files.length) return
  toast(t('Reading the file…'))
  let read
  try { read = await readActivityFiles(files) }
  catch (e) { toast(e.message === 'zip64' ? t('That zip file is too large or uses an unsupported format.') : t('Could not read that file')); return }
  if (!read.activities.length) { toast(read.errors.length ? t("That file's columns aren't recognised — see the docs for supported apps.") : t('No activities found in that file')); return }
  const plan = planImport(useStore.getState().S, read.activities)
  ui().openSheet(close => <Summary read={read} plan={plan} close={close} />)
}

function Summary({ read, plan, close }) {
  const { fresh, dup } = plan
  const kinds = {}
  for (const a of fresh) kinds[a.kind] = (kinds[a.kind] || 0) + 1
  const starts = fresh.map(a => a.start).sort((a, b) => a - b)
  const day = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

  const run = () => {
    const batch = Date.now()
    const made = fresh.map(a => importedWorkout(a, batch, t)).filter(Boolean)
    update(s => { s.workouts = [...s.workouts, ...made].sort((a, b) => (a.start || 0) - (b.start || 0)) })
    close()
    toast(t('{0} activities imported', made.length))
  }
  const tile = (label, value) => <div className="tile"><div className="l">{label}</div><div className="v" style={{ fontSize: '1.1rem' }}>{value}</div></div>

  return <>
    <h3>{t('Import activities')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {read.sources.join(' · ')}{starts.length > 0 && ' · ' + fmtDate(day(starts[0]), true) + ' – ' + fmtDate(day(starts[starts.length - 1]), true)}
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      {tile(t('New'), fresh.length)}
      {dup.length > 0 && tile(t('Already here'), dup.length)}
      {read.skipped > 0 && tile(t('Could not read'), read.skipped)}
    </div>
    {fresh.length > 0 && <div className="mchips" style={{ margin: '12px 0' }}>
      {Object.entries(kinds).map(([k, n]) => <span key={k} className="mchip">{t(KIND[k])} · {n}</span>)}
    </div>}
    {dup.length > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('Activities that overlap a session you already logged are left out.')}
    </div>}
    {read.assumed.includes('km') && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('Distances in a Garmin CSV are read as kilometres.')}
    </div>}
    <Button variant="primary" onClick={run} disabled={!fresh.length}>
      {fresh.length ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** The batch (a timestamp) of the most recent activity import, or null. */
export const lastActivityImport = S => (S.workouts || []).reduce((m, w) => (w.imp > m ? w.imp : m), 0) || null

export function undoActivityImport() {
  const batch = lastActivityImport(useStore.getState().S)
  if (!batch) return
  let n = 0
  update(s => { const keep = s.workouts.filter(w => w.imp !== batch); n = s.workouts.length - keep.length; s.workouts = keep })
  toast(t('Removed {0} activities', n))
}
