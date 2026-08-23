// SYNQED Business shell. Authorization is requireBusinessAdmission() (it 404s
// on anything short of an admitted actor — hide, never show-and-refuse); this
// file only renders.
//
// ⚖ ALL-SCREEN ADAPTIVITY (Liam 2026-08-23, TRANSPLANT-GATE-LESSONS §B): the
// day-one `md:hidden` 「パソコンからご利用ください」 notice and its
// `hidden md:block` wrapper are GONE. Below 768 the shell used to paint a
// blank dead end; now `.app` renders at every width and business-shell.css
// decides the layout — ladder-proven rooms adapt, the rest pan.
//
// TRANSPLANT BATCH 1 (⚖ Liam 8/19): the interim header from #723 is replaced by
// the canon shell lifted out of fable-store-customers.html — same sidebar, same
// topbar, same wording. Its stylesheet is imported HERE, so Next scopes it to
// this route segment and no phone route ever loads it.
//
// PLAY-PHASE SEAL (⚖ Liam 2026-08-19): every value the shell shows comes from
// src/business/lib/data.ts reading fixtures. resolveStoreScope() and
// listStores() both reach synqed-core, and territory must be incapable of that.
// The honesty chip (◈ サンプルデータ) is the pilot-safety surface, and it is
// canon's own — not an interim addition.

import { Suspense } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { listStoreOptions, readShellIdentity, readUnresolvedCounts } from '@/business/lib/data'
import { BusinessSessionEdits } from './BusinessSessionEdits'
import { BusinessSidebar } from './BusinessSidebar'
import { BusinessTopbar, BusinessTopbarActionSlot } from './BusinessTopbar'
import { ShiftsSessionEdits } from './ShiftsSessionEdits'
import './business-shell.css'

const fmtTime = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tokyo',
})

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, storeOptions, shell, unresolved] = await Promise.all([
    params,
    listStoreOptions(),
    readShellIdentity(),
    readUnresolvedCounts(),
  ])

  // Formatted on the server so the client renders one string and no clock or
  // timezone can drift between the two passes.
  const syncLabel = `Reserve同期サンプル ${fmtTime.format(new Date(shell.reserveSyncedAt))}`

  return (
    <div className="biz sidebar-open">
      <div className="app">
        {/* useSearchParams needs a boundary; the shell renders without the
            store lens for the one frame before it resolves. */}
        <Suspense fallback={<aside className="sidebar" aria-label="メインナビゲーション" />}>
          <BusinessSidebar
            locale={locale}
            businessName={shell.business.name}
            storeCount={shell.business.storeCount}
            operatorName={shell.operator.name}
            operatorMark={shell.operator.mark}
            operatorRole={shell.operator.role}
            stores={storeOptions}
            unresolved={unresolved}
          />
        </Suspense>
        {/* The topbar's primary action (canon: 予約を作成) is rendered by the
            shell but owned by the screen, so both sit under one slot. */}
        <BusinessTopbarActionSlot>
          <main className="main">
            <Suspense fallback={<header className="topbar" />}>
              <BusinessTopbar stores={storeOptions} syncLabel={syncLabel} />
            </Suspense>
            {/* ⚖ Liam 22: day navigation is a `?day=` LINK, so the screen
                remounts on every flip and the layout does not. The session's
                edits — the 仮置き chip, the cards it has been placed as, and
                the 仮押さえ standing over them — therefore live HERE. */}
            {/* スタッフ・シフト navigates the same way (`?view=`/`?week=`/
                `?ym=` are Links), so the shifts it has staged live above the
                screen for the same reason. */}
            <BusinessSessionEdits>
              <ShiftsSessionEdits>{children}</ShiftsSessionEdits>
            </BusinessSessionEdits>
          </main>
        </BusinessTopbarActionSlot>
      </div>
    </div>
  )
}
