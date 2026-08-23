// Scanning a packet.
//
// The sheet has one job beyond reading the digits: making sure nobody logs a stranger's
// typing as a fact. Open Food Facts is volunteers transcribing labels, so what comes back
// is shown for confirmation against the packet — which is in your hand, because you just
// scanned it — and only then saved, as one of your own foods. See lib/openfoodfacts.js.

import { useState, useEffect, useRef } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtNum } from './lib/format.js'
import { api } from './lib/api.js'
import { Button } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { cleanPer100, NUTRIENTS, NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import { newPortion } from './lib/portions.js'
import {
  support, openCamera, closeCamera, scanLoop, decodeBlob, loadDecoder
} from './lib/barcode.js'
import {
  isValidBarcode, normaliseBarcode, parseProduct, knownBarcode, foodFromProduct, completeness
} from './lib/openfoodfacts.js'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/** Ask our own server, which asks Open Food Facts and remembers the answer. */
async function lookup(code) {
  try {
    const r = await api('/api/food/barcode?code=' + encodeURIComponent(code))
    return { product: parseProduct(r) }
  } catch (e) {
    if (e.status === 404) return { missing: true }
    if (e.status === 501) return { off: true }
    return { error: e.message || String(e) }
  }
}

/* ========================= confirming what came back ========================= */

function Confirm({ found, close, onSaved }) {
  const [n, setN] = useState(found.n)
  const [v, setV] = useState(() => {
    const o = {}
    for (const k of NUTRIENTS) o[k] = found.per100[k] ?? ''
    return o
  })
  const set = (k, val) => setV(o => ({ ...o, [k]: val }))

  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    const per100 = cleanPer100(v)
    if (!per100) { toast(t('Nutrient values must be zero or more.')); return }
    if (per100.kcal == null && per100.carb == null) { toast(t('Fill in at least calories or carbs')); return }
    const food = { ...foodFromProduct(found, per100), n: name }
    update(s => {
      s.myFoods = [...(s.myFoods || []).filter(f => f.id !== food.id), food]
      // A serving size printed on the packet becomes a portion, but only now — after
      // someone has agreed the numbers on this screen are the ones on the box.
      if (found.serving) {
        const p = newPortion({ fid: food.id, n: 'portion', g: found.serving })
        if (p) s.portions = [...(s.portions || []).filter(x => !(x.fid === food.id && x.n === 'portion')), p]
      }
    })
    close()
    toast(t('“{0}” saved', name))
    if (onSaved) onSaved(food)
  }

  return <>
    <h3>{t('Check it against the packet')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('These values were typed in by someone else, off a packet that may not be the one in your hand. Compare them with the nutrition table now — it is right there — and correct anything that differs. After this they are your numbers.')}
    </div>

    <input className="input" value={n} onChange={e => setN(e.target.value)} />
    <div className="dim small" style={{ margin: '8px 0 12px' }}>
      {found.code}
      {found.updated && ' · ' + t('entry last changed {0}', found.updated)}
      {found.missing.length > 0 && ' · ' + t('{0} of 8 values filled in', completeness(found))}
    </div>

    <h4 className="sec">{t('Per 100 g')}</h4>
    {NUTRIENTS.map(k => <div key={k} className="row between" style={{ gap: 12, padding: '7px 0' }}>
      <span className="small grow">
        {t(NUTRIENT_NAME[k])}
        {found.missing.includes(k) && <span className="dim"> · {t('not in the entry')}</span>}
        {k === 'kcal' && found.fromKj && <span className="dim"> · {t('converted from kJ')}</span>}
      </span>
      <input className="input" inputMode="decimal" style={{ width: 110, textAlign: 'right', flex: 'none' }}
        placeholder={NUTRIENT_UNIT[k]} value={v[k]} onChange={e => set(k, e.target.value)} />
    </div>)}

    {found.serving && <div className="dim small" style={{ marginTop: 10 }}>
      {t('The packet states a serving of {0} g — saved as a portion you can pick.', found.serving)}
    </div>}

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('These are right — save it')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    <div className="dim small" style={{ marginTop: 14, lineHeight: 1.45 }}>
      {t('Product data: Open Food Facts, Open Database License.')}
    </div>
  </>
}

/* ============================== the scanner ============================== */

function Scanner({ onFood, close }) {
  const S = useStore(s => s.S)
  const cap = support()
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const streamRef = useRef(null)
  const stopRef = useRef(null)
  const [phase, setPhase] = useState(cap.live ? 'starting' : 'manual')
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState('')

  // One place for "we have digits, now what", so the camera, the photo and the typed code
  // all end up in the same three outcomes.
  const handle = async code => {
    const c = normaliseBarcode(code)
    setPhase('looking')
    const known = knownBarcode(S, c)
    if (known) { close(); toast(t('{0} — already yours', known.n)); onFood(known); return }
    const r = await lookup(c)
    if (r.product) { close(); ui().openSheet(cl => <Confirm found={r.product} close={cl} onSaved={onFood} />); return }
    close()
    if (r.missing) toast(t('Not in Open Food Facts — add it as your own food'))
    else if (r.off) toast(t('Barcode lookup is switched off on this server'))
    else toast(t('Lookup failed: {0}', r.error || '?'))
    // Whatever went wrong, the manual path is open and the barcode is still known, so the
    // next scan of this packet will find it.
    ui().openSheet(cl => <Confirm close={cl} onSaved={onFood} found={{
      code: c, n: '', per100: {}, missing: [...NUTRIENTS], serving: null, updated: null, fromKj: false
    }} />)
  }

  useEffect(() => {
    if (!cap.live) return
    let dead = false
    ;(async () => {
      try {
        // Warm the decoder while the camera is opening, so the first frames are not wasted.
        loadDecoder().catch(() => {})
        const stream = await openCamera(videoRef.current)
        if (dead) { closeCamera(stream); return }
        streamRef.current = stream
        setPhase('scanning')
        stopRef.current = scanLoop(videoRef.current, code => { stopRef.current?.(); handle(code) })
      } catch (e) {
        if (dead) return
        setErr(e.name === 'NotAllowedError' ? t('The camera was not allowed. You can still take a photo or type the digits.')
          : e.name === 'NotFoundError' ? t('No camera found on this device.')
          : t('The camera could not be opened: {0}', e.message || e.name))
        setPhase('manual')
      }
    })()
    return () => { dead = true; stopRef.current?.(); closeCamera(streamRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const photo = async e => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    setPhase('looking')
    const code = await decodeBlob(f)
    if (code) return handle(code)
    setErr(t('No barcode found in that photo. Fill the frame with the barcode and hold steady.'))
    setPhase('manual')
  }

  const manual = () => {
    const c = typed.trim()
    if (!isValidBarcode(c)) { toast(t('That is not a complete barcode — check the digits.')); return }
    handle(c)
  }

  return <>
    <h3>{t('Scan a barcode')}</h3>

    {phase === 'looking' && <div className="muted small" style={{ padding: '20px 0', textAlign: 'center' }}>
      {t('Looking it up…')}
    </div>}

    {(phase === 'starting' || phase === 'scanning') && <>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* The band the scan loop actually reads, so people aim at it. */}
        <div style={{
          position: 'absolute', left: '6%', right: '6%', top: '27.5%', height: '45%',
          border: '2px solid var(--acc)', borderRadius: 8, pointerEvents: 'none'
        }} />
      </div>
      <div className="dim small" style={{ textAlign: 'center', margin: '10px 0' }}>
        {phase === 'starting' ? t('Starting the camera…') : t('Hold the barcode inside the frame.')}
      </div>
    </>}

    {err && <div className="card" style={{ margin: '4px 0 12px' }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" /><div className="small" style={{ lineHeight: 1.45 }}>{err}</div>
      </div>
    </div>}

    {phase !== 'looking' && <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={photo} />
      <Button icon="camera" onClick={() => fileRef.current.click()}>{t('Take a photo instead')}</Button>
      <div style={{ height: 12 }} />
      <h4 className="sec">{t('Or type the digits under the barcode')}</h4>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" inputMode="numeric" placeholder="7310865004703"
          value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, ''))} />
        <Button className="inline" variant="primary" onClick={manual} disabled={!typed}>{t('Look up')}</Button>
      </div>
    </>}

    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const scanSheet = onFood => ui().openSheet(close => <Scanner onFood={onFood} close={close} />)

/* ========================= does this phone manage it? ========================= */

// Built because none of this could be tried on an iPhone from where it was written: the
// decoder was proved against generated barcodes on a desktop, and the camera path was
// reasoned about from what WebKit documents. This turns that gap into something the person
// holding the phone can settle in ten seconds.
function Diagnostics({ close }) {
  const cap = support()
  const [wasm, setWasm] = useState('?')
  const [cam, setCam] = useState('?')

  useEffect(() => {
    loadDecoder().then(() => setWasm('ok')).catch(e => setWasm(e.message || 'fel'))
  }, [])

  const tryCamera = async () => {
    setCam('…')
    let stream
    try {
      const v = document.createElement('video')
      stream = await openCamera(v)
      const track = stream.getVideoTracks()[0]
      const s = track ? track.getSettings() : {}
      setCam(`ok · ${s.width || '?'}×${s.height || '?'} · ${s.facingMode || t('unknown camera')}`)
    } catch (e) { setCam((e.name || 'fel') + ': ' + (e.message || '')) }
    finally { closeCamera(stream) }
  }

  const Row = ({ label, value, good }) => <div className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--sep)' }}>
    <span className="small grow">{label}</span>
    <span className="small" style={{ color: good ? 'var(--acc)' : 'var(--label-2)', textAlign: 'right' }}>{value}</span>
  </div>

  return <>
    <h3>{t('Can this phone scan?')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('Barcode scanning was built without an iPhone to try it on. This says what your phone actually supports.')}
    </div>
    <Row label={t('HTTPS')} value={cap.secure ? t('yes') : t('no — the camera needs it')} good={cap.secure} />
    <Row label={t('Camera API')} value={cap.camera ? t('present') : t('missing')} good={cap.camera} />
    <Row label={t('WebAssembly')} value={cap.wasm ? t('present') : t('missing')} good={cap.wasm} />
    <Row label={t('Decoder loads')} value={wasm === 'ok' ? t('yes') : wasm === '?' ? '…' : wasm} good={wasm === 'ok'} />
    <Row label={t('Added to home screen')} value={cap.standalone ? t('yes') : t('no, running in the browser')} good />
    <Row label={t('Camera opens')} value={cam} good={String(cam).startsWith('ok')} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="camera" onClick={tryCamera}>{t('Test the camera')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); scanSheet(() => {}) }}>{t('Try a real scan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const barcodeDiagnostics = () => ui().openSheet(close => <Diagnostics close={close} />)
