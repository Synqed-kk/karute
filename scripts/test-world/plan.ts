// plan.ts — the PURE planner of the test-world fill: (recipe, store, today, epoch) → every row the
// loader should hold, each with a deterministic key. No I/O, no clock, no network.
//
// Dates: the EPOCH (first-run JST date, kept in the manifest) fixes the window start at epoch − pastDays;
// the end is today + futureDays. A customer's visits are a function of the customer alone (start day,
// cadence, seeded jitter), and a day's slots depend only on that day's visits — so a later `today` only
// ADDS days (the weekly top-up): the past never shifts, no date ever plans a second row.
import type { AppointmentStatus, EntryCategory, StaffRole, WeeklyHours } from '@synqed-kk/client'

export interface Counts {
  staff: number
  resources: number
  menus: number
  customers: number
  packs: number
  pastDays: number
  futureDays: number
  slotMinutes: number
  cancelShare: number
  noShowShare: number
  karuteShare: number
}

export interface RecipeCustomer {
  member: string // member_number — the customer's stable key
  name: string
  kana: string
  gender: 'female' | 'male'
  birth: string // YYYY-MM-DD
  occupation: string
  phone: string
  email: string
  memo: string
  staff: string // 担当 (staff name)
  menu: string // usual menu (name)
  alt: string // occasional menu (name)
  start: number // first visit, days after the window start
  every: number | null // days between visits; null = one visit only
  isNew: boolean // first visit in the window = 初回
  time: 'am' | 'pm' | 'eve'
  theme: string // the karute text's thread
}

export interface KaruteCtx {
  customer: RecipeCustomer
  menu: string
  date: string
  first: boolean // the customer's first visit ever
  prev: { date: string; menu: string } | null // last completed visit in the window
  pick: <T>(xs: readonly T[]) => T
}

export interface KaruteLine {
  category: EntryCategory
  label: string
  text: string
}

export interface RecipeData {
  policy: { weekly_hours: WeeklyHours }
  staff: { name: string; role: StaffRole }[]
  resources: { name: string; room_class: 'standard' | 'private'; cleanup_minutes: number; display_order: number }[]
  menus: { name: string; duration: number; price: number; category: string | null; nomination: boolean; private: boolean }[]
  firstMenu: string
  customers: RecipeCustomer[]
  packs: { member: string; size: number; unitPrice: number; atVisit: number }[]
  karute(ctx: KaruteCtx): KaruteLine[] // 3–6 lines: 主訴 · 経過 · 施術内容 · 申し送り …
}
export type Recipe = RecipeData & { id: string; counts: Counts }

export interface PlannedAppointment {
  key: string
  member: string
  staff: string
  resource: string
  menu: string
  date: string
  startsAt: string
  endsAt: string
  duration: number
  price: number
  status: AppointmentStatus
}
export interface Plan {
  window: { from: string; to: string }
  staff: RecipeData['staff']
  resources: RecipeData['resources']
  menus: RecipeData['menus']
  customers: RecipeCustomer[]
  packs: { key: string; member: string; size: number; unitPrice: number; purchasedOn: string; staff: string; redeem: string[] }[]
  appointments: PlannedAppointment[]
  karutes: { key: string; member: string; staff: string; menu: string; date: string; duration: number; entries: KaruteLine[] }[]
}

const DAY = 86_400_000
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const utc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
export const addDays = (ymd: string, n: number) => new Date(utc(ymd) + n * DAY).toISOString().slice(0, 10)
export const hoursOn = (h: WeeklyHours, ymd: string) => h[WEEKDAY[new Date(utc(ymd)).getUTCDay()]] ?? null
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
/** A JST wall-clock minute on a JST date, as the ISO instant core stores. */
export const jstIso = (ymd: string, minute: number) => new Date(utc(ymd) - 9 * 3_600_000 + minute * 60_000).toISOString()

/** Seeded PRNG (FNV-1a → mulberry32): same seed, same stream, on every machine. */
export function rng(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Who may take an overflow visit (the customer's own 担当 is busy): every role but ASSISTANT (the 受付). */
export const canTreat = (s: { role: StaffRole }) => s.role !== 'ASSISTANT'

/** The minute a customer of that day-part prefers, from the day's own hours: am = opening, pm = the middle of the day
 *  (on the slot grid), eve = the last start that leaves one slot before closing. No fixed clock times. */
export function preferredStart(h: { open: string; close: string }, part: 'am' | 'pm' | 'eve', duration: number, slot: number): number {
  const [open, close] = [mins(h.open), mins(h.close)]
  return part === 'am' ? open : part === 'pm' ? Math.floor((open + close) / 2 / slot) * slot : close - duration - slot
}

export function plan(recipe: Recipe, store: { storeId: string; weeklyHours: WeeklyHours }, today: string, epoch: string): Plan {
  const { id, counts: n } = recipe
  for (const k of ['staff', 'resources', 'menus', 'customers', 'packs'] as const)
    if (recipe[k].length !== n[k]) throw new Error(`recipe ${id}: ${k} has ${recipe[k].length} rows, registry says ${n[k]}`)
  const hours = store.weeklyHours
  if (!WEEKDAY.some((d) => hours[d])) throw new Error('the store has no open weekday')
  const from = addDays(epoch, -n.pastDays)
  const to = addDays(today, n.futureDays)
  const span = (utc(to) - utc(from)) / DAY
  const menu = (name: string) => recipe.menus.find((m) => m.name === name) ?? fail(`menu ${name} not in recipe ${id}`)
  const cleanup = Math.max(...recipe.resources.map((r) => r.cleanup_minutes))

  // 1. Visits: customer → days (closed days roll to the next open day).
  const byDay = new Map<number, { c: RecipeCustomer; k: number }[]>()
  for (const c of recipe.customers) {
    const r = rng(`${id}|visits|${c.member}`)
    const jitter = c.every ? Math.max(1, Math.floor(c.every / 5)) : 0
    for (let k = 0, last = -1; k === 0 || c.every; k++) {
      let day = c.start + k * (c.every ?? 0) + (k ? Math.round((r() * 2 - 1) * jitter) : 0)
      day = Math.max(day, last + 1)
      while (!hoursOn(hours, addDays(from, day))) day++
      if (day > span) break
      byDay.set(day, [...(byDay.get(day) ?? []), { c, k }])
      last = day
    }
  }

  // 2. Slots, day by day: one booking per staff and per bed per slot, inside the day's hours.
  const appointments: PlannedAppointment[] = []
  for (let d = 0; d <= span; d++) {
    const date = addDays(from, d)
    const h = hoursOn(hours, date)
    if (!h) continue
    const busy = new Set<string>()
    const free = (who: string, start: number, cells: number) => {
      for (let i = 0; i < cells; i++) if (busy.has(`${who}@${start + i * n.slotMinutes}`)) return false
      return true
    }
    for (const { c, k } of byDay.get(d) ?? []) {
      const r = rng(`${id}|${c.member}|${date}`)
      const m = menu(k === 0 && c.isNew ? recipe.firstMenu : r() < 0.75 ? c.menu : c.alt)
      const u = r()
      const status: AppointmentStatus = date >= today ? 'SCHEDULED' : u < n.noShowShare ? 'NO_SHOW' : u < n.noShowShare + n.cancelShare ? 'CANCELLED' : 'COMPLETED'
      const cells = Math.ceil((m.duration + cleanup) / n.slotMinutes) // the bed is reset before the next guest
      const starts: number[] = []
      for (let s = mins(h.open); s + m.duration <= mins(h.close); s += n.slotMinutes) starts.push(s)
      const want = preferredStart(h, c.time, m.duration, n.slotMinutes)
      starts.sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)
      // weights drawn for every other card BEFORE the role filter: the same r() count as before keeps the bed picks stable
      const others = recipe.staff.filter((s) => s.name !== c.staff).map((s) => ({ s, w: r() })).filter((x) => canTreat(x.s)).sort((a, b) => a.w - b.w).map((x) => x.s.name)
      const beds = recipe.resources.filter((x) => x.room_class === 'private' || !m.private).map((x) => ({ x, w: Number(x.room_class === 'private') + r() })).sort((a, b) => a.w - b.w).map((b) => b.x) // private room last
      let slot: { s: number; staff: string; bed: string } | undefined
      for (const s of starts) {
        for (const staff of [c.staff, ...others]) {
          if (!free(staff, s, cells)) continue
          const bed = beds.find((b) => free(b.name, s, cells))
          if (bed) slot = { s, staff, bed: bed.name }
          if (slot) break
        }
        if (slot) break
      }
      if (!slot) continue // a full day: this visit is not planned (same answer on every run)
      for (let i = 0; i < cells; i++) for (const who of [slot.staff, slot.bed]) busy.add(`${who}@${slot.s + i * n.slotMinutes}`)
      appointments.push({
        key: `tw:${id}:${c.member}:${date}`, member: c.member, staff: slot.staff, resource: slot.bed, menu: m.name, date,
        startsAt: jstIso(date, slot.s), endsAt: jstIso(date, slot.s + m.duration), duration: m.duration, price: m.price, status,
      })
    }
  }

  // 3. Karutes (share of completed visits) and 回数券 (bought at the Nth completed visit, burnt on the next ones).
  const karutes: Plan['karutes'] = []
  const done = new Map<string, PlannedAppointment[]>()
  for (const a of appointments) {
    if (a.status !== 'COMPLETED') continue
    const c = recipe.customers.find((x) => x.member === a.member)!
    const history = done.get(a.member) ?? []
    const prev = history[history.length - 1]
    if (rng(`${a.key}|karute`)() < n.karuteShare) {
      const r = rng(`${a.key}|text`)
      const entries = recipe.karute({
        customer: c, menu: a.menu, date: a.date, first: c.isNew && history.length === 0,
        prev: prev ? { date: prev.date, menu: prev.menu } : null, pick: (xs) => xs[Math.floor(r() * xs.length)],
      })
      karutes.push({ key: a.key, member: a.member, staff: a.staff, menu: a.menu, date: a.date, duration: a.duration, entries })
    }
    done.set(a.member, [...history, a])
  }
  const packs: Plan['packs'] = []
  for (const p of recipe.packs) {
    const visits = done.get(p.member) ?? []
    const bought = visits[p.atVisit - 1]
    if (!bought) continue
    packs.push({
      key: `tw:${id}:${p.member}:pack:1`, member: p.member, size: p.size, unitPrice: p.unitPrice, purchasedOn: bought.date,
      staff: bought.staff, redeem: visits.slice(p.atVisit - 1, p.atVisit - 1 + p.size).map((v) => v.key),
    })
  }

  return { window: { from, to }, staff: recipe.staff, resources: recipe.resources, menus: recipe.menus, customers: recipe.customers, packs, appointments, karutes }
}

function fail(msg: string): never {
  throw new Error(msg)
}
