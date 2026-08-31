// AI相談 — the room's derivations. Every judgement this page shows is made here
// ONCE and rendered wherever it is needed, so the badge on a card and the order
// the feed sorts in can never disagree (⚖ A8: more than one home for one verdict
// is the disease, not the symptom).
//
// PURE, AND THAT IS THE POINT. Nothing here reads the clock, touches data or
// knows React: the room's server assembly hands these functions the rows the
// store-clamped fixture door returned, and the room's SCREEN calls the same
// predicates so what a reader dismisses is narrowed by exactly the rules the
// count was computed with.
//
// ⚖ ONE TRUTH, TWO DOORS. The Q&A this room renders is the phone app's Ask AI.
// Its capability rule, its request/response shape, its context modes, its
// context label and its ephemerality are the phone's contract — quoted here by
// SHAPE with the file:line it was read at, never imported, because Business
// territory may not reach into `src/lib/ai/*`, `src/lib/app-api/*`,
// `src/components/ai/*` or `src/app/api/ai/*` runtime (packet §3).

import {
  type AskAiCategory,
  type AskAiSourceRef,
  type FixtureSignal,
  type FixtureSuggestion,
  type FixtureTemplate,
  type FixtureTurn,
} from './fixtures-ask-ai'
import { type FixtureAppointment, type FixtureCustomer, type FixtureMenu, type FixtureStaff } from './fixtures'
import { type FixtureKaruteRecord } from './fixtures-karute'
import { type FixtureThread } from './fixtures-inbox'
import { hhmm } from './today-board'

// ── who may consult ─────────────────────────────────────────────────────────

/** What a role may do in this room. ONE question, and the phone already answers
 *  it: Ask AI is gated by a single shared capability rule,
 *  `ASK_AI_REQUIRED_CAPABILITIES = ['customers.view']`
 *  (`src/lib/auth/permissions.ts:170-177`), consumed by all four shipped
 *  surfaces — the page redirects fail-closed to the dashboard
 *  (`src/app/[locale]/(app)/ask-ai/page.tsx:34-37`), the cookie chat route 403s
 *  BEFORE the rate limit, the store scope, the settings, the context and the
 *  model (`src/app/api/ai/chat/route.ts:33-41`), and both facades loop the same
 *  constant through `ensureCapability`.
 *
 *  ⚖ Liam 7/30: 受付 (Front Desk) KEEPS Ask AI — the rule is `customers.view`,
 *  which the front-desk preset holds. So the ROOM admits the same persona set
 *  the phone's role presets resolve to, and denies the blank custom role, which
 *  is the pinned denial on the phone side (ask-ai-authz.test.ts). */
export interface AskAiAccess {
  consult: boolean
}

const NO_ACCESS: AskAiAccess = { consult: false }

/** The personas that resolve to a preset holding `customers.view`. The Business
 *  world's own role vocabulary; the two the demo world can be read by are
 *  店舗管理者 (the operator) and スタッフ. */
const ACCESS_BY_ROLE: Record<string, AskAiAccess> = {
  オーナー: { consult: true },
  店舗管理者: { consult: true },
  上級スタッフ: { consult: true },
  スタッフ: { consult: true },
  受付: { consult: true },
}

/** FAIL-CLOSED, and on this table's OWN rows only. `Object.hasOwn` rather than a
 *  bare index: a role named `constructor` or `__proto__` resolves through the
 *  prototype chain and every flag would read `undefined` — falsy by luck rather
 *  than by rule (the room-4 F-M1 lesson, carried).
 *
 *  ⚠ A BLANK CUSTOM ROLE IS THE DENIED CASE, and it is denied HERE rather than
 *  by hiding a rendered surface: the props assembly reads this verdict BEFORE it
 *  reads anything of the room's data, so a denied reader's payload contains no
 *  suggestion, no question, no answer and no customer's name to hide. */
export function accessFor(role: string): AskAiAccess {
  return Object.hasOwn(ACCESS_BY_ROLE, role) ? ACCESS_BY_ROLE[role] : NO_ACCESS
}

/** What the page says out loud to a reader it cannot serve. One sentence naming
 *  the real rule, never a generic 「権限がありません」. */
export function permissionNotice(access: AskAiAccess): string[] {
  if (access.consult) return []
  return [
    'AI相談を使える権限がありません。AI相談はお客様の情報を読み取って回答するため、顧客を閲覧できる権限が必要です。',
    'この画面には、この店舗の提案も相談の内容も読み込んでいません。権限の変更は店舗管理者にご相談ください。',
  ]
}

// ── the four categories ─────────────────────────────────────────────────────

/** The canon AI設定 room's own four switches (fable-settings-ai.html § AI相談).
 *  The dials that turn them on and the 積極度 that ranks them live in the 設定
 *  room, which builds LAST — registry ⑦, and the trace card says 未接続 until it
 *  lands rather than this room inventing a default it does not have. */
export const CATEGORY_LABEL: Record<AskAiCategory, string> = {
  customer_follow: '顧客フォロー',
  staffing: 'スタッフ配置・欠勤対応',
  booking: '予約・空き待ち案内',
  vip: 'VIP・ロイヤルティ',
}

/** THE ROOMS A CARD MAY POINT AT — the segments that are LIVE at this tip. A
 *  suggestion whose deep link is not on this list is a card offering a door that
 *  does not open, which is the dead-lever class (⚖ §A-2). Pinned, and
 *  mutation-tested: pointing the plane at a 準備中 segment must fail the round. */
export const LIVE_SEGMENTS: Record<string, string> = {
  today: '今日の運営を開く',
  reservations: '予約一覧を開く',
  customers: '顧客を開く',
  inbox: '受信トレイを開く',
  shifts: 'スタッフ・シフトを開く',
  register: '売上・レジを開く',
  analytics: '売上分析を開く',
  karute: 'カルテを開く',
}

// ── the world this room joins ───────────────────────────────────────────────

/** Everything the derivations read, and every array is ALREADY store-clamped by
 *  the door (`data.ts`) before it gets here. The three appointment slices exist
 *  because the CLOCK lives in the props assembly (the family law): this module
 *  never asks what day it is, it is TOLD which rows are today's and which are
 *  still ahead. */
export interface AskAiWorld {
  appointments: FixtureAppointment[]
  todayAppointments: FixtureAppointment[]
  upcomingAppointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  records: FixtureKaruteRecord[]
  threads: FixtureThread[]
}

/** The world, indexed once per derivation pass. Exported because the resolvers
 *  below take it: an exported function may not name a private type, and the
 *  suite calls `evidenceLineOf` / `urgencyOf` directly to pin the two rules that
 *  decide what a card SAYS and whether it is an exception. */
export interface AskAiIndex {
  appointment: Map<string, FixtureAppointment>
  customer: Map<string, FixtureCustomer>
  staff: Map<string, FixtureStaff>
  menu: Map<string, FixtureMenu>
  record: Map<string, FixtureKaruteRecord>
  thread: Map<string, FixtureThread>
  /** Every customer the LENS can see at all — the ones a clamped booking names.
   *  A customer row carries no `store_id` (CM-9), so this is what "in this
   *  store" means for a person, and it is the same rule the カルテ room's own
   *  reveal candidates are derived with. */
  lensCustomers: Set<string>
}

export function askAiIndex(world: AskAiWorld): AskAiIndex {
  return {
    appointment: new Map(world.appointments.map((a) => [a.id, a])),
    customer: new Map(world.customers.map((c) => [c.id, c])),
    staff: new Map(world.staff.map((s) => [s.id, s])),
    menu: new Map(world.menus.map((m) => [m.id, m])),
    record: new Map(world.records.map((r) => [r.id, r])),
    thread: new Map(world.threads.map((t) => [t.id, t])),
    lensCustomers: new Set(world.appointments.map((a) => a.customer_id).filter(Boolean)),
  }
}

/** ⚖ THE STORE LENS IS THE GATE, AND IT IS APPLIED AT THE JOIN. A reference is
 *  in lens when the record it points at reaches the lens through a booking the
 *  clamped door already returned — so another store's suggestion, another
 *  store's 根拠 and another store's 出典 row are not filtered out of the props:
 *  they never enter them (⚖ the 8/17 isolation law, above serialization).
 *
 *  The 空き待ち case is the one thread with NO booking, which is what a 空き待ち
 *  IS — a request for a slot that does not exist yet. Its store is therefore its
 *  customer's own affiliation, exactly as the 受信トレイ room resolves it. */
function refInLens(ref: AskAiSourceRef, ix: AskAiIndex): boolean {
  switch (ref.collection) {
    case 'bookings':
      return ix.appointment.has(ref.id)
    case 'karuteRecords': {
      const rec = ix.record.get(ref.id)
      return rec ? ix.appointment.has(rec.appointment_id) : false
    }
    case 'inbox': {
      const t = ix.thread.get(ref.id)
      if (!t) return false
      return t.appointment_id ? ix.appointment.has(t.appointment_id) : ix.lensCustomers.has(t.customer_id)
    }
    case 'customers':
      return ix.lensCustomers.has(ref.id)
  }
}

const personOf = (id: string | null | undefined, ix: AskAiIndex): string | null =>
  id ? (ix.customer.get(id)?.name ?? null) : null

const staffNameOf = (id: string | null, ix: AskAiIndex): string =>
  (id ? ix.staff.get(id)?.full_name : null) ?? '担当未定'

const menuNameOf = (id: string | null, ix: AskAiIndex): string =>
  (id ? ix.menu.get(id)?.name : null) ?? 'メニュー未定'

/** ⚖ EVIDENCE LINES ARE HUMAN STORIES (canon's own resolvers; the 8/25
 *  audit-display law, carried by the parity feed). A person reads WHO and WHAT,
 *  never a row id — so every id printed here is a HUMAN-SHAPED one the shop
 *  already says out loud: カルテ番号 `K-0001`, 予約番号 `R-4826`. The machine ids
 *  (`apt-26`, `inb-wait`, `cus-08`) resolve through the world and are never
 *  rendered.
 *
 *  ⚠ AND NO DATE APPEARS IN A LINE. This module is pure — it holds no clock and
 *  no formatter — so an evidence line built here can only carry facts that are
 *  already words. The day a card is about is the DESTINATION room's to show,
 *  which is where the reader is going anyway.
 *
 *  `null` when the reference does not resolve: a line that fell back to
 *  「collection/id」 would be exactly the raw id the law forbids, so an
 *  unresolvable source is DROPPED instead. */
export function evidenceLineOf(ref: AskAiSourceRef, ix: AskAiIndex): string | null {
  switch (ref.collection) {
    case 'karuteRecords': {
      const rec = ix.record.get(ref.id)
      if (!rec) return null
      const appt = ix.appointment.get(rec.appointment_id)
      if (!appt) return null
      const name = personOf(appt.customer_id, ix)
      if (!name) return null
      return `カルテ ${rec.id}・${name}様（担当 ${staffNameOf(appt.staff_id, ix)} / ${menuNameOf(appt.menu_id, ix)}）`
    }
    case 'bookings': {
      const appt = ix.appointment.get(ref.id)
      if (!appt) return null
      const name = personOf(appt.customer_id, ix)
      if (!name) return null
      return `予約 ${appt.display_no}・${name}様（担当 ${staffNameOf(appt.staff_id, ix)} / ${menuNameOf(appt.menu_id, ix)}）`
    }
    case 'inbox': {
      const t = ix.thread.get(ref.id)
      if (!t) return null
      const name = personOf(t.customer_id, ix)
      if (!name) return null
      const due = t.due === null ? '' : ` / 回答期限 ${hhmm(t.due)}`
      return `受信トレイ・${name}様（${t.subject}${due}）`
    }
    case 'customers': {
      const name = personOf(ref.id, ix)
      if (!name) return null
      const c = ix.customer.get(ref.id)!
      return `顧客 ${c.member_number}・${name}様`
    }
  }
}

/** ⚖ URGENCY IS NEVER INVENTED COPY (canon's own rule, as a pure function). A
 *  badge exists only when the REFERENCED RECORD ITSELF carries a hard fact:
 *  · an 受信トレイ thread with its own 回答期限 (`due`) — canon's inbox 期限 rule;
 *  · a booking still sitting in 仮押さえ (`board_state: 'hold'`) — a slot the
 *    customer has not accepted, which is canon's 「unresolved」 rule at the one
 *    shape this world holds it in.
 *  Everything else renders with EQUAL WEIGHT and no badge, which is what keeps
 *  the exception meaningful. */
export function urgencyOf(ref: AskAiSourceRef, ix: AskAiIndex): string | null {
  if (ref.collection === 'inbox') {
    const t = ix.thread.get(ref.id)
    return t && t.due !== null ? `回答期限 ${hhmm(t.due)}` : null
  }
  if (ref.collection === 'bookings') {
    const a = ix.appointment.get(ref.id)
    return a && a.board_state === 'hold' ? '要対応' : null
  }
  return null
}

export interface FeedCard {
  id: string
  category: AskAiCategory
  categoryLabel: string
  text: string
  badge: string | null
  evidence: string
  segment: string
  linkLabel: string
}

/** EXCEPTION-FIRST, STABLE (canon's own sort, and 受信トレイ's convention):
 *  badged rows lead, and inside each tier the plane's own order is untouched.
 *  A comparator over a boolean is the whole of it — `Array.prototype.sort` is
 *  required to be stable, so nothing else is needed to keep the order. */
export function feedOrder(cards: FeedCard[]): FeedCard[] {
  return [...cards].sort((a, b) => (a.badge ? 0 : 1) - (b.badge ? 0 : 1))
}

/** THE FEED. A suggestion becomes a card only when its source resolves INSIDE
 *  the lens and into a real human sentence; anything else is dropped before the
 *  model exists, so the props a browser receives contain no other store's row
 *  and no unresolved id. */
export function buildFeed(suggestions: FixtureSuggestion[], world: AskAiWorld): FeedCard[] {
  const ix = askAiIndex(world)
  const cards: FeedCard[] = []
  for (const s of suggestions) {
    if (!refInLens(s.sourceRef, ix)) continue
    const evidence = evidenceLineOf(s.sourceRef, ix)
    if (evidence === null) continue
    const linkLabel = LIVE_SEGMENTS[s.deepLink]
    if (!linkLabel) continue
    cards.push({
      id: s.id,
      category: s.category,
      categoryLabel: CATEGORY_LABEL[s.category],
      text: s.text,
      badge: urgencyOf(s.sourceRef, ix),
      evidence,
      segment: s.deepLink,
      linkLabel,
    })
  }
  return feedOrder(cards)
}

/** ⚖ THE FEED IS WINDOWED, THE カルテ ROOM'S OWN SHAPE (L4-2). Twenty-five
 *  suggestions rendered a 9,500px monotonous rail and the two-zone desk
 *  collapsed past the bottom of the consultation column. The family already has
 *  the answer — a first window, then a quiet さらに表示 that reveals the next one
 *  (`karute.ts` `windowRows` / `KaruteScreen` `kr-more`) — so this room adopts it
 *  rather than inventing a pager or, worse, a scroller (⚖ page-scroll: the window
 *  SHORTENS the page, it does not put an axis on a box).
 *
 *  SIX, because that is the demo world's own 銀座 feed: the reader opens on a
 *  complete desk and the control only appears in a store that genuinely has more.
 *
 *  ⚖ 8/25 — THE REMAINDER IS LABELLED, AND IT IS DERIVED HERE. The count above
 *  the feed stays the TOTAL and this says what is still behind the walk, so the
 *  two can never disagree: both come out of one call, on one list (⚖ A8). The
 *  list handed in is what the reader can still see — dismissing a card takes it
 *  out of the total AND out of this arithmetic in the same pass. */
export const FEED_WINDOW = 6

export function windowFeed<T>(cards: T[], steps: number): { shown: T[]; remaining: number; moreLabel: string | null } {
  const shown = cards.slice(0, Math.max(1, Math.floor(steps)) * FEED_WINDOW)
  const remaining = cards.length - shown.length
  return { shown, remaining, moreLabel: remaining > 0 ? `さらに表示（残り${remaining}件）` : null }
}

// ── the consultation ────────────────────────────────────────────────────────

export interface AnswerSource {
  ref: string
  line: string
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  sources: AnswerSource[]
  /** ⚖ 8/25 — the count says WHAT it counts, and it counts the rows printed
   *  under it. `null` when there are none, never 「出典 0件」. */
  sourceCountLabel: string | null
  /** The shipped `context_label`, mirrored: present ONLY when the request
   *  carried a hint AND in-scope rows came back
   *  (`src/lib/ai/karute-chat.ts:86-101`). */
  contextLabel: string | null
}

/** The customer-hint label the shipped contract composes
 *  (`karute-chat.ts:88-92`): the person's name and how many of their records the
 *  scope could actually read. `null` when the lens can read none — the contract's
 *  own rule (`customerName` is non-null only when in-scope rows exist), so the
 *  desk can never name a customer the lens cannot see. */
function customerContextLabel(customerId: string, ix: AskAiIndex, world: AskAiWorld): string | null {
  const name = personOf(customerId, ix)
  if (!name) return null
  const n = world.records.filter((r) => ix.appointment.get(r.appointment_id)?.customer_id === customerId).length
  return n === 0 ? null : `${name}様のカルテ${n}件`
}

/** The 本日 hint label (`karute-chat.ts:98-101`): the ROSTER size — distinct
 *  customers booked today under this lens — not the number of records that came
 *  back. */
export function todayRosterSize(world: AskAiWorld): number {
  return new Set(world.todayAppointments.map((a) => a.customer_id).filter(Boolean)).size
}

export function buildConversation(turns: FixtureTurn[], world: AskAiWorld): ConversationTurn[] {
  const ix = askAiIndex(world)
  return turns.map((t) => {
    const sources: AnswerSource[] = []
    for (const ref of t.sources) {
      if (!refInLens(ref, ix)) continue
      const line = evidenceLineOf(ref, ix)
      if (line === null) continue
      sources.push({ ref: `${ref.collection}:${ref.id}`, line })
    }
    const contextLabel =
      t.contextRef && t.contextRef.collection === 'customers' && refInLens(t.contextRef, ix)
        ? customerContextLabel(t.contextRef.id, ix, world)
        : null
    return {
      id: t.id,
      role: t.role,
      text: t.text,
      sources,
      sourceCountLabel: sources.length === 0 ? null : `出典 ${sources.length}件`,
      contextLabel,
    }
  })
}

// ── the two prompt systems (§2b-6 — both are contract, and they differ) ─────

export interface SignalChip {
  id: string
  tag: string
  title: string
  /** What a tap puts in the composer. */
  prompt: string
  /** The `context_label` the tap's request would come back with. */
  contextLabel: string | null
}

/** 今日のヒント — DATA-DRIVEN, and a tap SENDS with a context hint on the phone
 *  (`AIAssistantView.tsx:147` → `send(s.prompt, s.contextHint)`). The desk keeps
 *  both halves honestly: the tap fills the composer AND walks the send path,
 *  which in a sealed room ends at the refusal naming registry ① — with the
 *  context label the request would have carried shown beside it.
 *
 *  Every string is composed HERE, from the world, for the same reason an
 *  evidence line is: a plane holding 「見本 かえる様（13:00）」 would be restating
 *  the booking's own facts. */
export function buildSignals(signals: FixtureSignal[], world: AskAiWorld): SignalChip[] {
  const ix = askAiIndex(world)
  const out: SignalChip[] = []
  for (const s of signals) {
    if (s.kind === 'today_roster') {
      const n = todayRosterSize(world)
      if (n === 0) continue
      out.push({
        id: s.id,
        tag: '本日の予約',
        title: `本日ご来店の${n}名のお客様の要点まとめ`,
        prompt: '本日ご来店予定のお客様それぞれについて、前回の要点と本日の注意点をまとめてください。',
        contextLabel: `本日ご来店のお客様${n}名のカルテ`,
      })
      continue
    }
    const ref = s.subjectRef
    if (!ref || !refInLens(ref, ix)) continue
    if (s.kind === 'revisit_followup' && ref.collection === 'karuteRecords') {
      const rec = ix.record.get(ref.id)
      const appt = rec ? ix.appointment.get(rec.appointment_id) : undefined
      const name = personOf(appt?.customer_id, ix)
      if (!name || !appt) continue
      out.push({
        id: s.id,
        tag: '再来のご提案',
        title: `${name}様：前回のご提案が記録に残っています`,
        prompt: `${name}様のカルテをもとに、次回のご提案の伝え方を教えてください。`,
        contextLabel: customerContextLabel(appt.customer_id, ix, world),
      })
      continue
    }
    if (s.kind === 'waitlist_due' && ref.collection === 'inbox') {
      const t = ix.thread.get(ref.id)
      const name = personOf(t?.customer_id, ix)
      if (!t || t.due === null || !name) continue
      out.push({
        id: s.id,
        tag: '空き待ち',
        title: `空き待ちの回答期限 ${hhmm(t.due)}：ご案内の文面`,
        prompt: '空き待ちのお客様に、空き枠が出たときのご案内の文面を作ってください。',
        contextLabel: customerContextLabel(t.customer_id, ix, world),
      })
    }
  }
  return out
}

export interface TemplatePill {
  id: string
  category: string
  categoryLabel: string
  title: string
  preview: string
  /** What a tap FILLS the composer with — and it does not send, which is the
   *  phone's own behaviour and the difference this room preserves. */
  example: string
}

const TEMPLATE_CATEGORY_LABEL: Record<FixtureTemplate['category'], string> = {
  Analysis: '分析',
  Customer: 'お客様',
  Strategy: '企画',
}

export function buildTemplates(templates: FixtureTemplate[]): TemplatePill[] {
  return templates.map((t) => ({
    id: t.id,
    category: t.category,
    categoryLabel: TEMPLATE_CATEGORY_LABEL[t.category],
    title: t.title,
    preview: t.preview,
    example: t.example,
  }))
}

// ── the scope strip (§2b-5) ─────────────────────────────────────────────────

export interface ScopeFact {
  key: 'karute' | 'customers' | 'bookings' | 'recordings'
  /** ⚖ 8/25 — the LABEL says what the number counts, and the label is the
   *  phone's own word for it (`messages/ja.json` askAi.scopeKarute …), so a
   *  staffer who reads 「カルテ」 on the phone reads 「カルテ」 here. */
  label: string
  value: string
}

/** The four facts, computed EXACTLY. The phone's own recordings figure is an
 *  approximation it documents (transcript-bearing rows inside a ≤200-row page,
 *  `src/app/[locale]/(app)/ask-ai/page.tsx:83-90`); a sealed world has no page
 *  to run out of, so the desk's four are exact and registry ⑤ carries the
 *  approximation into the reconnect spec — along with the failed-count-OMITTED
 *  duty, which cannot fire here because no count has a fetch behind it. */
export function scopeCounts(world: AskAiWorld): ScopeFact[] {
  const ix = askAiIndex(world)
  const inLensRecords = world.records.filter((r) => ix.appointment.has(r.appointment_id))
  return [
    { key: 'karute', label: 'カルテ', value: `${inLensRecords.length}件` },
    { key: 'customers', label: '顧客', value: `${ix.lensCustomers.size}名` },
    { key: 'bookings', label: '予約', value: `${world.upcomingAppointments.length}件` },
    { key: 'recordings', label: '録音', value: `${inLensRecords.filter((r) => r.recording !== null).length}件` },
  ]
}

// ── the refusals, in one place, each naming its registry line ───────────────

/** ⚠ EVERY REFUSAL SAYS WHY IN ITS OWN WORDS, and names the missing thing IN
 *  WORDS. One generic sentence on three different controls tells a reader
 *  nothing about which of them would have done what (the room-3 F4 lesson).
 *
 *  ⚠ AND THE READER NEVER SEES A REGISTRY NUMBER. The reconnect registry is an
 *  internal index; 「登録①」 on screen is jargon reaching a shop (L4-1). The
 *  family precedent is the カルテ room's own permissionNotice — a plain sentence
 *  that closes with a bare 「（未接続）」 — so that is the shape here, and the
 *  registry mapping lives in the comments beside each string, where the
 *  reconnect spec can still grep it.
 *
 *  ⚖ AND SEND REFUSES IMMEDIATELY (D-2). No thinking state, no synthetic reply,
 *  no pretended latency: the sealed room never renders
 *  `messages/ja.json` askAi.thinking, and the typed text survives the refusal
 *  byte-identical (⚖ §A-7 — a refusal changes NOTHING). */
export const REFUSAL = {
  // RECONNECT SEAM: 登録① AI応答の生成（実モデル呼び出し） — the shipped chat
  // contract (§2b-3, both routes, shared core) is the live door at reconnect.
  send: '見本データのため回答を生成できません。回答はAIに実際に問い合わせる操作のため、実データとAIの接続後に有効になります（未接続）。',
  // RECONNECT SEAM: 登録⑦ AI設定ダイヤル接続 — 積極度 + the four category
  // switches + 回答の言語, whose home is the 設定 room (it builds LAST).
  settings: '見本データのためAI設定を開けません。積極度・カテゴリ・回答の言語は設定画面で決める項目のため、設定画面の追加後に有効になります（未接続）。',
} as const

/** 却下 IS NOT REFUSED — it works, and it is honest about being demo-local
 *  (canon's own contract): the card leaves the feed for this visit, the toast
 *  says nothing was saved, and re-opening the page brings it back. */
export const DISMISS_TOAST = '提案を却下しました（デモ・保存されません）'

export const FOOTNOTE = '見本データのため送信・保存はできません — 実データ接続後に有効になります。'

// ── 画面の説明 — the one placement correction the shared engine cannot make ──

interface Box { left: number; top: number; width: number; height: number }

/** ⚖ THE F-K5 CORRECTION, CARRIED (`karute.ts:588`, measured on the カルテ room's
 *  own record view). `spotCardAt` places the tour card on the spotlight's widest
 *  free side; for a section TALLER THAN THE VIEWPORT — which this room's feed is
 *  the moment a store has 25 suggestions — neither side has room and the
 *  engine's last-resort clamp parks the card over the section's own heading, so
 *  the walk explains a thing by covering the words that name it.
 *
 *  It is copied rather than imported because `karute.ts` is ANOTHER ROOM's
 *  derivation module: a room importing a sibling room's lib is a dependency the
 *  territory fence exists to prevent, and the shared engine
 *  (`@/business/lib/guide`) is FROZEN. The rule is one function either way; when
 *  a third room needs it, it moves into the engine in that round.
 *
 *  ⚠ PURE, and its inputs are rects: no clock, no data, no React. */
export function keepCardOffHeading(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: Box,
  viewport: { width: number; height: number },
  /** A section's heading lives in its first rows; 64px covers this room's own
   *  `.ak-sec-title` line plus its margin at every band. */
  headingZone = 64,
): { top: number; left: number } {
  const zoneTop = target.top
  const zoneBottom = target.top + Math.min(headingZone, target.height)
  const overlapsX = at.left < target.left + target.width && at.left + card.width > target.left
  const overlapsHeading = at.top < zoneBottom && at.top + card.height > zoneTop
  if (!overlapsX || !overlapsHeading) return at
  const zoneMid = (zoneTop + zoneBottom) / 2
  const room = { top: zoneMid, bottom: viewport.height - zoneMid }
  const top = room.bottom >= room.top ? viewport.height - card.height - 10 : 10
  return { top: Math.max(10, top), left: at.left }
}
