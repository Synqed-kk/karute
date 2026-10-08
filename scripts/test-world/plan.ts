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
// a 指名 customer only ever books their 担当. Legacy members keep their original cadence/epoch; appended members
// use the profile's cadence. Profile statuses and wished starts are key-seeded. Existing core rows are never updated.
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
  requestShare: number
  nominatedShare: number
  cancelShare: number
  noShowShare: number
  futureCancels: [number, number]
  rhythmDays: [number, number]
  rhythmJitter: number
}

/** One ご要望 line a customer types into the booking form. Unset conditions fit every booking. */
export interface RequestLine {
  text: string
  first?: boolean // true: only the customer's first visit ever · false: only a return visit
  themes?: string[] // only customers of these themes (RecipeCustomer.theme)
  nominated?: boolean // true: only a 指名 visit (booked with their own 担当) · false: only a フリー visit
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

export interface DayProfile {
  cadence: [number, number]
  menuMinutes: [number, number]
  hourWeights: Record<number, number>
  coverHours?: boolean
}
export interface RecipeData {
  namePool?: [name: string, kana: string, gender: 'female' | 'male'][]
  profile?: DayProfile
  legacyMembers?: string[]
  legacyPastDays?: number
  addedStaff?: string[] // ⚖ R5: staff added after the store's first load — a legacy member never draws them
  addedResources?: string[] // ⚖ E3: rooms added after the store's first load — a legacy member never draws them either
  policy: { weekly_hours: WeeklyHours }
  staff: { name: string; role: StaffRole }[]
  resources: { name: string; room_class: 'standard' | 'private'; cleanup_minutes: number; display_order: number }[]
  menus: { name: string; duration: number; price: number; category: string | null; nomination: boolean; private: boolean }[]
  firstMenu: string
  customers: RecipeCustomer[]
  packs: { member: string; size: number; unitPrice: number; atVisit: number }[]
  requests: RequestLine[] // the ご要望 pool (12–20 lines), born native in the register of a booking form
  karute(ctx: KaruteCtx): KaruteLine[] // 3–6 lines: 主訴 · 経過 · 施術内容 · 申し送り …
}
export type Recipe = RecipeData & { id: string; storeId?: string; counts: Counts; realism?: Realism }

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
  booked_price: number
  cancelReason: string | null
  status: AppointmentStatus
  request: string | null // the customer's ご要望 line (null = the form was left empty)
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

/** The ご要望 line of one booking (a function of its key): null for the share of forms left empty. */
export function requestFor(recipe: Recipe, c: RecipeCustomer, key: string, first: boolean, nominated: boolean): string | null {
  if (!recipe.realism) return null
  const r = rng(`${key}|request`)
  if (r() >= recipe.realism.requestShare) return null
  const fits = recipe.requests.filter((l) => (l.first ?? first) === first && (!l.themes || l.themes.includes(c.theme)) && (l.nominated ?? nominated) === nominated)
  // a customer mostly writes about their own concern: a line of their theme weighs 3, a line anyone could write 1
  let u = r() * fits.reduce((n, l) => n + (l.themes ? 3 : 1), 0)
  return fits.find((l) => (u -= l.themes ? 3 : 1) < 0)?.text ?? null
}

/** ⚖ R5: the ONE legacy predicate — a member of an original store from before FILL 2 (the planner, apply's today
 *  reconcile and every reader ask this, never their own copy). */
export const isLegacyMember = (recipe: Pick<Recipe, 'legacyMembers'>, member: string): boolean => !!recipe.legacyMembers?.includes(member)

/** The ONE manual-edit guard on a booking's status: no person set it (status_set_by empty), or the loader's own scripts
 *  did (a status_reason starting テストデータ — close-out's write). realism.ts and apply's today reconcile both ask this. */
export const loaderSet = (a: { status_set_by?: string | null; status_reason?: string | null }): boolean =>
  a.status_set_by == null || (a.status_reason ?? '').startsWith('テストデータ')

/** ⚖ G-P1 (S88): the ONE 「is this row still the planned booking?」 check — its saved interval is the planned one (starts_at
 *  and ends_at on the planned startsAt / endsAt minute, so the planned duration too) and, when the caller knows the
 *  planned staff's id, the same staff_id. A row whose time, duration or staff differs was moved by a person: the loader
 *  leaves its status alone. apply's today reconcile (todayStatusFixes) and close-out.ts both ask this, never their own copy. */
export const stillPlanned = (row: { starts_at: string; ends_at?: string | null; staff_id?: string | null }, p: Pick<PlannedAppointment, 'startsAt' | 'endsAt'>, staffId?: string | null): boolean =>
  Math.floor(Date.parse(row.starts_at) / 60_000) === Math.floor(Date.parse(p.startsAt) / 60_000)
  && Math.floor(Date.parse(row.ends_at ?? '') / 60_000) === Math.floor(Date.parse(p.endsAt) / 60_000)
  && (staffId == null || row.staff_id === staffId)

/** A loader booking's notes: the tag first (every reader matches /\[(tw:[^\]]+)\]/ or '[tw:'), then the ご要望 line. */
/** ⚖ R17: the cancel reason in notes is the app's own Japanese label (messages/ja.json), never the slug; realism.ts stays the status_reason writer. */
export const CANCEL_LABELS: Record<string, string> = { 'cancel-advance-contact': '事前連絡あり', 'cancel-same-day-contact': '当日連絡あり', 'cancel-salon-initiated': '店舗都合' }
export const bookingNotes = (a: Pick<PlannedAppointment, 'key' | 'request'> & { cancelReason?: string | null }) => `テストデータ [${a.key}]${a.request ? `\n${a.request}` : ''}${a.cancelReason ? `\nキャンセル理由：${CANCEL_LABELS[a.cancelReason] ?? a.cancelReason}` : ''}`
/** ⚖ G2 (S87): the ONE 「is this note ours?」 check — the bare tag, the labelled bookingNotes(a), or the line the loader
 *  wrote before the cancel label existed (tag + ご要望, no キャンセル理由). Any other text is a person's edit. */
export const isGeneratedNote = (notes: string | null | undefined, a: Pick<PlannedAppointment, 'key' | 'request'> & { cancelReason?: string | null }): boolean =>
  notes === `テストデータ [${a.key}]` || notes === bookingNotes(a) || notes === bookingNotes({ ...a, cancelReason: null })

/** The minute a customer of that day-part prefers, from the day's own hours: am = opening, pm = the middle of the day
 *  (the sort picks the nearest real start), eve = the last start that leaves one slot before closing. No fixed clock times. */
export function preferredStart(h: { open: string; close: string }, part: 'am' | 'pm' | 'eve', duration: number, slot: number): number {
  const [open, close] = [mins(h.open), mins(h.close)]
  return part === 'am' ? open : part === 'pm' ? (open + close) / 2 : close - duration - slot
}

export interface StoreCtx {
  storeId: string
  keyPrefix?: string
  weeklyHours: WeeklyHours
  slotMinutes?: number // registry.json slotMinutes[storeId]; absent = DEFAULT_SLOT_MINUTES
  boardMinute?: number // defaults to the fixture board pin, 13:24 JST
  realismFrom?: string // the manifest's; absent = the plan as it always was
  pastDays?: number // ⚖ R6: the manifest's recorded pastDays (set at first apply); absent = the recipe's
  // ⚖ E2: the last day already in core from the pre-FILL-2 planner (the manifest's legacyThrough). A legacy member's row on or
  // before it keeps its origin/main time and staff (R5); after it — or always, for a store with no such day — it follows the side rule (R4).
  legacyThrough?: string | null
}

export function plan(recipe: Recipe, store: StoreCtx, today: string, epoch: string): Plan {
  const { id, counts: n } = recipe
  for (const k of ['staff', 'resources', 'menus', 'customers', 'packs'] as const)
    if (recipe[k].length !== n[k]) throw new Error(`recipe ${id}: ${k} has ${recipe[k].length} rows, registry says ${n[k]}`)
  const hours = store.weeklyHours
  if (!WEEKDAY.some((d) => hours[d])) throw new Error('the store has no open weekday')
  const step = slotStep(hours, store.slotMinutes)
  const pastDays = store.pastDays ?? n.pastDays // ⚖ R6: an applied store keeps the pastDays its manifest recorded
  const from = addDays(epoch, -pastDays)
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
  const legacy = { has: (member: string) => isLegacyMember(recipe, member) } // ⚖ R5: a legacy member keeps the origin/main planner's paths
  const open = (day: number) => !!hoursOn(hours, addDays(from, day))
  for (const c of recipe.customers) {
    const customerCut = recipe.profile && !isLegacyMember(recipe, c.member) ? Infinity : cut
    const r = rng(`${id}|visits|${c.member}`)
    const offset = isLegacyMember(recipe, c.member) ? pastDays - (recipe.legacyPastDays ?? pastDays) : 0
    const jitter = c.every ? Math.max(1, Math.floor(c.every / 5)) : 0
    const add = (day: number, k: number) => byDay.set(day, [...(byDay.get(day) ?? []), { c, k }])
    let [k, last] = [0, -1]
    for (; k === 0 || c.every; k++) {
      let day = offset + c.start + k * (c.every ?? 0) + (k ? Math.round((r() * 2 - 1) * jitter) : 0)
      day = Math.max(day, last + 1)
      // ⚖ R11: a profile visit on a closed day moves to the open day before or after it, by key hash (no Wednesday pile-up)
      if (recipe.profile && !legacy.has(c.member) && !open(day) && rng(`${id}|roll|${c.member}|${k}`)() < 0.5) {
        let back = day - 1
        while (back > last && !open(back)) back--
        if (back > last) day = back
      }
      while (!open(day)) day++
      if (day > span || (k > 0 && day >= customerCut)) break
      add(day, k)
      last = day
    }
    if (!c.every || !real || customerCut > span || last < 0) continue // last < 0: the customer has not started yet
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
    if (!recipe.menus.some((x) => x.duration <= mins(h.close) - mins(h.open))) { noMenuFits(store.storeId, h); continue } // ⚖ R19
    const realDay = d >= cut
    const boardMinute = store.boardMinute ?? 13 * 60 + 24
    // ⚖ R7: no pin rule on any day — rows cross 13:24 freely; the day's first profile visit only PREFERS a start across it,
    // so today has at least one live row. Day-invariant on purpose: a later `today` re-plans this day identically
    // (fill.test.ts "a week later, strictly a superset of keys" / "the past never shifts").
    const pinDay = !!recipe.profile
    const visits = byDay.get(d) ?? []
    // ⚖ R13: the coverage pass (an hour without a start first) takes at most a quarter of the day's visits
    const coverQuota = recipe.profile?.coverHours ? Math.floor(visits.length / 4) : 0
    let covered = 0
    let uncovered = new Set(Array.from({ length: Math.ceil((mins(h.close) - mins(h.open)) / 60) }, (_, i) => Math.floor(mins(h.open) / 60) + i))
    let pinTaken = false
    const sides = sidesOf(recipe.staff.map((s) => s.name), mins(h.open), mins(h.close))
    for (const { c, k } of visits) {
      const profiled = !!recipe.profile && !legacy.has(c.member)
      const r = rng(`${id}|${c.member}|${date}`)
      const first = k === 0 && c.isNew
      const m = menu(first ? recipe.firstMenu : r() < 0.75 ? c.menu : c.alt)
      const u = r()
      const [noShow, cancel] = realDay ? [real!.noShowShare, real!.cancelShare] : [n.noShowShare, n.cancelShare]
      const key = `tw:${store.keyPrefix ?? id}:${c.member}:${date}`
      const outcome = profiled ? rng(`${key}|status`)() : u
      const status: AppointmentStatus = date >= today ? 'SCHEDULED' : outcome < (profiled ? 0.02 : noShow) ? 'NO_SHOW' : outcome < (profiled ? 0.06 : noShow + cancel) ? 'CANCELLED' : 'COMPLETED'
      const cells = Math.ceil((m.duration + cleanup) / step) // the bed is reset before the next guest
      const crosses = (s: number) => s <= boardMinute && boardMinute < s + m.duration
      const starts: number[] = []
      for (let s = mins(h.open); s + m.duration <= mins(h.close); s += step) {
        starts.push(s)
      }
      if (!starts.length) continue // the menu cannot fit this store's day
      const pin = pinDay && profiled && !pinTaken ? starts.find(crosses) : undefined
      const cover = profiled && covered < coverQuota && pin === undefined
      const want = !profiled ? preferredStart(h, c.time, m.duration, step) : pin ?? weightedStart(h, m.duration, recipe.profile!, key, cover ? uncovered : undefined)
      starts.sort((a, b) => (cover ? Number(!uncovered.has(Math.floor(a / 60))) - Number(!uncovered.has(Math.floor(b / 60))) : 0)
        || Math.abs(a - want) - Math.abs(b - want) || a - b)
      // weights drawn for every other card BEFORE the role filter: the same r() count as before keeps the bed picks stable;
      // the 受付 (ASSISTANT) never takes an overflow visit; the customer's own 担当 may be anyone
      const others = (profiled ? recipe.staff : recipe.staff.filter((s) => !recipe.addedStaff?.includes(s.name))).filter((s) => s.name !== c.staff).map((s) => ({ s, w: r() })).filter((x) => x.s.role !== 'ASSISTANT').sort((a, b) => a.w - b.w).map((x) => x.s.name)
      const beds = (profiled ? recipe.resources : recipe.resources.filter((x) => !recipe.addedResources?.includes(x.name))).filter((x) => x.room_class === 'private' || !m.private).map((x) => ({ x, w: Number(x.room_class === 'private') + r() })).sort((a, b) => a.w - b.w).map((b) => b.x) // private room last
      // From the cut: a 指名 visit (a nominating customer, a menu that takes 指名) waits for their 担当 — no one else;
      // a フリー visit goes to whoever the seeded order puts first, their 担当 included.
      const nominated = isNominated(recipe, c.member) && m.nomination
      const pool = !realDay ? [c.staff, ...others] : nominated ? [c.staff] : [c.staff, ...others].map((s) => ({ s, w: r() })).sort((a, b) => a.w - b.w).map((x) => x.s)
      // ⚖ E2: a legacy row not yet in core (after legacyThrough) follows the side rule too; one in core keeps its old time and staff
      const sided = profiled || (legacy.has(c.member) && !(store.legacyThrough && date <= store.legacyThrough))
      let slot: { s: number; staff: string; bed: string } | undefined
      for (const s of starts) {
        for (const staff of pool) {
          const side = sided ? sides?.get(staff) : undefined // ⚖ R4: a profile visit only inside the person's side
          if (side && (s < side.start || s + m.duration > side.end)) continue
          if (!free(staff, s, cells)) continue
          const bed = beds.find((b) => free(b.name, s, cells))
          if (bed) slot = { s, staff, bed: bed.name }
          if (slot) break
        }
        if (slot) break
      }
      if (!slot) continue // a full day: this visit is not planned (same answer on every run)
      for (let i = 0; i < cells; i++) for (const who of [slot.staff, slot.bed]) busy.add(`${who}@${slot.s + i * step}`)
      if (pinDay && profiled && crosses(slot.s)) pinTaken = true
      if (cover) covered++
      uncovered = new Set([...uncovered].filter((hour) => hour !== Math.floor(slot.s / 60)))
      appointments.push({
        key, member: c.member, staff: slot.staff, resource: slot.bed, menu: m.name, date,
        startsAt: jstIso(date, slot.s), endsAt: jstIso(date, slot.s + m.duration), duration: m.duration, price: m.price, booked_price: m.price, status,
        cancelReason: status === 'CANCELLED' ? cancelReasonFor(key) : null,
        request: requestFor(recipe, c, key, first, nominated && slot.staff === c.staff),
      })
    }
  }

  if (recipe.profile) {
    const now = jstIso(today, store.boardMinute ?? 13 * 60 + 24)
    // ⚖ R7: today only, every profile row across the pin is IN_PROGRESS; a legacy row keeps the status it was written with
    for (const a of appointments) if (a.date === today && !legacy.has(a.member))
      a.status = a.startsAt <= now && now < a.endsAt ? 'IN_PROGRESS' : a.startsAt < now ? 'COMPLETED' : 'SCHEDULED'
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
      key: `tw:${store.keyPrefix ?? id}:${p.member}:pack:1`, member: p.member, size: p.size, unitPrice: p.unitPrice, purchasedOn: bought.date,
      staff: bought.staff, redeem: visits.slice(p.atVisit - 1, p.atVisit - 1 + p.size).map((v) => v.key),
    })
  }

  return { window: { from, to }, staff: recipe.staff, resources: recipe.resources, menus: recipe.menus, customers: recipe.customers, packs, appointments, karutes }
}

/** ⚖ R4 — THE SIDE RULE (one rule, two halves; the other half is src/business/lib/practice-door/sample-day.ts shiftDay):
 *  on a day longer than 10 h the store's staff, sorted by NAME, alternate early (open..open+9h) and late (close−9h..close)
 *  by index parity — both sides staffed from two people on, one person = early; a day longer than 18 h adds a middle side
 *  (index % 3). The planner gives a profile visit to a person only inside their side. ≤ 10 h: no sides.
 *  ⚖ S87 Q1 — the parity set is the STYLIST + ASSISTANT people only (the roles the loader's recipes staff). Everyone else —
 *  OWNER, ADMIN (the lead's call: a manager works the whole day, as the owner), a card with no role, a floating or
 *  unassigned card — gets NO side and works the whole day (open..close), so an extra card never flips anyone's parity. */
export function sidesOf(names: readonly string[], open: number, close: number): Map<string, { start: number; end: number }> | null {
  if (close - open <= 10 * 60) return null
  const mid = Math.floor((open + close) / 2)
  const sides = [{ start: open, end: open + 540 }, { start: close - 540, end: close }, ...(close - open > 18 * 60 ? [{ start: mid - 270, end: mid + 270 }] : [])]
  return new Map([...names].sort().map((name, i) => [name, sides[i % sides.length]]))
}

const warned = new Set<string>()
/** ⚖ R19: one line per store and hours when an open day fits no menu (an overnight or too-short day plans nothing). */
function noMenuFits(storeId: string, h: { open: string; close: string }) {
  const k = `${storeId} ${h.open}–${h.close}`
  if (!warned.has(k)) (warned.add(k), console.warn(`plan: store ${k}: no menu fits the open day, nothing planned on it`))
}

function fail(msg: string): never {
  throw new Error(msg)
}

/** Stratified gym coverage uses the same weighted draw over hours still without a start. */
function weightedStart(h: { open: string; close: string }, duration: number, profile: DayProfile, key: string, uncovered?: Set<number>): number {
  const first = mins(h.open), last = mins(h.close) - duration
  const hours = Array.from({ length: Math.floor(last / 60) - Math.floor(first / 60) + 1 }, (_, i) => Math.floor(first / 60) + i)
  const pending = uncovered ? hours.filter((hour) => uncovered.has(hour)) : []
  const choices = (pending.length ? pending : hours).map((hour) => ({ hour, weight: profile.hourWeights[hour] ?? 1 }))
  const r = rng(`${key}|start`)
  let u = r() * choices.reduce((n, h) => n + h.weight, 0)
  const hour = choices.find((h) => (u -= h.weight) < 0)!.hour
  return Math.max(first, Math.min(last, hour * 60 + Math.floor(r() * 60)))
}

function cancelReasonFor(key: string): string {
  const u = rng(`${key}|cancel-reason`)()
  return u < 0.7 ? 'cancel-advance-contact' : u < 0.9 ? 'cancel-same-day-contact' : 'cancel-salon-initiated'
}
