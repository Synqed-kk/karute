// THE practice-door actor (DESIGN-PRACTICE-DOOR.md §3): who is asking, and which
// stores they may see — computed ONCE per request, from core's answer sheet.
// The sheet is the one source for the actor's stores; staffStores.list() serves
// the ROSTER planes only (door.ts), never this list. Read-only: nothing here
// writes, and a core error propagates (never an empty list, §7).

import { cache } from 'react'
import { requireBusinessAdmission } from '../admission'
import { clientFor, type CoreReads } from './core-reach'

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
  reads: CoreReads
  card: Staff
  sheet: Sheet
  viewAll: boolean
  visible: Store[]
}

const MAX_PAGES = 50

/** Every row of a paged read — never a truncated list: a read that has not
 *  reached `total` after 50 pages throws rather than answering with part. */
export async function pageAll<T>(label: string, fetch: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { rows, total } = await fetch(page)
    out.push(...rows)
    if (out.length >= total) return out
  }
  throw new Error(`practice door: ${label} exceeded ${MAX_PAGES} pages`)
}

export const practiceActor = cache(async (): Promise<PracticeActor> => {
  const admitted = await requireBusinessAdmission()
  const reads = clientFor(admitted) // the tenant throw lives there (§2), before any read
  const staff = await pageAll('staff list', async (page) => {
    const r = await reads.staffList({ page, page_size: 200 })
    return { rows: r.staff, total: r.total }
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
  return { reads, card, sheet, viewAll, visible }
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
