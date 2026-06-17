// The customer-identity decision for the karute QR sync's find-or-create.
//
// THE BUG THIS REPLACES: the legacy find-or-create matched a returning customer
// by NAME against a 200-row window, so anyone outside that window was re-created
// every sync run — 654 customers, 187 minted in one day. This is the directive-
// compliant ladder (the same one synqed-core's findOrCreateCustomer already runs
// server-side): match by the QuickReserve customer id, CONFIRM with phone/email,
// and NEVER match-or-merge on name alone when it can't be proven.
//
// PURE: the caller fetches the candidate sets via the SDK (and post-filters phone
// to EXACT equality, because synqed-core's search is a substring match); this
// function only DECIDES. That keeps the dangerous logic unit-testable.

export interface IdentityCandidates {
  /** Customer id whose external_refs.quickreserve.customerId == this reservation's
   *  QR customer id. The real key. INERT in the karute interim (the SDK read omits
   *  external_refs), so it's null until we delegate to synqed-core — pass it
   *  anyway so the ladder is correct the moment it lights up. */
  byQrId: string | null
  /** Customer ids whose phone EXACTLY equals the reservation phone (caller has
   *  already post-filtered the SDK substring search to byte-exact). */
  byPhoneExact: string[]
  /** Customer id whose email equals the reservation email — (businessId,email) is
   *  DB-unique, so at most one. */
  byEmailExact: string | null
  /** Customer ids whose name is BYTE-EXACT equal to the reservation name (no
   *  normalization — 同姓同名 must not collapse). */
  byNameExact: string[]
}

export interface IdentityResolution {
  /** The matched existing customer id, or null → the caller creates a new one. */
  customerId: string | null
  /** How it resolved (for logging + tests). */
  reason: 'qr-id' | 'phone' | 'phone-email-conflict' | 'email' | 'name' | 'create-ambiguous-name' | 'create'
}

/**
 * Decide which existing customer (if any) a reservation belongs to. Returns
 * null → create. NEVER guesses: an ambiguous same-name match with no phone/email
 * confirmer creates a (recoverable) new row rather than risk attributing one
 * person's visit to another (a privacy error that the dedup cleanup can't undo).
 */
export function resolveByQrIdentity(c: IdentityCandidates): IdentityResolution {
  // 1. QR customer id — exact, the real key.
  if (c.byQrId) return { customerId: c.byQrId, reason: 'qr-id' }

  // 2. Phone, ONLY when it resolves to exactly one customer (0 or >1 = ambiguous).
  if (c.byPhoneExact.length === 1) {
    const id = c.byPhoneExact[0]
    // Email-conflict guard: if the email points at a DIFFERENT customer, do NOT
    // fuse two identities — go phone-first and flag for review.
    if (c.byEmailExact && c.byEmailExact !== id) {
      return { customerId: id, reason: 'phone-email-conflict' }
    }
    return { customerId: id, reason: 'phone' }
  }

  // 3. Email — (businessId,email) is unique, so a hit is exactly one person.
  if (c.byEmailExact) return { customerId: c.byEmailExact, reason: 'email' }

  // 4. Name — byte-exact AND unambiguous only. More than one same-name customer
  //    with nothing to disambiguate → do NOT guess; create instead.
  if (c.byNameExact.length === 1) return { customerId: c.byNameExact[0], reason: 'name' }
  if (c.byNameExact.length > 1) return { customerId: null, reason: 'create-ambiguous-name' }

  // 5. No match anywhere → create.
  return { customerId: null, reason: 'create' }
}

// ─── Candidate index — the route's matching wiring, extracted to stay pure ────
// The sync builds this ONCE from the full (paged-to-completion) customer list,
// then looks up each reservation's candidates in O(1). Extracted from the route
// so the index-build + lookup are unit-testable, not buried behind a Next route.

export interface CustomerLite {
  id: string
  name?: string | null
  phone?: string | null
  email?: string | null
}

export interface CustomerIndex {
  /** name → ids (同姓同名 means a name can map to several). */
  idsByName: Map<string, string[]>
  /** exact phone → ids (a household can share a number). */
  idsByPhone: Map<string, string[]>
  /** email → id ((businessId,email) is DB-unique, so at most one). */
  idByEmail: Map<string, string>
}

// QR sends RAW free-text — full-width spaces in 「姓　名」, unformatted phones
// ("080-1111-2222"), mixed-case email — while synqed-core + the app's own dedup
// (actions/customers.ts normName) compare NFKC-normalized. Index AND look up on
// the SAME normalized key on both sides, or a returning customer with nothing but
// cosmetic drift re-mints. normName mirrors actions/customers.ts:120 exactly.
const normName = (s: string | null | undefined): string | null => {
  if (!s) return null
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() || null
}
const normPhone = (s: string | null | undefined): string | null => {
  if (!s) return null
  return s.normalize('NFKC').replace(/\D/g, '') || null // digits only — strips -, (), spaces, 全角
}
const normEmail = (s: string | null | undefined): string | null => {
  if (!s) return null
  return s.normalize('NFKC').trim().toLowerCase() || null
}

/** Add one customer to the index under NORMALIZED keys. Used to seed from existing
 *  rows AND to register a row created mid-run so later reservations match it
 *  instead of re-minting. */
export function addToIndex(idx: CustomerIndex, c: CustomerLite): void {
  const n = normName(c.name)
  const p = normPhone(c.phone)
  const e = normEmail(c.email)
  if (n) idx.idsByName.set(n, [...(idx.idsByName.get(n) ?? []), c.id])
  if (p) idx.idsByPhone.set(p, [...(idx.idsByPhone.get(p) ?? []), c.id])
  if (e) idx.idByEmail.set(e, c.id)
}

export function buildCustomerIndex(customers: Iterable<CustomerLite>): CustomerIndex {
  const idx: CustomerIndex = { idsByName: new Map(), idsByPhone: new Map(), idByEmail: new Map() }
  for (const c of customers) addToIndex(idx, c)
  return idx
}

/** The candidate sets for one reservation, looked up by the SAME normalized keys
 *  the index was built with. byQrId stays null in the karute interim (the SDK
 *  customer read omits external_refs); it lights up when the sync delegates to
 *  synqed-core, which stores the QR id. */
export function candidatesFor(
  idx: CustomerIndex,
  r: {
    customerName: string
    customerPhone?: string | null
    customerEmail?: string | null
    // Captured today (mapReservation) but the byQrId rung stays inert until the
    // sync delegates to synqed-core — declared here so wiring it up is type-led.
    qrCustomerId?: number
  },
): IdentityCandidates {
  const n = normName(r.customerName)
  const p = normPhone(r.customerPhone)
  const e = normEmail(r.customerEmail)
  return {
    byQrId: null,
    byPhoneExact: p ? (idx.idsByPhone.get(p) ?? []) : [],
    byEmailExact: e ? (idx.idByEmail.get(e) ?? null) : null,
    byNameExact: n ? (idx.idsByName.get(n) ?? []) : [],
  }
}
