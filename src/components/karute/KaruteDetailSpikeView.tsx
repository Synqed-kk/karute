'use client'

import {
  AISummaryCard,
  CustomerHeaderCard,
  KaruteBreadcrumb,
  SessionEntryTimeline,
  TranscriptCollapse,
} from '@synqed-kk/ui'
import type { SessionEntryRowData } from '@synqed-kk/ui'
import { Link } from '@/i18n/navigation'
import type { KaruteDetailHeader } from '@/lib/adapters/karute-detail'

interface KaruteDetailSpikeViewProps {
  customerId?: string | null
  header: KaruteDetailHeader
  entries: SessionEntryRowData[]
  summaryBullets: string[]
  transcript: string | null
}

export function KaruteDetailSpikeView({
  customerId,
  header,
  entries,
  summaryBullets,
  transcript,
}: KaruteDetailSpikeViewProps) {
  return (
    <div className="space-y-6">
      <KaruteBreadcrumb
        customerName={header.customerName}
        sessionDate={header.sessionDateMedium}
        customersHrefSlot={(children) => (
          <Link
            href={'/customers' as Parameters<typeof Link>[0]['href']}
          >
            {children}
          </Link>
        )}
        customerHrefSlot={(children) =>
          customerId ? (
            <Link
              href={
                `/customers/${customerId}` as Parameters<typeof Link>[0]['href']
              }
            >
              {children}
            </Link>
          ) : (
            <>{children}</>
          )
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 px-4 md:px-6">
        <CustomerHeaderCard
          name={header.customerName}
          initials={header.customerInitials}
          age="—"
          gender="—"
          visitCount={0}
          lastVisitDate={header.sessionDateMedium}
          lastVisitDaysAgo={0}
          staffName={header.staffName}
          service="Session"
          sessionDate={header.sessionDateMedium}
          conversionStatus="active"
        />

        {summaryBullets.length > 0 && (
          <AISummaryCard
            title="AI summary"
            summary={summaryBullets}
            sessionDate={header.sessionDateMedium}
          />
        )}

        {entries.length > 0 && (
          <SessionEntryTimeline
            title="Session entries"
            sessionDate={header.sessionDateMedium}
            entries={entries}
          />
        )}

        {transcript && (
          <TranscriptCollapse
            consent={false}
            durationLabel="—"
            content={transcript}
          />
        )}
      </div>
    </div>
  )
}
