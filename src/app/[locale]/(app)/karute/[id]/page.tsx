import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { getKaruteRecord } from '@/lib/supabase/karute'
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
import { getKaruteNumber } from '@/lib/customers/karute-number'
import {
  getCustomerContact,
  getCachedCustomerConsent,
} from '@/lib/customers/customer-detail-cached'
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

  const karute = await getKaruteRecord(id)
  if (!karute) notFound()

  const customerId =
    (karute as unknown as { client_id?: string | null }).client_id ?? null
  const header = karuteToHeader(karute, locale)
  const sessionEntries = karuteEntriesToSessionEntries(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript =
    (karute as unknown as { transcript?: string | null }).transcript ?? null
  // Sequential per-customer number ("#00001"), matching the karute list +
  // customer pages (same assignSequentialKaruteNumbers source). Falls back to the
  // DIGIT placeholder "#00000" — NEVER the hex deriveKaruteNumber, which produced
  // letters ("#49C6E"). Resolves to the real number when the karute's client_id is
  // a synqed customer id (post-migration / fresh records); legacy records whose
  // client_id predates the synqed id show "#00000" until Anthony's karute_number
  // DB sequence column lands (the permanent, cross-store-safe fix).
  const karuteNumber = (await getKaruteNumber(customerId)) ?? '#00000'

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
