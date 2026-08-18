// SYNQED Business shell. Authorization is requireBusinessAdmission() (it 404s
// on anything short of an admitted actor — hide, never show-and-refuse); this
// file only renders. Viewport is RENDERING, not authorization: the md: classes
// decide painting only (sidebar.tsx precedent: `hidden … md:flex`).
//
// PLAY-PHASE SEAL (⚖ Liam 2026-08-19): the live current-store chip is gone.
// resolveStoreScope() and listStores() both reach synqed-core, and territory
// must be incapable of that. Pilot safety in the play phase is telling the
// operator the data is not real, so the chip says 見本データ. The store-scope
// chip returns in the reconnect PR, with the data it describes.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { businessStrings as s } from '@/business/i18n'

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { email } = await requireBusinessAdmission()

  return (
    <div className="min-h-dvh bg-background">
      <p className="p-6 text-sm text-muted-foreground md:hidden">{s.desktopOnly}</p>
      <div className="hidden min-h-dvh flex-col md:flex">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <span className="text-sm font-medium">{s.title}</span>
          <div className="flex items-center gap-3 text-sm">
            {email && <span className="text-muted-foreground">{s.signedInAs} {email}</span>}
            <span className="rounded-full border border-border bg-card px-3 py-1 text-muted-foreground">
              {s.sampleData}
            </span>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  )
}
