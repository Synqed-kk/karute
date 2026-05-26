'use client'

import { useTranslations } from 'next-intl'

// Record-page header — desktop-only big page heading + subtitle.
//
// Mobile chrome moved to the global MobileHeader (layout-level) when
// it landed in PR #57. The earlier local mobile-only chrome block
// duplicated MobileHeader at the top of the screen — two title bars,
// two bells. MobileHeader now owns mobile title + bell across every
// (app) route, so the record page just contributes a desktop heading.
//
// Recording-aware bell hiding — the prior local chrome hid the bell
// while recording so DiscreetRecordingIndicator could occupy the
// top-right without overlapping. MobileHeader's bell is always
// visible today (per its docstring: "useRecording() not yet wired
// in karute"). DiscreetRecordingIndicator still surfaces recording
// state via its floating top-right pill. Anthony can plumb the
// useGlobalRecorder hook into MobileHeader when the recording UX
// gets a polish pass; the surface is small.
export function RecordPageHeader() {
  const t = useTranslations('recording')

  return (
    <div className="hidden flex-col gap-1.5 md:flex">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {t('title')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
    </div>
  )
}
