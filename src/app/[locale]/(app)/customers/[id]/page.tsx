import { notFound } from 'next/navigation'

import { auditWeb } from '@/lib/audit-web'
import { getCustomer } from '@/lib/customers/queries'
import { getCustomerContact } from '@/lib/customers/customer-detail-cached'
import { getStaffList, getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { listSynqedKaruteRows } from '@/lib/karute/synqed-records'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listCustomerPhotos, getCustomerConsent } from '@/actions/customers'
import { getCustomerMemory } from '@/lib/karute/customer-memory'
import { getCachedPassport } from '@/lib/karute/ai-passport'
import { getOrgSettings } from '@/actions/org-settings'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { getCustomerLifecycleChecked, listCustomerPacks } from '@/lib/packs/store'
import { buildCustomerProfileScreen } from '@/lib/customers/profile-screen'

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function CustomerProfilePage({
  params,
}: CustomerProfilePageProps) {
  const { id, locale } = await params
  const customer = await getCustomer(id).catch(() => null)
  if (!customer) notFound()

  // Single-record open = a view event (7/17 ruling: list renders never log).
  // Fire-and-forget — never blocks or fails the render (mirrors the other
  // web writers' best-effort contract).
  void auditWeb({
    category: 'customer',
    action: 'customer.view',
    targetType: 'customer',
    targetId: id,
    severity: 'info',
  })

  // Both request-memoized (React cache) and already primed inside
  // getCustomer's own client init — no network hop left in either by here.
  const businessId = await getBusinessId()
  const synqed = await getSynqedClient()

  // ONE wave for every remaining read on this page. They all key off `id`
  // (or the memoized client above) — previously they ran as 4 back-to-back
  // stages (support reads → memory → passport+settings → packs+lifecycle),
  // i.e. 4 sequential round trips on the app's most-opened screen. The only
  // read that truly depends on another (回数券 ← org-settings toggle) chains
  // off the settings promise INSIDE the wave, not as a stage after it.
  const orgSettingsPromise = getOrgSettings().catch(() => null)
  const [
    contact,
    staffList,
    photosResult,
    allCustomersList,
    synqedKaruteRows,
    enrichment,
    consentResult,
    memoryItemsRead,
    aiPassport,
    orgSettingsForPassport,
    lifecycleRead,
    packs,
  ] = await Promise.all([
    getCustomerContact(id),
    getStaffList(),
    listCustomerPhotos(id).catch(() => ({
      photos: [] as Array<{
        id: string
        signed_url: string | null
        category: string
        caption: string | null
      }>,
    })),
    // Page to completion so an overflow customer (#500+) still resolves its
    // karute number + name here instead of falling back to #00000.
    listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
    // synqed-core is the sole karute store (the Supabase karute_records table
    // is empty and being dropped).
    listSynqedKaruteRows(synqed, { customerId: id }),
    // 担当 fallback: the booking's staff when this customer has no 指名
    // (assigned_staff_id) — QR-synced customers never do. Same source as the
    // list page so the profile's 担当 matches the card.
    enrichCustomers(businessId, [id]),
    // Recording consent — same read the pre-session brief uses, so the
    // Privacy tab's revoke row reflects the same "currently granted" truth.
    getCustomerConsent(id).catch(() => ({ consent: null })),
    // お客様メモリー store read — empty ⇒ the backfill below bootstraps it.
    getCustomerMemory(id),
    // Passport (これまで box): pure cache read — generation happens only
    // inside 再学習, so an LLM call can never block this page.
    getCachedPassport(id),
    orgSettingsPromise,
    // Checked read: a FAILED lifecycle fetch must fail closed for coaching
    // (suppress the pace verdict below), not read as "active customer".
    // Display consumers (status chip, lifecycle buttons) keep null-degrade.
    getCustomerLifecycleChecked(id),
    // 回数券 — tickets off (org setting) ⇒ skip the pack fetch entirely;
    // lifecycle above is customer-state, not a ticket feature, so it always
    // loads. Best-effort: empty card until the ticket_packs migration lands
    // (store degrades gracefully).
    orgSettingsPromise.then((settings) =>
      (settings?.ticket_packs_enabled ?? true)
        ? listCustomerPacks(id)
        : Promise.resolve([]),
    ),
  ])

  const screen = await buildCustomerProfileScreen({
    customer,
    id,
    businessId,
    locale,
    contact,
    staffList,
    photosResult,
    allCustomersList,
    synqedKaruteRows,
    enrichment,
    consentResult,
    memoryItemsRead,
    aiPassport,
    orgSettingsForPassport,
    lifecycleRead,
    packs,
  })

  return <CustomerProfileView {...screen} />
}
