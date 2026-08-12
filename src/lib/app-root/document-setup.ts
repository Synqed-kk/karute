// Document-level attributes the web app's layout.tsx hardcodes on <html> and in
// its Viewport export. The thin target renders into #root (no Next <html>), so
// AppRoot re-applies them here to keep parity. Pure function over a Document so
// it is testable in jsdom.
//
// Keep LANG / DATA_THEME in sync with layout.tsx — the AppRoot parity test reads
// layout.tsx and asserts these literals still match.

export const LANG = 'ja'
export const DATA_THEME = 'karute'
/** `viewport-fit=cover` is what activates env(safe-area-inset-*) in a bare WKWebView. */
export const VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover'

// lang defaults to LANG (web-layout parity, source-parity test below) but
// follows the caller's rendered locale when given one — AppRoot (thin-only;
// the sole caller) passes its own `locale` prop so a screen reader applies
// English pronunciation to an English-selected app instead of always Japanese
// (2026-08-11 packet §3 fix, blind-round finding).
export function applyDocumentSetup(doc: Document, lang: string = LANG): void {
  const html = doc.documentElement
  html.lang = lang
  html.dataset.theme = DATA_THEME
  html.classList.add('font-sans', 'antialiased')

  let meta = doc.querySelector('meta[name="viewport"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute('name', 'viewport')
    doc.head.appendChild(meta)
  }
  meta.setAttribute('content', VIEWPORT)
}
