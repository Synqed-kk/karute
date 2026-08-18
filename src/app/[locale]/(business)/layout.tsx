// SYNQED Business shell. Authorization is requireBusinessAdmission() (it 404s
// on anything short of an admitted actor — hide, never show-and-refuse); this
// file only renders. Viewport is RENDERING, not authorization: the md: classes
// decide painting only (sidebar.tsx precedent: `hidden … md:flex`).

import { resolveStoreScope } from '@/lib/auth/store-scope'
import { listStores } from '@/actions/stores'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { businessStrings as s } from '@/business/i18n'

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { email } = await requireBusinessAdmission()

  // Pilot safety: the operator always sees which account and which store they
  // act in. A FAILED scope read is 店舗未設定, never 全店舗 — an unknown lens
  // must not read as "all stores".
  const [scope, stores] = await Promise.all([
    resolveStoreScope().catch(() => null),
    listStores().catch(() => []),
  ])
  const named = stores.find((st) => st.id === scope?.storeId)?.name
  const storeLabel = !scope ? s.storeUnknown : scope.storeId ? (named ?? s.storeUnknown) : s.allStores

  return (
    <div className="min-h-dvh bg-background">
      <p className="p-6 text-sm text-muted-foreground md:hidden">{s.desktopOnly}</p>
      <div className="hidden min-h-dvh flex-col md:flex">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <span className="text-sm font-medium">{s.title}</span>
          <div className="flex items-center gap-3 text-sm">
            {email && <span className="text-muted-foreground">{s.signedInAs} {email}</span>}
            <span className="rounded-full border border-border bg-card px-3 py-1 text-foreground">
              {storeLabel}
            </span>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  )
}
