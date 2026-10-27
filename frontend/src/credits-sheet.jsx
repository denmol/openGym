// Credits and licences. The wording of each credit line is fixed by the source's own terms
// (and stays in English on purpose); only the headings around them are translated.
// Keep in step with NOTICE.md.
import { t } from './lib/i18n.js'
import { useUI } from './store/useUI.js'
import { REPO } from './lib/demo.js'
import { Button } from './components/ui.jsx'

const NOTICES_URL = (import.meta.env.BASE_URL || '/') + 'third-party-notices.txt'

const CREDITS = [
  {
    head: 'Exercise images and animations',
    line: '© Gym visual — https://gymvisual.com/',
    links: [['gymvisual.com', 'https://gymvisual.com/']],
    note: 'Shown at reduced size by permission of Gym visual.'
  },
  {
    head: 'Exercise names and instructions',
    line: 'hasaneyldrm/exercises-dataset, MIT licence.',
    links: [['MIT', 'https://github.com/hasaneyldrm/exercises-dataset']],
    note: 'The Swedish, German and Portuguese instructions are translations of the English text.'
  },
  {
    head: 'Food composition data',
    line: 'Source: Livsmedelsverket (Swedish Food Agency), livsmedelsdatabasen, CC BY 4.0.',
    links: [['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'], ['livsmedelsverket.se', 'https://www.livsmedelsverket.se']],
    note: 'Values are carried through unchanged.'
  },
  {
    head: 'Barcode product data',
    line: 'Open Food Facts, Open Database License (ODbL).',
    links: [['openfoodfacts.org', 'https://world.openfoodfacts.org/'], ['ODbL', 'https://opendatacommons.org/licenses/odbl/']],
    note: 'Entered by volunteers from packets: check against the packet before you save.'
  },
  {
    head: 'Body map outlines',
    line: 'MuscleMap by Melih Colpan, MIT licence.',
    links: [['MuscleMap', 'https://github.com/melihcolpan/MuscleMap']]
  }
]

const A = ({ href, children }) => <a href={href} target="_blank" rel="noopener">{children}</a>

export function creditsSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Credits and licences')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('Pass is free software under the GNU Affero General Public License v3. The work of others is used under their own terms, listed here.')}
    </div>
    <div style={{ display: 'grid', gap: 14 }}>
      {CREDITS.map(c => <div key={c.head}>
        <div style={{ fontWeight: 600 }}>{t(c.head)}</div>
        <div className="small" style={{ lineHeight: 1.45 }}>{c.line}</div>
        {c.note && <div className="dim small" style={{ lineHeight: 1.45 }}>{t(c.note)}</div>}
        <div className="small" style={{ lineHeight: 1.6 }}>
          {c.links.map(([label, href], i) => <span key={href}>{i > 0 && ' · '}<A href={href}>{label}</A></span>)}
        </div>
      </div>)}
      <div>
        <div style={{ fontWeight: 600 }}>{t('Software libraries')}</div>
        <div className="dim small" style={{ lineHeight: 1.45 }}>{t('The licence notices of the libraries this app is built with.')}</div>
        <div className="small"><A href={NOTICES_URL}>{t('Open the notices')}</A></div>
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{t('Source code')}</div>
        <div className="small" style={{ lineHeight: 1.6 }}>
          <A href={REPO}>{t('source code')}</A> · <A href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL v3</A> · <A href="https://github.com/DuarteSantos8/openGym">{t('based on openGym')}</A>
        </div>
      </div>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>)
}
