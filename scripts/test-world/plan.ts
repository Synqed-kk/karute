// plan.ts — the PURE planner of the test-world fill: (recipe, store, today, epoch) → every row the
// loader should hold, each with a deterministic key. No I/O, no clock, no network.
//
// Dates: the EPOCH (first-run JST date, kept in the manifest) fixes the window start at epoch − pastDays;
// the end is today + futureDays. A customer's visits are a function of the customer alone (start day,
// cadence, seeded jitter), and a day's slots depend only on that day's visits — so a later `today` only
// ADDS days (the weekly top-up): the past never shifts, no date ever plans a second row.
//
// REALISM (registry.json `realism`, per type): from the store's `realismFrom` date on (the manifest; realism.ts
// sets it past the last day any run has planned, so no existing row moves) a customer returns on the type's rhythm,
// a 指名 customer only ever books their 担当, and past visits end cancelled / no-show at the type's rates. Before that
// date the plan is exactly what it always was.
import type { AppointmentStatus, EntryCategory, StaffRole, WeeklyHours } from '@synqed-kk/client'

export interface Counts {
  staff: number
  resources: number
  menus: number
  customers: number
  packs: number
  pastDays: number
  futureDays: number
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

/** registry.json `types.<id>.realism` — see its $realism note. */
export interface Realism {
  nominatedShare: number
  cancelShare: number
  noShowShare: number
  futureCancels: [number, number]
  rhythmDays: [number, number]
  rhythmJitter: number
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
export type Recipe = RecipeData & { id: string; counts: Counts; realism?: Realism }

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

/** The store's booking step: minutes between bookable starts, counted from the day's opening. Refused: not a positive whole
 *  number, or longer than the store's longest open day (no second start could exist anywhere). */
// ponytail: 30 until core ships CORE-10 booking_step_min, then read it from the store
export const DEFAULT_SLOT_MINUTES = 30
export function slotStep(hours: WeeklyHours, slot = DEFAULT_SLOT_MINUTES): number {
  const span = Math.max(...WEEKDAY.map((d) => (hours[d] ? mins(hours[d]!.close) - mins(hours[d]!.open) : 0)))
  if (!Number.isInteger(slot) || slot <= 0 || slot > span) throw new Error(`slotMinutes ${slot}: must be a whole number of minutes from 1 to the store's longest open day (${span})`)
  return slot
}

/** Does this customer 指名 their 担当? Decided once per customer, so a customer who nominated keeps the same staffer. */
export const isNominated = (recipe: Recipe, member: string) => !!recipe.realism && rng(`${recipe.id}|nominated|${member}`)() < recipe.realism.nominatedShare

/** The minute a customer of that day-part prefers, from the day's own hours: am = opening, pm = the middle of the day
 *  (the sort picks the nearest real start), eve = the last start that leaves one slot before closing. No fixed clock times. */
export function preferredStart(h: { open: string; close: string }, part: 'am' | 'pm' | 'eve', duration: number, slot: number): number {
  const [open, close] = [mins(h.open), mins(h.close)]
  return part === 'am' ? open : part === 'pm' ? (open + close) / 2 : close - duration - slot
}

export interface StoreCtx {
  storeId: string
  weeklyHours: WeeklyHours
  slotMinutes?: number // registry.json slotMinutes[storeId]; absent = DEFAULT_SLOT_MINUTES
  realismFrom?: string // the manifest's; absent = the plan as it always was
}

export function plan(recipe: Recipe, store: StoreCtx, today: string, epoch: string): Plan {
  const { id, counts: n } = recipe
  for (const k of ['staff', 'resources', 'menus', 'customers', 'packs'] as const)
    if (recipe[k].length !== n[k]) throw new Error(`recipe ${id}: ${k} has ${recipe[k].length} rows, registry says ${n[k]}`)
  const hours = store.weeklyHours
  if (!WEEKDAY.some((d) => hours[d])) throw new Error('the store has no open weekday')
  const step = slotStep(hours, store.slotMinutes)
  const from = addDays(epoch, -n.pastDays)
  const to = addDays(today, n.futureDays)
  const span = (utc(to) - utc(from)) / DAY
  const menu = (name: string) => recipe.menus.find((m) => m.name === name) ?? fail(`menu ${name} not in recipe ${id}`)
  const cleanup = Math.max(...recipe.resources.map((r) => r.cleanup_minutes))
  const real = recipe.realism
  if (store.realismFrom && !real) throw new Error(`recipe ${id}: realismFrom is set but registry.json has no realism block for it`)
  const cut = store.realismFrom ? (utc(store.realismFrom) - utc(from)) / DAY : Infinity // first day of realism planning

  // 1. Visits: customer → days (closed days roll to the next open day). Before the cut: the customer's own cadence,
  // exactly as always. From the cut: the type's rhythm (their cadence clamped into it, ± jitter per visit).
  const byDay = new Map<number, { c: RecipeCustomer; k: number }[]>()
  for (const c of recipe.customers) {
    const r = rng(`${id}|visits|${c.member}`)
    const jitter = c.every ? Math.max(1, Math.floor(c.every / 5)) : 0
    const add = (day: number, k: number) => byDay.set(day, [...(byDay.get(day) ?? []), { c, k }])
    let [k, last] = [0, -1]
    for (; k === 0 || c.every; k++) {
      let day = c.start + k * (c.every ?? 0) + (k ? Math.round((r() * 2 - 1) * jitter) : 0)
      day = Math.max(day, last + 1)
      while (!hoursOn(hours, addDays(from, day))) day++
      if (day > span || (k > 0 && day >= cut)) break
      add(day, k)
      last = day
    }
    if (!c.every || !real || cut > span || last < 0) continue // last < 0: the customer has not started yet
    const rr = rng(`${id}|rhythm|${c.member}`)
    const every = Math.min(Math.max(c.every, real.rhythmDays[0]), real.rhythmDays[1])
    for (; ; k++) {
      let day = Math.max(last + every + Math.round((rr() * 2 - 1) * real.rhythmJitter), cut, last + 1) // never before the cut
      while (!hoursOn(hours, addDays(from, day))) day++
      if (day > span) break
      add(day, k)
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
      for (let i = 0; i < cells; i++) if (busy.has(`${who}@${start + i * step}`)) return false
      return true
    }
    const realDay = d >= cut
    for (const { c, k } of byDay.get(d) ?? []) {
      const r = rng(`${id}|${c.member}|${date}`)
      const m = menu(k === 0 && c.isNew ? recipe.firstMenu : r() < 0.75 ? c.menu : c.alt)
      const u = r()
      const [noShow, cancel] = realDay ? [real!.noShowShare, real!.cancelShare] : [n.noShowShare, n.cancelShare]
      const status: AppointmentStatus = date >= today ? 'SCHEDULED' : u < noShow ? 'NO_SHOW' : u < noShow + cancel ? 'CANCELLED' : 'COMPLETED'
      const cells = Math.ceil((m.duration + cleanup) / step) // the bed is reset before the next guest
      const starts: number[] = []
      for (let s = mins(h.open); s + m.duration <= mins(h.close); s += step) starts.push(s)
      const want = preferredStart(h, c.time, m.duration, step)
      starts.sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)
      // weights drawn for every other card BEFORE the role filter: the same r() count as before keeps the bed picks stable;
      // the 受付 (ASSISTANT) never takes an overflow visit; the customer's own 担当 may be anyone
      const others = recipe.staff.filter((s) => s.name !== c.staff).map((s) => ({ s, w: r() })).filter((x) => x.s.role !== 'ASSISTANT').sort((a, b) => a.w - b.w).map((x) => x.s.name)
      const beds = recipe.resources.filter((x) => x.room_class === 'private' || !m.private).map((x) => ({ x, w: Number(x.room_class === 'private') + r() })).sort((a, b) => a.w - b.w).map((b) => b.x) // private room last
      // From the cut: a 指名 visit (a nominating customer, a menu that takes 指名) waits for their 担当 — no one else;
      // a フリー visit goes to whoever the seeded order puts first, their 担当 included.
      const nominated = isNominated(recipe, c.member) && m.nomination
      const pool = !realDay ? [c.staff, ...others] : nominated ? [c.staff] : [c.staff, ...others].map((s) => ({ s, w: r() })).sort((a, b) => a.w - b.w).map((x) => x.s)
      let slot: { s: number; staff: string; bed: string } | undefined
      for (const s of starts) {
        for (const staff of pool) {
          if (!free(staff, s, cells)) continue
          const bed = beds.find((b) => free(b.name, s, cells))
          if (bed) slot = { s, staff, bed: bed.name }
          if (slot) break
        }
        if (slot) break
      }
      if (!slot) continue // a full day: this visit is not planned (same answer on every run)
      for (let i = 0; i < cells; i++) for (const who of [slot.staff, slot.bed]) busy.add(`${who}@${slot.s + i * step}`)
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
