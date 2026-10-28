// Vercel Speed Insights: real load times (Core Web Vitals) from the devices that actually use
// the app. Anonymous and cookie-free; it reports timings and the page, never anything typed or
// stored in the app. It is only compiled in when the build asks for it (VITE_SPEED_INSIGHTS=1,
// set in vercel.json), so self-hosted, demo and mobile builds never load or contact anything.

export const SPEED_INSIGHTS = import.meta.env.VITE_SPEED_INSIGHTS === '1'

export function startSpeedInsights() {
  if (!SPEED_INSIGHTS || typeof document === 'undefined') return
  window.si = window.si || function () { (window.siq = window.siq || []).push(arguments) }
  const s = document.createElement('script')
  s.defer = true
  s.src = '/_vercel/speed-insights/script.js'
  document.head.appendChild(s)
}
