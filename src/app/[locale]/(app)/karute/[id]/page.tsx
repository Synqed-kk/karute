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
import { getSynqedClient } from '@/lib/synqed/client'
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
  const [karute, allCustomers, outcome] = await Promise.all([
    getKaruteRecord(id),
    // Page to completion so the karute number resolves for an overflow customer.
    listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
    getKaruteOutcome(id),
  ])
  if (!karute) notFound()

  const customerId =
    (karute as unknown as { client_id?: string | null }).client_id ?? null
  const header = karuteToHeader(karute)
  const sessionEntries = karuteEntriesToSessionEntries(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript =
    (karute as unknown as { transcript?: string | null }).transcript ?? null
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
      entries={sessionEntries}
      summaryBullets={summaryBullets}
      transcript={transcript}
      consentOnFile={consentOnFile}
      transcriptDurationLabel={null}
      photosSlot={
        customerId ? (
          <Suspense fallback={<PhotoRecordsSkeleton />}>
            <PhotoRecordsServer customerId={customerId} />
          </Suspense>
        ) : null
      }
      memory={null}
      bodyPrediction={null}
      suggestedMessage={null}
    />
  )
}
