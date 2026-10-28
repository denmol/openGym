import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { api, passwordLogin, passwordSet, passwordRemove, webauthnOK } from './lib/api.js'
import { Button } from './components/ui.jsx'
import { MIN_PASSWORD, usernameOk } from './lib/password-rules.js'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const quiet = e => e && (e.name === 'NotAllowedError' || e.name === 'AbortError')

/** Sign in from the login screen. */
export const passwordLoginSheet = () => ui().openSheet(close => <LoginSheet close={close} />)
function LoginSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!name.trim() || !pw) { toast(t('Enter your username and password')); return }
    setBusy(true)
    try {
      const u = await passwordLogin(name.trim(), pw)
      setUser(u); close(); await pullState(); toast(t('Welcome back, {0}', u.name))
    } catch (e) {
      setBusy(false)
      toast(e.status === 429 ? t('Too many attempts — try again in 15 minutes, or sign in with your passkey.') : e.status === 401 ? t('Wrong username or password') : (e.message || t('Sign-in failed')))
    }
  }
  return <>
    <h3>{t('Sign in with a password')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Use the username and password you set in Settings on a device where you are already signed in.')}</div>
    <input className="input" placeholder={t('Username')} autoCapitalize="none" autoCorrect="off" autoComplete="username" value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('Password')} autoComplete="current-password" value={pw}
      onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={go}>{t('Sign in')}</Button>
  </>
}

/** Choose or change the username and password of the signed-in account. */
export const passwordSetupSheet = () => ui().openSheet(close => <SetupSheet close={close} />)
function SetupSheet({ close }) {
  const { user, setUser } = useStore()
  const [name, setName] = useState(user?.username || '')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const n = name.trim().toLowerCase()
    if (!usernameOk(n)) { toast(t('Username: 3–30 letters, digits, dot, dash or underscore')); return }
    if (pw.length < MIN_PASSWORD) { toast(t('The password needs at least {0} characters', MIN_PASSWORD)); return }
    if (pw !== again) { toast(t('The two passwords differ')); return }
    setBusy(true)
    try {
      const saved = await passwordSet(n, pw)
      setUser({ ...user, username: saved }); close(); toast(t('Password saved'))
    } catch (e) {
      setBusy(false)
      if (!quiet(e)) toast(e.status === 409 ? t('That username is taken') : (e.message || t('Could not save the password')))
    }
  }
  return <>
    <h3>{user?.username ? t('Change password') : t('Sign in with a password')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Lets you sign in on other devices with a username and password. You confirm with your passkey first. If you forget it, sign in with your passkey and set a new one, or ask the admin.')}
    </div>
    <input className="input" placeholder={t('Username')} autoCapitalize="none" autoCorrect="off" autoComplete="username" value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('New password')} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('Repeat the password')} autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('At least {0} characters.', MIN_PASSWORD)}</div>
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy || !webauthnOK()} onClick={go}>{t('Save password')}</Button>
    {!webauthnOK() && <div className="dim small" style={{ marginTop: 8 }}>{t('Passkeys not supported in this browser.')}</div>}
  </>
}

export async function removePassword() {
  const { user, setUser } = useStore.getState()
  try { await passwordRemove(); setUser({ ...user, username: null }); toast(t('Password removed')) }
  catch (e) { if (!quiet(e)) toast(e.message || t('Could not remove the password')) }
}
