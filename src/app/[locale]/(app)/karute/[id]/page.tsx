import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { getKaruteRecord } from '@/lib/supabase/karute'
import { getKaruteOutcome } from '@/lib/karute/outcome'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import {
  PhotoRecordsServer,
  PhotoRecordsSkeleton,
} from '@/components/karute/redesign/detail/PhotoRecordsServer'
import {
  karuteToHeader,
  karuteEntriesToSessionEntries,
  karuteSummaryToBullets,
} from '@/lib/adapters/karute-detail'
import {
  getCustomerContact,
  getCachedCustomerConsent,
} from '@/lib/customers/customer-detail-cached'
import {
  AIBodyPredictionSlot,
  AISuggestedMessageSlot,
} from '@/components/karute/redesign/detail/AiInsightSlots'
import {
  AIBodyPredictionPreview,
  AIOutreachPreview,
} from '@/components/customers/redesign/profile/UpcomingAiFeatures'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import { canViewTranscript } from '@/lib/auth/recording-acl'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { listAllCustomers } from '@/lib/customers/list-all'
import { getCustomer } from '@/lib/customers/queries'
import { computeAge, jpGender } from '@/lib/customers/demographics'
import { formatJoinDate } from '@/lib/customers/list-enrich'

interface KaruteDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function KaruteDetailPage({
  params,
}: KaruteDetailPageProps) {
  const { id, locale } = await params

  // Fetch the karute and the tenant customer list in parallel — the list feeds
  // the sequential karute number (below) and doesn't depend on the karute.
  const synqed = await getSynqedClient()
  const [karute, allCustomers, outcome, viewerStaffId, canViewAllRecordings] =
    await Promise.all([
      getKaruteRecord(id),
      // Page to completion so the karute number resolves for an overflow customer.
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      getKaruteOutcome(id),
      // Recording-privacy ACL inputs (#4): the viewer's staff id + whether they
      // may read every staff's raw recordings (owner/manager). Both independent
      // of the karute, so fan them out in the same wave.
      getCurrentUserStaffId(),
      can('recordings.viewAll'),
    ])
  if (!karute) notFound()

  const customerId =
    (karute as unknown as { client_id?: string | null }).client_id ?? null
  const header = karuteToHeader(karute)
  const sessionEntries = karuteEntriesToSessionEntries(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript =
    (karute as unknown as { transcript?: string | null }).transcript ?? null
  // Recording privacy (#4): the raw transcript is private to the staff who
  // recorded the session — only they (or a recordings.viewAll role) see the
  // text. The AI summary + entries below stay shared with everyone. A record
  // with no owner (legacy/manual) is treated as shared. Withholding the
  // transcript also hides the "regenerate entries from transcript" action,
  // which reads the same raw text.
  const ownerStaffId =
    (karute as unknown as { staff_profile_id?: string | null })
      .staff_profile_id ?? null
  const canSeeTranscript = canViewTranscript({
    ownerStaffId,
    viewerStaffId,
    canViewAll: canViewAllRecordings,
  })
  const visibleTranscript = canSeeTranscript ? transcript : null
  const transcriptRestricted = !canSeeTranscript && Boolean(transcript)
  // Sequential per-tenant number from the shared customer list — matches the
  // karute list and customer profile (#00007). Replaces deriveKaruteNumber(id),
  // which hex-sliced the karute UUID into an alphanumeric #427C2 that disagreed
  // with every other surface. Numbers-only, consistent.
  const karuteNumber = customerId
    ? (assignSequentialKaruteNumbers(allCustomers.customers).get(customerId) ??
      '#00000')
    : '#00000'

  // Customer contact + consent are both cached per-customer with their own tag
  // invalidation. Photos are NOT awaited here; they're streamed in via a
  // Suspense boundary below so the shell paints first.
  let phone: string | null = null
  let email: string | null = null
  let consentOnFile = false
  // Deep-crawl identity for the header (年齢/性別/回数/前回) — the same fields the
  // customer hub surfaces, so the karute-detail header matches it instead of
  // showing only name/#/date/contact.
  let headerExtras: {
    age: number | null
    gender: string | null
    visitNumber: number | null
    lastVisitDate: string | null
  } = { age: null, gender: null, visitNumber: null, lastVisitDate: null }
  if (customerId) {
    const [contact, consentResult, customer] = await Promise.all([
      getCustomerContact(customerId),
      getCachedCustomerConsent(customerId).catch(() => ({ consent: null })),
      getCustomer(customerId).catch(() => null),
    ])
    phone = contact.phone
    email = contact.email
    consentOnFile = Boolean(consentResult.consent)
    if (customer) {
      headerExtras = {
        age: computeAge(customer.date_of_birth),
        gender: jpGender(customer.gender),
        visitNumber: customer.visit_count,
        lastVisitDate: customer.last_visit_at
          ? formatJoinDate(customer.last_visit_at, locale)
          : null,
      }
    }
  }

  return (
    <KaruteDetailView
      karuteId={id}
      customerId={customerId}
      outcome={outcome}
      header={{
        customerName: header.customerName,
        initials: header.customerInitials,
        karuteNumber,
        service: null,
        sessionDateLong: header.sessionDateLong,
        staffName: header.staffName === '—' ? null : header.staffName,
        phone,
        email,
        age: headerExtras.age,
        gender: headerExtras.gender,
        visitNumber: headerExtras.visitNumber,
        lastVisitDate: headerExtras.lastVisitDate,
      }}
      sessionDateLong={header.sessionDateLong}
      sessionDateIso={
        ((karute as unknown as { session_date?: string | null }).session_date ??
          (karute as unknown as { created_at?: string | null }).created_at)?.slice(0, 10) ?? null
      }
      entries={sessionEntries}
      summaryBullets={summaryBullets}
      transcript={visibleTranscript}
      consentOnFile={consentOnFile}
      transcriptDurationLabel={null}
      transcriptRestricted={transcriptRestricted}
      photosSlot={
        customerId ? (
          <Suspense fallback={<PhotoRecordsSkeleton />}>
            <PhotoRecordsServer customerId={customerId} />
          </Suspense>
        ) : null
      }
      memory={null}
      bodyPredictionSlot={
        customerId ? (
          <Suspense fallback={<AIBodyPredictionPreview />}>
            <AIBodyPredictionSlot customerId={customerId} locale={locale} />
          </Suspense>
        ) : (
          <AIBodyPredictionPreview />
        )
      }
      suggestedMessageSlot={
        <Suspense fallback={<AIOutreachPreview />}>
          <AISuggestedMessageSlot
            karuteId={id}
            customerId={customerId}
            customerName={header.customerName}
            summary={(karute as unknown as { summary?: string | null }).summary ?? null}
            locale={locale}
          />
        </Suspense>
      }
    />
  )
}
