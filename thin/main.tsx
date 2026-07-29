import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import messages from '../messages/ja.json'
import '../src/app/globals.css'
import './fonts.css'
import { AppRoot } from '@/lib/app-root/AppRoot'
import { hideNativeSplash } from '@/lib/app-root/splash'
import { ThinShell } from './shell'
import { ThinRouter } from './router'
import { ThinChromeContent, ThinChromeNav } from './chrome/Chrome'
import { ContentErrorBoundary } from './ContentErrorBoundary'
import { AuthGate } from './AuthGate'
import { bootMobileAuth } from './auth/session'
import { bindForegroundRevalidate } from './data/foreground-revalidate'
// Perf packet 34: side-effect-only import wires the background screen-DTO
// prefetch singleton at boot (same idiom as chrome-store.ts, loaded the same
// way via the Chrome.tsx import below) — its module-scope subscribeSessionState
// arms on the sign-in settle with no explicit init call needed.
import './data/screen-prefetch'
import { getThinEnv } from './env'
import { viteDataPort } from './ports/data.vite'
import { viteRecordingPort } from './ports/recording.vite'
import { stripLocalePrefix } from './ports/nav.vite'
import { setRecordingPipelinePort } from '@/lib/ports/recording-port'
import { setDataPort } from '@/lib/ports/data-port'
import { mark, reportMarks, MARKS } from './probe/marks'

// Recording pipeline runs the facade upload + /api/app/v1/ai legs in the shell
// (packet 08 Decision 2). Set before render so any capture started on first
// paint uses the thin upload path, never the web supabase-js flow.
setRecordingPipelinePort(viteRecordingPort)

// Same seam, data plane: getDataPort() is a module singleton — the React
// provider below does NOT reach non-hook callers (ScreenBoundary, ai-pipeline).
// Without this line every screen DTO fetch resolves same-origin against the
// bundle itself: capacitor://localhost serves index.html, res.json() → null,
// and the screen dead-ends on a zod root error (packet-09 F-5 cause 2).
setDataPort(viteDataPort)

// Thin shell entry. Mounts the router SYNCHRONOUSLY inside the platform-
// neutral AppRoot (theme/toaster/locale/data/error/safe-area) — first paint is
// NOT gated on auth or data (packet 01's boot gate owns auth; converted screens
// fetch via the DataPort on mount). The probe marks are wall-clock real.

// Env gate BEFORE render (Fable review round 1, critical 3): a module-scope
// throw would kill the app before React mounts — no ErrorBoundary, no splash
// release, white screen until the +8s failsafe. Validate here instead; on
// failure render a visible error screen AND release the splash. Loud, but UI.
function renderFatal(message: string): void {
  document.getElementById('root')!.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;font-family:-apple-system,BlinkMacSystemFont,\'Noto Sans JP\',sans-serif;' +
    'background:#fff;color:#0f172a"><div style="max-width:360px;text-align:center">' +
    '<h1 style="font-size:18px;font-weight:600;margin:0 0 12px">設定エラー</h1>' +
    '<p style="font-size:13px;line-height:1.7;color:#64748b;margin:0;word-break:break-all">' +
    message +
    '</p></div></div>'
  requestAnimationFrame(() => requestAnimationFrame(hideNativeSplash))
}

function main(): void {
  try {
    getThinEnv() // throws with the full missing-var list; no fallback defaults
  } catch (e) {
    renderFatal(e instanceof Error ? e.message : String(e))
    return
  }

  // After the env gate (auth config comes from the same validated env), before
  // render: never blocks first paint — the AuthGate renders 'recovering' until
  // the boot gate settles (≤4s; instant for a locally persisted session).
  bootMobileAuth()

  // Perf packet 29: quiet re-fetch of the mounted screen on every app
  // foreground (visibilitychange) — see thin/data/foreground-revalidate.ts.
  bindForegroundRevalidate()

  // Root-scroller shell: the document scrolls now, which would activate
  // WebKit's AUTOMATIC scroll restoration on history traversal (header back
  // arrow, native edge swipe) for the first time — racing screens that fetch
  // on mount (router.tsx renders per-pathname, no keep-alive). Keep today's
  // behavior instead: nothing restores, positions just persist in the live
  // DOM. We own scroll, the browser doesn't.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

  // Locale-prefixed boot pathname / deep link (B3, packet 12 fix batch round
  // 3): toHref's write-side strip (nav.vite.tsx) covers every push/Link, but
  // a cold boot or external deep link lands on location.pathname directly —
  // ThinRouter has no /ja/* or /en/* entries, so an unstripped prefix here
  // fell through to the customer list with no way back.
  const strippedPathname = stripLocalePrefix(location.pathname)
  if (strippedPathname !== location.pathname) {
    // hash preserved (Greptile #572): anchor deep links must survive the strip.
    history.replaceState({}, '', strippedPathname + location.search + location.hash)
  }

  // The shell's HOME is the customer list. Normalize the WebView entry URL
  // ('/', or the literal '/index.html' capacitor serves) BEFORE first render:
  // the router already fell through to CustomersScreen here, but the chrome
  // reads the pathname — at '/' the header titled the screen ダッシュボード
  // and no bottom tab showed active (found on the sim, parity P-A).
  if (location.pathname === '/' || location.pathname === '/index.html') {
    history.replaceState({}, '', '/customers')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRoot dataPort={viteDataPort} locale="ja" messages={messages}>
        <ThinShell nav={<ThinChromeNav />}>
          <AuthGate>
            <ThinChromeContent>
              <ContentErrorBoundary>
                <ThinRouter />
              </ContentErrorBoundary>
            </ThinChromeContent>
          </AuthGate>
        </ThinShell>
      </AppRoot>
    </StrictMode>,
  )

  // First painted frame: mark it (wall-clock real, usually still UNDER the
  // native splash). The splash release moved into the AuthGate — releasing
  // here, on the unconditional first paint, flashed the boot gate's
  // 読み込み中 frame between splash and content on every cold start. The
  // renderFatal path above and the ErrorBoundary keep their own releases.
  requestAnimationFrame(() => {
    mark(MARKS.firstPixel)
    // Interactive lands after mount effects flush — one task later.
    setTimeout(() => {
      mark(MARKS.interactive)
      reportMarks()
    }, 0)
  })
}

main()
