import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import messages from '../messages/ja.json'
import '../src/app/globals.css'
import './fonts.css'
import { AppRoot } from '@/lib/app-root/AppRoot'
import { hideNativeSplash, releaseSplashOnFirstPaint } from '@/lib/app-root/splash'
import { ThinShell } from './shell'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import { getThinEnv } from './env'
import { viteDataPort } from './ports/data.vite'
import { profile, sessions, photos } from './probe/fixture'
import { mark, reportMarks, MARKS } from './probe/marks'

// Thin shell entry. Mounts a REAL screen SYNCHRONOUSLY inside the platform-
// neutral AppRoot (theme/toaster/locale/data/error/safe-area) — first paint is
// NOT gated on auth or data (packet 01's boot gate owns auth; the fixture stands
// in for facade data). The probe marks are wall-clock real.

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

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRoot dataPort={viteDataPort} locale="ja" messages={messages}>
        <ThinShell>
          <CustomerProfileView
            customer={profile}
            sessions={sessions}
            photos={photos}
            customerMemory={undefined}
            packs={[]}
            lifecycle={null}
            hasNextBooking={false}
            ticketsEnabled={true}
            consentGranted={true}
            consentGrantedAtLabel="2026年4月1日"
          />
        </ThinShell>
      </AppRoot>
    </StrictMode>,
  )

  // First painted frame: mark + release the native splash on the same frame the
  // pixels land (the #444 handshake, ported as new code here).
  requestAnimationFrame(() => {
    mark(MARKS.firstPixel)
    releaseSplashOnFirstPaint()
    // Interactive lands after mount effects flush — one task later.
    setTimeout(() => {
      mark(MARKS.interactive)
      reportMarks()
    }, 0)
  })
}

main()
