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
import { AuthGate } from './AuthGate'
import { bootMobileAuth } from './auth/session'
import { getThinEnv } from './env'
import { viteDataPort } from './ports/data.vite'
import { viteRecordingPort } from './ports/recording.vite'
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

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRoot dataPort={viteDataPort} locale="ja" messages={messages}>
        <ThinShell nav={<ThinChromeNav />}>
          <AuthGate>
            <ThinChromeContent>
              <ThinRouter />
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
