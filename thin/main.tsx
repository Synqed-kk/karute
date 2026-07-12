import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import messages from '../messages/ja.json'
import '../src/app/globals.css'
import './fonts.css'
import { AppRoot } from '@/lib/app-root/AppRoot'
import { releaseSplashOnFirstPaint } from '@/lib/app-root/splash'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import { viteDataPort } from './ports/data.vite'
import { profile, sessions, photos } from './probe/fixture'
import { mark, reportMarks, MARKS } from './probe/marks'

// Thin shell entry. Mounts a REAL screen SYNCHRONOUSLY inside the platform-
// neutral AppRoot (theme/toaster/locale/data/error/safe-area) — first paint is
// NOT gated on auth or data (packet 01's boot gate owns auth; the fixture stands
// in for facade data). The probe marks are wall-clock real.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot dataPort={viteDataPort} locale="ja" messages={messages}>
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
