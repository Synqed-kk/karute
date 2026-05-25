'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, ChevronLeft } from 'lucide-react'

// Record-page header — TWO variants stacked, gated by viewport:
//
//   • Mobile (md:hidden)  Sticky top chrome matching the spike's
//                         MobileHeader: back button left, centered
//                         「録音」 title, bell right (notifications stub).
//                         Bleeds out of the parent's p-4 padding via
//                         `-mx-4 ... px-4` so it spans full width.
//
//   • Desktop (hidden md:block)  Big page heading + subtitle. The
//                         desktop sidebar already provides a 「録音」
//                         nav entry + back affordance, so we keep the
//                         existing 2xl/3xl typography there.
//
// Spike source: src/components/layout/MobileHeader.tsx (lines 32-101).
//
// Bell is a STUB matching the karute project's existing pattern
// (see AppointmentsView.tsx lines 185-200). The full notifications
// system (8 categories, panel UI, unread badge) lands in its own PR —
// see MERGE_NOTES_FOR_ANTHONY.md "Notifications system" handoff.
// When the badge wires up, it overlays on the bell via an absolute
// <span> without restructuring this component.
export function RecordPageHeader() {
  const t = useTranslations('recording')
  const tCommon = useTranslations('common')
  const router = useRouter()

  return (
    <>
      {/* Mobile chrome — sticky, full-bleed, back + centered title + bell */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border/40 bg-background/80 px-2 backdrop-blur md:hidden">
        <div className="relative flex h-12 items-center">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={tCommon('back')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <button
            type="button"
            className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={tCommon('notifications')}
            // STUB — bell stays a stub until notifications PR lands.
            // See MERGE_NOTES_FOR_ANTHONY.md "Notifications system".
          >
            <Bell size={18} />
          </button>
        </div>
      </div>

      {/* Desktop heading — kept as-is from the prior visual pass */}
      <div className="hidden flex-col gap-1.5 md:flex">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
    </>
  )
}
