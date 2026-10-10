// THE practice-door actor (DESIGN-PRACTICE-DOOR.md §3): who is asking, and which
// stores they may see — computed ONCE per request, from core's answer sheet.
// The sheet is the one source for the actor's stores; staffStores.list() serves
// the ROSTER planes only (door.ts), never this list. Read-only: nothing here
// writes, and a core error propagates (never an empty list, §7).

import { cache } from 'react'
import type { CoreReads } from './core-reach'
import { doorFor, practiceTenant } from './switch'

type Staff = Awaited<ReturnType<CoreReads['staffList']>>['staff'][number]
type Sheet = Awaited<ReturnType<CoreReads['answerSheet']>>
type Store = Awaited<ReturnType<CoreReads['storesList']>>['stores'][number]

export class PracticeLensRefused extends Error {
  readonly lens: string
  constructor(lens: string) {
    super(`practice door: lens refused (${lens})`)
    this.name = 'PracticeLensRefused'
    this.lens = lens
  }
}

export interface PracticeActor {
  /** The admitted business — already checked against the practice tenant by clientFor. */
  businessId: string
  reads: CoreReads
  card: Staff
  sheet: Sheet
  viewAll: boolean
  visible: Store[]
}

const MAX_PAGES = 50

/** ⚖ S81 F3 · S82 R2 · P2 (S97) — THE bound on every core read Business makes: no answer within it = a failed read,
 *  never a hung page. The SDK client sets no timeout of its own. One per core REQUEST (a paged read that keeps answering
 *  is never cut; pageAll's MAX_PAGES caps its length). STEP 0 (S97): slowest single Dev Salon request 418 ms. */
export const CORE_READ_BOUND_MS = 5000

/** P2 — a core read that did not answer within the bound. `digest` = `ref`: Next keeps an error's own digest, so the
 *  number a Business error boundary shows is the one in the `[business core read]` line. */
export class CoreUnanswered extends Error {
  readonly read: string
  readonly ms: number
  readonly ref: string
  readonly digest: string
  constructor(read: string, ms: number, ref: string) {
    super(`no answer within ${ms} ms`)
    this.name = 'CoreUnanswered'
    this.read = read
    this.ms = ms
    this.ref = ref
    this.digest = ref
  }
}

/** ⚖ R-S97-2 — a SAVE refused because core did not answer keeps its own log line, carrying the bound's ref (one outage,
 *  one number wherever it surfaces); any other failure's text is exactly as before. */
export const failText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) + (e instanceof CoreUnanswered ? ` ref=${e.ref}` : '')
/** The bound's ref for a save's result (`{}` for any other failure, so its result is unchanged). */
export const coreRefOf = (e: unknown): { ref?: string } => (e instanceof CoreUnanswered ? { ref: e.ref } : {})

/** Symbol slots on the RAW reads object (never a Map: this folder's fence bans the `.set(` token): the bounded object,
 *  once per raw object (practice-door-on pins `a.reads === b.reads`); the outage ref, minted once, so one outage is one
 *  line and one number; the staff-store assignments, read once per actor (door.ts asks three times per render). */
const BOUND = Symbol('bounded reads, once per raw reads object')
const OUTAGE = Symbol('the outage ref, once per raw reads object')
const ASSIGN_ONCE = Symbol('staff-store assignments, once per actor')
type Slotted = CoreReads & { [BOUND]?: CoreReads; [OUTAGE]?: string; [ASSIGN_ONCE]?: ReturnType<CoreReads['staffStoresList']> }

/** One core request raced against the bound. The timer is cleared on success AND failure; a late answer after the
 *  rejection reaches nobody. The first timeout per reads object logs the one black-box line (admission-failure-record's
 *  shape: reason, ref, facts; no message text, no customer data). */
function bounded<T>(raw: Slotted, read: keyof CoreReads, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    call(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const first = raw[OUTAGE] === undefined
        const ref = (raw[OUTAGE] ??= Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0'))
        if (first) console.error('[business core read]', { reason: 'no-answer', ref, read, ms: CORE_READ_BOUND_MS })
        reject(new CoreUnanswered(read, CORE_READ_BOUND_MS, ref))
      }, CORE_READ_BOUND_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** P2 — every reader of `raw`, bounded; the method is looked up at CALL time (a re-stubbed mock is still seen). Typed
 *  CoreReads with an explicit return type, so a missing or extra reader is a type error. */
export function boundReads(raw: CoreReads): CoreReads {
  const r: Slotted = raw
  return (r[BOUND] ??= boundOf(r))
}
function boundOf(r: Slotted): CoreReads {
  return {
    storesList: () => bounded(r, 'storesList', () => r.storesList()),
    staffList: (o) => bounded(r, 'staffList', () => r.staffList(o)),
    staffStoresList: () => (r[ASSIGN_ONCE] ??= bounded(r, 'staffStoresList', () => r.staffStoresList())),
    answerSheet: (id) => bounded(r, 'answerSheet', () => r.answerSheet(id)),
    menusList: (o) => bounded(r, 'menusList', () => r.menusList(o)),
    customersList: (o) => bounded(r, 'customersList', () => r.customersList(o)),
    customerVisits: (id) => bounded(r, 'customerVisits', () => r.customerVisits(id)),
    appointmentsList: (o) => bounded(r, 'appointmentsList', () => r.appointmentsList(o)),
    orgSettingsGet: () => bounded(r, 'orgSettingsGet', () => r.orgSettingsGet()),
    resourcesList: (o) => bounded(r, 'resourcesList', () => r.resourcesList(o)),
    storePolicyGet: (storeId) => bounded(r, 'storePolicyGet', () => r.storePolicyGet(storeId)),
    storePolicyListClosedDays: (storeId, range) => bounded(r, 'storePolicyListClosedDays', () => r.storePolicyListClosedDays(storeId, range)),
    businessGrantsCheck: (staffId) => bounded(r, 'businessGrantsCheck', () => r.businessGrantsCheck(staffId)),
    auditList: (o) => bounded(r, 'auditList', () => r.auditList(o)),
  }
}

/** Every row of a paged read — never a truncated list. The LAST page is the
 *  SHORT one (fewer rows than the page size): core's `total` is never the stop
 *  condition, so a count that under-reports cannot cut the list. The size is
 *  the smaller of what was asked (`pageSize`) and what core says it served
 *  (`page_size` — a server that clamps a page must not make a full page look
 *  short). An exact multiple costs one extra, empty call — the price of never
 *  trusting a count. Still not done after 50 pages → throw, never a part. */
export async function pageAll<T>(
  label: string,
  pageSize: number,
  fetch: (page: number) => Promise<{ rows: T[]; page_size: number }>,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { rows, page_size } = await fetch(page)
    out.push(...rows)
    if (rows.length < Math.min(pageSize, page_size)) return out
  }
  throw new Error(`practice door: ${label} exceeded ${MAX_PAGES} pages`)
}

/** R50 — is the door ON for THIS request's admitted business? Once per request (React cache). Switch
 *  unset: false, and admission is never loaded (the lazy rule below). Every READ asks this; the write
 *  guards and clientFor keep refusing another business ('tenant'). */
export const doorOn = cache(async (): Promise<boolean> => {
  if (practiceTenant() === null) return false
  const { requireBusinessAdmission } = await import('../admission')
  return doorFor((await requireBusinessAdmission()).businessId)
})

export const practiceActor = cache(async (): Promise<PracticeActor> => {
  // Both imports are LAZY on purpose: data.ts imports the door statically, so a
  // static import here would load admission (next/navigation, Supabase) and
  // core-reach (→ @/lib/synqed/client → the SDK) on the OFF path too — every
  // fixture render and every Business jest suite, where the SDK's raw ESM is not
  // transformed. Only the ON path loads them.
  const { requireBusinessAdmission } = await import('../admission')
  const admitted = await requireBusinessAdmission()
  const { clientFor } = await import('./core-reach')
  const reads = boundReads(clientFor(admitted)) // the tenant throw lives there (§2), before any read
  const staff = await pageAll('staff list', 200, async (page) => {
    const r = await reads.staffList({ page, page_size: 200 })
    return { rows: r.staff, page_size: r.page_size }
  })
  // Two-tier link (data.ts's rule, re-implemented — never staff-map.ts, which writes).
  const email = admitted.email?.toLowerCase()
  const card =
    staff.find((s) => s.user_id === admitted.userId) ??
    (email ? staff.find((s) => s.email?.toLowerCase() === email) : undefined)
  // An admitted person without a card is a configuration defect, never a silent viewAll (§3).
  if (!card) throw new Error('practice door: no staff card for the admitted user')
  const sheet = await reads.answerSheet(card.id)
  const viewAll = sheet.capabilities.includes('stores.viewAll')
  const tenant = (await reads.storesList()).stores.filter((s) => s.active)
  const ids = sheet.visible_store_ids
  // FOLD F-2 (⚖ 9/16): core's null = "every store" only WITH stores.viewAll; without it, nothing.
  const visible = viewAll ? tenant : ids === null ? [] : tenant.filter((s) => ids.includes(s.id))
  return { businessId: admitted.businessId, reads, card, sheet, viewAll, visible }
})

export function visibleIds(actor: PracticeActor): string[] {
  return actor.visible.map((s) => s.id)
}

/** The privilege check the play-phase seal removed (§3): a string lens must be a
 *  store this actor can see; `{viewAll:true}` needs the capability. Anything
 *  else — an empty string, junk — is refused the same way. */
export function assertLensVisible(actor: PracticeActor, lens: string | { viewAll: true }): void {
  if (typeof lens === 'string') {
    if (lens !== '' && visibleIds(actor).includes(lens)) return
    throw new PracticeLensRefused(lens)
  }
  if (typeof lens === 'object' && lens !== null && lens.viewAll === true) {
    if (actor.viewAll) return
    throw new PracticeLensRefused('viewAll')
  }
  throw new PracticeLensRefused(String(lens))
}
