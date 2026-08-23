// Reading the barcode off a packet, on an iPhone.
//
// WHY THERE IS NO BarcodeDetector HERE
//
// The browser has a barcode API. Safari does not implement it, and on iOS every browser is
// Safari underneath — Chrome and Firefox on an iPhone are WebKit with a different icon — so
// on the only phones this family owns, BarcodeDetector does not exist and never will until
// WebKit ships it. The decoding is therefore done in WebAssembly, by zxing-wasm, which is
// about 450 kB gzipped and loaded the first time someone taps Scan rather than at startup.
//
// THREE WAYS IN, BECAUSE THE FIRST ONE CAN FAIL
//
//   1. Live camera. Best by far: a scan loop sees tens of frames a second, and one of them
//      will be sharp enough even when several are not. Needs getUserMedia, which needs
//      HTTPS and a user gesture, and which iOS has historically been fussy about inside a
//      home-screen web app.
//   2. A photograph. <input type="file" capture="environment"> opens the camera through the
//      file picker, which is a different and much older path that works where getUserMedia
//      does not. One frame only, so a blurry photo is a failed scan rather than a retry.
//   3. Typing the digits. Needs nothing at all and is the reason this feature cannot be
//      completely broken by a browser update.
//
// Which of the three a given phone can manage is not something that could be determined
// from a development machine with no iPhone on it, so support() reports what it finds and
// the app shows the user the answer.

/* --------------------------------------------------------- what works --- */

/** What this browser can actually do, as facts rather than as a user-agent guess. */
export function support() {
  const secure = typeof window !== 'undefined' && (window.isSecureContext || location.protocol === 'https:')
  const camera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
  // Every browser has a file input; capture="environment" is a hint the phone may ignore,
  // and there is no way to feature-detect whether it honours it.
  const capture = typeof document !== 'undefined' && 'capture' in document.createElement('input')
  return {
    secure, camera, wasm, capture,
    live: secure && camera && wasm,
    photo: wasm,
    // Standalone matters because that is where iOS used to refuse the camera outright, and
    // it is worth telling the user which mode they are in when the camera will not open.
    standalone: typeof window !== 'undefined' &&
      (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true)
  }
}

/* ----------------------------------------------------------- decoding --- */

const FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E']
let decoder = null

/**
 * Load the WebAssembly decoder, once.
 *
 * The .wasm is imported as a URL so Vite emits it as an asset on our own origin: no CDN, no
 * third-party request, and the service worker can cache it like anything else. Without this
 * zxing-wasm goes looking for it on a CDN, which would break the app offline and leak a
 * request besides.
 */
export async function loadDecoder() {
  if (decoder) return decoder
  const [{ prepareZXingModule, readBarcodes }, wasmUrl] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url').then(m => m.default)
  ])
  await prepareZXingModule({ overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } })
  decoder = readBarcodes
  return decoder
}

const first = results => {
  for (const r of results || []) {
    const text = String(r.text || '').trim()
    if (/^\d{8}$|^\d{12,14}$/.test(text)) return text
  }
  return null
}

/** Decode one frame. Returns the digits, or null — never throws at the caller. */
export async function decodeImageData(imageData) {
  try {
    const read = await loadDecoder()
    return first(await read(imageData, { tryHarder: true, formats: FORMATS, maxNumberOfSymbols: 1 }))
  } catch (e) { return null }
}

/** Decode a photograph the user took, for the fallback path. */
export async function decodeBlob(blob) {
  try {
    const read = await loadDecoder()
    return first(await read(blob, { tryHarder: true, formats: FORMATS, maxNumberOfSymbols: 1 }))
  } catch (e) { return null }
}

/* ------------------------------------------------------------- camera --- */

/**
 * Open the back camera into a <video>.
 *
 * The three attributes matter more than they look. Without `playsinline` iOS takes the
 * video fullscreen and the sheet around it disappears; without `muted` autoplay is refused;
 * and play() has to happen inside the tap that opened the sheet or Safari blocks it.
 */
export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
  })
  video.setAttribute('playsinline', '')
  video.setAttribute('autoplay', '')
  video.setAttribute('muted', '')
  video.muted = true
  video.srcObject = stream
  await video.play()
  return stream
}

export function closeCamera(stream) {
  try { (stream ? stream.getTracks() : []).forEach(t => t.stop()) } catch (e) { /* already gone */ }
}

/**
 * Read frames until something decodes.
 *
 * Only the middle band of the frame is looked at. A barcode held up to a phone fills the
 * width and very little of the height, so the rest is furniture: cropping it out is both
 * faster and less likely to pick up a barcode on some other packet in shot. Eight frames a
 * second is plenty for a hand holding a jar and leaves the phone cool.
 */
export function scanLoop(video, onHit, { fps = 8 } = {}) {
  let stopped = false
  let timer = null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const tick = async () => {
    if (stopped) return
    const w = video.videoWidth, h = video.videoHeight
    if (w && h) {
      const bandH = Math.max(80, Math.round(h * 0.45))
      const y0 = Math.round((h - bandH) / 2)
      canvas.width = w
      canvas.height = bandH
      ctx.drawImage(video, 0, y0, w, bandH, 0, 0, w, bandH)
      const code = await decodeImageData(ctx.getImageData(0, 0, w, bandH))
      if (stopped) return
      if (code) { onHit(code); return }
    }
    timer = setTimeout(tick, 1000 / fps)
  }
  tick()

  return () => { stopped = true; clearTimeout(timer) }
}
