// Session-detail screen assembly (packet 07 §Build 1(i)) — the post-fetch
// derivation the /karute/[id] page used to inline, moved VERBATIM so the web page
// and the facade screen GET assemble the SAME view-model from the same raw wave
// results. The page (cookie reads) and the facade route (Bearer, business-scoped
// reads) both fetch the wave themselves, then hand the raw results here.
//
// Pure assembly — NO fetching, NO identity resolution. Takes the karute record,
// the tenant customer list (for the sequential number), the outcome, the ACL
// inputs (viewer staff id + recordings.viewAll), and the customerId-gated wave-2
// results (contact / consent / customer), and returns exactly the data props
// KaruteDetailView consumes (the ReactNode slots + memory stay caller-supplied).

import {
  karuteToHeader,
  karuteEntriesToSessionEntries,
  karuteSummaryToBullets,
} from '@/lib/adapters/karute-detail'
import { canViewTranscript } from '@/lib/auth/recording-acl'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { computeAge, jpGender } from '@/lib/customers/demographics'
import { formatJoinDate } from '@/lib/customers/list-enrich'
import type { KaruteWithRelations } from '@/lib/supabase/karute'
import type { KaruteOutcomeRow } from '@/lib/karute/outcome'
import type { SessionEntry } from '@/components/karute/redesign/detail/CurrentSessionCard'

interface Contact {
  phone: string | null
  email: string | null
}

interface DemographicCustomer {
  date_of_birth: string | null
  gender: string | null
  visit_count: number
  last_visit_at: string | null
}

export interface KaruteDetailScreenHeader {
  customerName: string
  initials: string
  karuteNumber: string
  service: string | null
  sessionDateLong: string
  staffName: string | null
  phone: string | null
  email: string | null
  age: number | null
  gender: string | null
  visitNumber: number | null
  lastVisitDate: string | null
}

export interface KaruteDetailScreen {
  karuteId: string
  customerId: string | null
  outcome: KaruteOutcomeRow | null
  header: KaruteDetailScreenHeader
  sessionDateLong: string
  sessionDateIso: string | null
  entries: SessionEntry[]
  summaryBullets: string[]
  /** The effective summary's RAW text (edited ?? ai) — seeds the 詳細記録
   *  pencil's edit sheet, which needs the real line breaks the bullet split
   *  throws away. */
  summaryRaw: string | null
  /** True when the summary is the human overlay — drives the amber pencil. */
  summaryEdited: boolean
  /** The transcript AS THE VIEWER MAY SEE IT — withheld to null by the ACL. */
  transcript: string | null
  consentOnFile: boolean
  transcriptDurationLabel: string | null
  transcriptRestricted: boolean
  /** F4: records.reassign gate — the 顧客を変更 entry point. Additive field,
   *  same staffCanDeletePhotos threading pattern (RecordPageView.tsx). */
  staffCanReassignRecords: boolean
}

export interface BuildKaruteDetailScreenArgs {
  karute: KaruteWithRelations
  /** The tenant customer list, paged to completion — feeds the sequential #. */
  allCustomers: { customers: Array<{ id: string }> }
  outcome: KaruteOutcomeRow | null
  /** Recording-privacy ACL inputs (#4). */
  viewerStaffId: string | null
  canViewAllRecordings: boolean
  /** F4: records.reassign gate, resolved by the caller (web: can(); facade:
   *  ctx.identity.capabilities.has()) — same threading chokepoint as the
   *  recording-privacy inputs above. */
  staffCanReassignRecords: boolean
  /** customerId-gated wave-2 results — null when the karute has no linked client. */
  contact: Contact | null
  consentResult: { consent: unknown } | null
  customer: DemographicCustomer | null
  locale: string
}

export function buildKaruteDetailScreen(
  args: BuildKaruteDetailScreenArgs,
): KaruteDetailScreen {
  const {
    karute,
    allCustomers,
    outcome,
    viewerStaffId,
    canViewAllRecordings,
    staffCanReassignRecords,
    contact,
    consentResult,
    customer,
    locale,
  } = args

  const customerId = karute.client_id ?? null
  const header = karuteToHeader(karute, locale)
  const sessionEntries = karuteEntriesToSessionEntries(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript = karute.transcript ?? null

  // Recording privacy (#4): the raw transcript is private to the recording
  // staffer — only they (or a recordings.viewAll role) see the text. A record
  // with no owner (legacy/manual) is shared. Withholding the transcript also
  // hides the regenerate action, which reads the same raw text.
  const ownerStaffId = karute.staff_profile_id ?? null
  const canSeeTranscript = canViewTranscript({
    ownerStaffId,
    viewerStaffId,
    canViewAll: canViewAllRecordings,
  })
  const visibleTranscript = canSeeTranscript ? transcript : null
  const transcriptRestricted = !canSeeTranscript && Boolean(transcript)

  // Sequential per-tenant number from the shared customer list — matches the
  // karute list and customer profile (#00007).
  const karuteNumber = customerId
    ? (assignSequentialKaruteNumbers(allCustomers.customers).get(customerId) ??
      '#00000')
    : '#00000'

  const phone = contact?.phone ?? null
  const email = contact?.email ?? null
  const consentOnFile = Boolean(consentResult?.consent)

  const headerExtras: {
    age: number | null
    gender: string | null
    visitNumber: number | null
    lastVisitDate: string | null
  } = customer
    ? {
        age: computeAge(customer.date_of_birth),
        gender: jpGender(customer.gender),
        visitNumber: customer.visit_count,
        lastVisitDate: customer.last_visit_at
          ? formatJoinDate(customer.last_visit_at, locale)
          : null,
      }
    : { age: null, gender: null, visitNumber: null, lastVisitDate: null }

  return {
    karuteId: karute.id,
    customerId,
    outcome,
    header: {
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
    },
    sessionDateLong: header.sessionDateLong,
    sessionDateIso:
      (karute.session_date ?? karute.created_at)?.slice(0, 10) ?? null,
    entries: sessionEntries,
    summaryBullets,
    summaryRaw: karute.summary ?? null,
    summaryEdited: karute.summary_edited ?? false,
    transcript: visibleTranscript,
    consentOnFile,
    transcriptDurationLabel: null,
    transcriptRestricted,
    staffCanReassignRecords,
  }
}
