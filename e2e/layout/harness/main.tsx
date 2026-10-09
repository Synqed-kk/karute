// Bottom-bar hit-test harness: the REAL bottom-nav.tsx and the REAL global
// stylesheet (Tailwind), mounted the way the thin shell mounts it
// (thin/shell.tsx: document scrolls, bar in a fixed z-40 wrapper). Navigation,
// next-intl, the recorder and the inbox are swapped for the stand-ins in
// ./mocks by build-harness.ts; the URL's query string picks the state.
import { createRoot } from 'react-dom/client'
import '../../../src/app/globals.css'
import { BottomNav } from '@/components/layout/bottom-nav'

function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-bg)]">
      <main data-page className="relative flex-1" />
      <div className="fixed inset-x-0 bottom-0 z-40">
        <BottomNav locale="ja" />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
