'use client'

// 予約と確保 — the room's surface. ⚖ Liam 9/1: the approved `settings-mock.html`
// is the spec, and its anatomy is presets → live preview → 詳細設定, with the
// mock's own one-line description under every dial (⚖ HIS 8/31 GENERAL LAW:
// 「every settings entry carries a one-line description of what it changes/turns
// off」 — every 説明 below is the mock's, verbatim).
//
// ⚖ 1b RULED — 新規のお客様の確保 is THREE CHIPS (60分/75分/90分), not the mock's
// free stepper: `SetStoreBookingPolicyInput.new_client_session_minutes` is the
// literal union `60 | 75 | 90`, so a stepper could offer 150 and the wire would
// refuse it. A control that can name a value the store cannot save is a lie with
// a number in it. `MINUTE_CHOICES` in `./store-policy-seam.ts` is that enum.
//
// THE PREVIEW IS THE SHIPPED CARD, not a drawing of one: it imports
// `warnFaceFor` — the board's own composer — and paints the model it hands back
// in the board's own `wc-*` grammar. Every judgement on that card (the three
// permission faces, the long press, the name line, the alternative shapes, the
// ¥) is decided by that function and by nothing here, which is what makes the
// preview an honest answer to 「what will my staff actually see?」.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { overrideLevelFor, warnFaceFor, type OverrideLevel, type RailCell } from '../today/today-interactions'
import type { PriceFrame } from '@/business/lib/canon-logic/pricing'
import { MINUTE_CHOICES, sceneKeyFor, type GapGuardMode, type NewClientMinutes } from './store-policy-seam'

const ROOT = 'page pg-settings'

/** The 確保 verdict + capacity at ONE pair of dial values, evaluated on the
 *  server against the store's real day. Keyed `standard:90` / `strict:60`. */
export interface SettingsScene {
  /** The ENGINE'S own count of 新規 windows the day can hold at this length
   *  (`protectedCapacity`, over the day's own `freePockets`). Never derived
   *  here — one basis, ⚖ 54. */
  capacity: number
  /** The guard's verdict at the sample landing. `null` = the day has no landing
   *  that costs the store a protected window, so there is no warn card to show. */
  cell: RailCell | null
}

export interface SettingsProps {
  storeKey: string
  storeLabel: string
  policy: {
    /** ⚠SETTINGS-BATCH — `storeBookingPolicy.overridePolicy.roles`. */
    overrideRoles: string[]
    /** The store's own manager-level list (`releaseHeldRoles`), which is also
     *  what the save gate reads. DATA, never a literal. */
    managerRoles: string[]
    /** ⚠SETTINGS-BATCH — `overridePolicy.lockedOut`, staff_id で名指し. */
    lockedOut: string[]
    /** core `gap_guard_mode`, WHOLE — 'OFF' | 'STANDARD' | 'STRICT'. ⚖ 9/1 (fix
     *  round 1 F4): a boolean here threw the third state away, so an off store
     *  opened on a dial claiming it ran standard warnings. */
    mode: GapGuardMode
    /** ⚠SETTINGS-BATCH — `overrideHoldToConfirm`. */
    holdToConfirm: boolean
    /** core `new_client_session_minutes`. */
    newClientMinutes: NewClientMinutes
    /** ⚠SETTINGS-BATCH — `heldRankAccess`. */
    heldRankAccess: 'closed' | 'silver' | 'gold' | 'platinum'
    /** ⚠SETTINGS-BATCH — the store advertises its leftovers (`minSellableMin`). */
    gapSelling: boolean
    /** ⚠SETTINGS-BATCH — `opsConfig.bookingStepMin`, 予約のドラッグ刻み. */
    bookingStepMin: number
  }
  scenes: Record<string, SettingsScene>
  sample: {
    laneKey: string
    laneLabel: string
    summary: string
    rows: Array<{ label: string; tone: '' | 'bad' | 'warn' }>
    confirmEnabled: boolean
    listPrice: number
    frame: PriceFrame
    depth: number
  } | null
  operator: { name: string; role: string; staff_id: string }
  sampleStaffRole: string
  roster: Array<{ id: string; name: string }>
  /** ⚖ THE HQ SAVE GATE, decided on the server off the ROLES HOME. `refusal` is
   *  the one sentence the control prints when it cannot fire, `null` when it
   *  could; `roles` is the store's own manager-level list, named on screen so an
   *  operator who is refused knows who to ask. */
  save: { refusal: string | null; roles: string[] }
}

// ── the mock's own presets ───────────────────────────────────────────────────

type Perm = 'staff' | 'approve' | 'manager'
type Rank = SettingsProps['policy']['heldRankAccess']
/** One dial state, and the mock's own key set — 名指しロック is deliberately NOT
 *  in it (see `PRESETS`). */
interface Dials { perm: Perm; hold: boolean; mode: GapGuardMode; gaps: boolean; minutes: NewClientMinutes; rank: Rank; slot: number }

/** ⚖ the mock's three presets, value for value. 名指しロック is a PER-PERSON
 *  exception rather than a policy dial, so it lives outside this set and
 *  choosing a preset never silently frees a locked staff member — the mock's own
 *  adjudicated rule, carried. */
const PRESETS: Record<string, Dials> = {
  auto: { perm: 'staff', hold: true, mode: 'STANDARD', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
  trust: { perm: 'staff', hold: false, mode: 'STANDARD', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
  watch: { perm: 'manager', hold: true, mode: 'STRICT', gaps: true, minutes: 90, rank: 'closed', slot: 30 },
}

const PRESET_CARDS: Array<{ key: string; name: string; lines: string[] }> = [
  { key: 'auto', name: 'おまかせ（標準）', lines: ['スタッフも置けます。ただし確保枠を壊す場所では、長押しの確認が入ります。'] },
  { key: 'trust', name: 'スタッフに任せる', lines: ['スタッフがそのまま置けます。長押しの確認はありません。', '回転の速いお店向け。上書きは記録に残ります。'] },
  { key: 'watch', name: '店長がしっかり見る', lines: ['確保枠を壊す場所に置けるのは店長だけです。', 'スタッフには安全な時間の提案だけが出て、確定はできません。'] },
]

const RANK_OPTIONS: Array<[Rank, string]> = [
  ['closed', '開放しない'],
  ['silver', 'シルバー以上'],
  ['gold', 'ゴールド以上'],
  ['platinum', 'プラチナ以上'],
]

/** 予約の刻み's own bounds, the mock's. */
const SLOT_MIN = 5
const SLOT_MAX = 60

/** The mock's own honest note for a dial core has no field for yet
 *  (⚠SETTINGS-BATCH). ONE sentence, reused, so eight rows cannot drift into
 *  eight different promises. */
const PENDING_NOTE = 'この設定はまだ保存できません。画面での動きだけ確認できます'

/** ⚖ Liam 8/23 — 画面の説明. The family's own tour helpers, carried at the same
 *  shape: a rect literal the shared engine understands, and two identity guards
 *  that keep the measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** The padlock the approved warn card opens its provenance line with — the same
 *  path today.css's own card draws, so the preview is the card. */
const WC_LOCK_PATH = 'M4 7V5a4 4 0 018 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 10-4 0v2z'

export function SettingsScreen(props: SettingsProps) {
  const { policy, sample } = props

  // ── the dials ─────────────────────────────────────────────────────────────
  // Seeded from the STORE's own values, never from a preset: a store whose dials
  // match no preset opens on カスタム, which is the truth about it.
  const [perm, setPerm] = useState<Perm>(policy.overrideRoles.includes(props.sampleStaffRole) ? 'staff' : 'manager')
  const [hold, setHold] = useState(policy.holdToConfirm)
  // ⚖ 9/1 (fix round 1 F4) — the WHOLE enum, so a store that arrives OFF stays
  // OFF until the operator presses one of the dial's two positions on purpose.
  const [mode, setMode] = useState<GapGuardMode>(policy.mode)
  const [gaps, setGaps] = useState(policy.gapSelling)
  const [minutes, setMinutes] = useState<NewClientMinutes>(policy.newClientMinutes)
  const [rank, setRank] = useState<Rank>(policy.heldRankAccess)
  // 予約の刻み is held as TEXT while it is being typed — a half-typed 「1」 on the
  // way to 「15」 must not clamp itself to 5 under the operator's fingers. The
  // committed number is `slotMin` below, and it is what everything else reads.
  const [slotText, setSlotText] = useState(String(policy.bookingStepMin))
  const [slotWarn, setSlotWarn] = useState(false)
  const [locks, setLocks] = useState<string[]>(policy.lockedOut)
  const [lockPick, setLockPick] = useState('')
  // The preview's sample operator — the mock's 見本の操作者 segment.
  const [op, setOp] = useState<'staff' | 'manager'>('staff')
  /** ⚖ 9/1 (fix round 1 F12) — 詳細設定 IS CONTROLLED, so the tour can open it.
   *  `spotTargets` drops zero-sized nodes (which is the right law: a hidden dial
   *  is not explained), and a collapsed `<details>` makes all nine of them zero —
   *  so a manager who folded the section away and then pressed ? was walked
   *  through 3 steps instead of 12, with the count reading 「1 / 3」 as though
   *  that were the page. The walk opens the section it is about to explain. */
  const [advOpen, setAdvOpen] = useState(true)

  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  // View state: the walk explains the page and writes nothing.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  const dials: Dials = { perm, hold, mode, gaps, minutes, rank, slot: Number(slotText) }
  const activePreset =
    Object.keys(PRESETS).find((k) => {
      const p = PRESETS[k]
      return p.perm === dials.perm && p.hold === dials.hold && p.mode === dials.mode &&
        p.gaps === dials.gaps && p.minutes === dials.minutes && p.rank === dials.rank && p.slot === dials.slot
    }) ?? null

  function choosePreset(key: string) {
    const p = PRESETS[key]
    setPerm(p.perm); setHold(p.hold); setMode(p.mode); setGaps(p.gaps)
    setMinutes(p.minutes); setRank(p.rank); setSlotText(String(p.slot))
  }

  // ── the live preview ──────────────────────────────────────────────────────

  /** ⚖ WHO the preview is standing in for. The スタッフ seat is the sample
   *  landing's OWN lane owner at the role the store's data calls non-manager
   *  (`sampleStaffRole`, derived server-side from the override dial minus the
   *  manager-level list); the 店長 seat is the real operator, at their real role.
   *  Neither role is spelled in this file. */
  const previewOp =
    sample === null || op === 'manager'
      ? props.operator
      : { name: sample.laneLabel, role: props.sampleStaffRole, staff_id: sample.laneKey }

  /** ⚖ ruling 91's three levels. `overrideLevelFor` is the board's own consult
   *  and answers `lockedOut` FIRST — a store that named a person has named them
   *  whatever their role says — so the 名指しロック chips are live in the preview
   *  without this file re-deciding anything.
   *
   *  'needs-approval' is the one level that consult cannot RETURN (its comment
   *  says why: a real request→approve moment needs server-backed request state
   *  this board does not have), and `warnFaceFor`'s own note says the face 「exists
   *  so the settings round LIGHTS it rather than inventing it」. This is that
   *  lighting, and it lights nothing else: the level is composed here, for the
   *  preview only, and no policy value anywhere can produce it. */
  // ponytail: no memo. This is a pure fold over four values the render above
  // just settled, and `previewOp` is a fresh object every pass — a memo here
  // would buy nothing and would need that object as a dep, which is the
  // stale-answer trap TodayScreen's own composer avoids for the same reason.
  const level: OverrideLevel = (() => {
    const roles = perm === 'manager' ? policy.managerRoles : [...policy.managerRoles, props.sampleStaffRole]
    const base = overrideLevelFor({ roles, lockedOut: locks }, previewOp)
    return perm === 'approve' && base === 'allow-warned' ? 'needs-approval' : base
  })()

  /** ⚖ 9/1 (fix round 1 F4) — WHICH SCENE THESE DIALS ASK FOR, and `null` when
   *  they ask for none: the guard is OFF for this store, so there is no verdict
   *  to preview and the card below is not drawn at all. The seam owns the mapping
   *  so the page (which BUILDS the scenes) and this screen (which reads them)
   *  cannot spell the key two ways. */
  const sceneKey = sceneKeyFor(mode, minutes)
  const guardOff = sceneKey === null
  /** ⚖ 9/1 (fix round 1 F4b) — AND AT OFF THE CAPACITY IS STILL THE REAL ONE.
   *  The `{ capacity: 0 }` fallback made the guardrail line print the amber
   *  「この長さでは…ひとつも作れません（0枠）」 at every OFF store — a room-tight
   *  alarm about a day that is not tight, invented by a missing key rather than
   *  measured. The number does not depend on the mode at all (the page computes
   *  it once per 長さ and stores the same value under both keys), so the honest
   *  one is right there under STANDARD. CAPACITY ONLY: `cell` stays null, so the
   *  card is suppressed exactly as an off store's card must be.
   *
   *  It is also the point of the line at OFF — 作れます is a potential, true in
   *  every mode, and an owner deciding whether to switch the guard ON deserves to
   *  see what the day can hold BEFORE they switch it (⚖ 8/21 mistake-proofing). */
  const scene = sceneKey === null
    ? { capacity: props.scenes[sceneKeyFor('STANDARD', minutes)!]?.capacity ?? 0, cell: null }
    : props.scenes[sceneKey] ?? { capacity: 0, cell: null }

  /** THE CARD, composed by the BOARD'S OWN function. Every branch of it —
   *  the three faces, the hold/press/approval commit, the provenance line, the
   *  safe answer, the ¥ — is `warnFaceFor`'s; this room decides nothing about
   *  what a staff member sees, which is the only way a preview can be trusted. */
  const card = sample === null || guardOff ? null : warnFaceFor({
    rows: sample.rows,
    cell: scene.cell,
    // The preview stages a landing directly; nothing was walked past on the way,
    // so there is no overridden sentence to carry.
    override: null,
    level,
    holdToConfirm: hold,
    targetLaneMine: previewOp.staff_id === sample.laneKey,
    operatorName: previewOp.name,
    listPrice: sample.listPrice,
    frame: sample.frame,
    depth: sample.depth,
    protectedDur: minutes,
    confirmEnabled: sample.confirmEnabled,
  })

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`) and
   *  wired exactly as 受信トレイ / 売上・レジ / カルテ wire it.
   *
   *  THE REGISTRY. A section joins the walk by declaring `data-guide-title` +
   *  `data-guide` ON ITSELF, so there is no steps table to keep in sync — which
   *  in THIS room is the whole point: every dial is its own `<section>`, so a
   *  dial added in a later round is explained the day it lands and one hidden
   *  behind a permission drops out of the count by itself.
   *
   *  The walk is scoped to the ROOM's own root rather than the document: the
   *  shell's rail and topbar are not this page. */
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls (⚖ page-scroll).
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const spotCard = tourCardRef.current
    const size = { width: spotCard?.offsetWidth || 300, height: spotCard?.offsetHeight || 160 }
    const at = spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // While the tour is up it owns Escape, and the arrows walk the ring. Bound
  // only while it IS open, and removed with it.
  useEffect(() => {
    if (!tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize — has to re-measure.
  useEffect(() => {
    if (!tourOpen) return
    const bump = () => setTourTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  // ⚖ THE KEYBOARD MUST NOT BE STRANDED BY THE TOUR. Opening it puts focus on
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts focus
  // back on the ? it came from. `wasOpen` keeps the close half from firing on the
  // first render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  // ── 名指しロック ──────────────────────────────────────────────────────────

  /** ⚖ 8/21 MISTAKE-PROOFING — A STORE MAY NOT LOCK OUT EVERYONE
   *  (`fixtures-today.ts`'s own guardrail, named where the dial was specified).
   *  The last un-locked person on the roster cannot be added, and the control
   *  says so instead of going quietly dead. */
  const lockable = props.roster.filter((s) => !locks.includes(s.id))
  /** ⚖ 9/1 (fix round 1 F14) — AND AN EMPTY ROSTER IS NOT A STORE DOWN TO ITS
   *  LAST PERSON. `<= 1` answered TRUE at zero, so a lens with no staff at all
   *  printed 「全員を名指しロックにはできません」 and disabled 追加 — a guardrail
   *  firing about people who are not there, over a picker that is empty anyway. */
  const lastOneStanding = props.roster.length > 0 && lockable.length <= 1
  /** ⚖ 8/17 STORE ISOLATION (fix round 1 F14) — A FOREIGN staff_id NEVER RENDERS.
   *  `lockedOut` is the STORE POLICY's list and this screen is opened under one
   *  store's lens, so an id belonging to another store's roster found no name and
   *  fell back to printing the raw key — 「p-05 ×」 — which is precisely the
   *  existence the isolation law hides. Filtered for DISPLAY only: the id stays in
   *  `locks`, so nothing this screen does erases a lock it is not allowed to show. */
  const rosterIds = new Set(props.roster.map((s) => s.id))
  const shownLocks = locks.filter((id) => rosterIds.has(id))
  const nameOf = (id: string) => props.roster.find((s) => s.id === id)?.name ?? id

  return (
    <div className={ROOT} ref={rootRef}>
      <div className="st-measure">
        {/* STEP 0. The head declares itself like every other section, so the walk
            opens on what this page is FOR before it starts pointing at parts of
            it — the 受信トレイ precedent, and the reason the mock's two lead
            paragraphs stay short here. */}
        <header
          className="st-head"
          data-guide-title="予約と確保"
          data-guide="この店舗の予約と確保のルールを、まとめて決める画面です。まずプリセットを選び、変えたいところだけ詳細設定で直します。右のカードは、いまの設定でスタッフの画面に出るものです。"
        >
          <div className="st-titleline">
            <h1>予約と確保</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one every
                other Business room has. A hairline circle, never a filled one
                (⚖ R13). */}
            <button
              className="st-help"
              type="button"
              ref={helpRef}
              title="画面の説明"
              aria-label="画面の説明"
              aria-haspopup="dialog"
              aria-expanded={tourOpen}
              aria-controls="stTour"
              onClick={() => { setAdvOpen(true); setTourIdx(0) }}
            >
              ?
            </button>
          </div>
          {/* The mock's own two lead lines, verbatim. */}
          <p className="st-lead">予約と確保のルールを、ここでまとめて決めます。まずは3つのプリセットから選び、直したいところだけ詳細設定で変えられます。</p>
          <p className="st-lead">右のカードは、いまの設定でスタッフの画面に出てくるものです。</p>
        </header>

        <div className="st-wrap">
          {/* ============ presets ============ */}
          <section
            className="st-col-presets"
            aria-labelledby="stPresetsLabel"
            data-guide-title="プリセット"
            data-guide="よくある決め方を3つ用意しています。押すと下の詳細設定がまとめて切り替わります。名指しロックだけは個人ごとの例外なので、プリセットでは変わりません。"
          >
            <div className="st-sec-h">
              <p className="st-sec-l" id="stPresetsLabel">プリセット</p>
              {activePreset === null && <span className="st-chip custom">カスタム</span>}
            </div>
            <p className="st-sec-d">よくある決め方を3つ用意しました。選ぶと、下の詳細設定がまとめて変わります。</p>
            <div className="st-presets">
              {PRESET_CARDS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`st-pcard${activePreset === p.key ? ' on' : ''}`}
                  aria-pressed={activePreset === p.key}
                  onClick={() => choosePreset(p.key)}
                >
                  <span className="st-pcard-n">{p.name}</span>
                  {p.lines.map((line) => <span className="st-pcard-s" key={line}>{line}</span>)}
                  <span className="st-pcard-h">詳細設定で個別に変更できます</span>
                </button>
              ))}
            </div>
          </section>

          {/* ============ the live card preview ============ */}
          <section
            className="st-col-preview"
            aria-labelledby="stPreviewLabel"
            data-guide-title="スタッフが見るカード"
            data-guide="いまの設定で、確保枠を壊す場所に予約を置こうとしたスタッフに出るカードです。表示だけで、ここから予約は動きません。見本の操作者を切り替えると、権限による見え方の違いも確認できます。"
          >
            <div className="st-sec-h">
              <p className="st-sec-l" id="stPreviewLabel">スタッフが見るカード</p>
              <span className="st-chip">表示のみ</span>
            </div>

            <div className="st-pv-op">
              <p className="st-ctrl-l" id="stOpLabel">見本の操作者</p>
              <div className="st-seg" role="group" aria-labelledby="stOpLabel">
                <button type="button" className={op === 'staff' ? 'on' : undefined} aria-pressed={op === 'staff'} onClick={() => setOp('staff')}>スタッフ</button>
                <button type="button" className={op === 'manager' ? 'on' : undefined} aria-pressed={op === 'manager'} onClick={() => setOp('manager')}>店長</button>
              </div>
              <p className="st-ctrl-d">誰がこの操作をしているかで、出てくるカードが変わります</p>
            </div>

            {guardOff ? (
              // ⚖ 9/1 (fix round 1 F4) — AND AN OFF STORE SAYS SO. `gap_guard_mode`
              // has a third state, and a store that turned the 確保 guard off has
              // no warning card at all — not a standard one. Its own sentence,
              // rather than a scene borrowed from the mode next door.
              <p className="st-pv-none">この店舗では、確保枠の見張りそのものを止めています。下の「店長のみでも警告を止める」でONかOFFを選ぶと、ここにスタッフが見るカードが出ます。</p>
            ) : sample === null || card === null ? (
              // ⚖ HONEST WHEN THERE IS NOTHING TO SHOW. No landing on this
              // store's day costs it a protected window, so there is no warning
              // card to preview — said out loud rather than drawn from a scene
              // this room invented.
              <p className="st-pv-none">いまの1日には、確保枠を壊してしまう配置がありません。設定を変えると、ここにスタッフが見るカードが出ます。</p>
            ) : (
              /* ⚖ 9/1 (fix round 1 F2) — `role="img"` IS DELETED. ARIA img is
                 children-presentational, so the whole card — the impact line, the
                 ¥, the provenance, the commit label, the check rows — collapsed
                 into its own 12-character label for a screen reader: the manager
                 asking 「what will my staff actually see?」 was answered 「a
                 picture」. It is the exact pattern ⚖ flag 44(3) took off the
                 board's own rail. `group` keeps the region NAMED and leaves every
                 child readable. */
              <div className="hold-pop st-pv-card" role="group" aria-label="スタッフが見るカードの見本">
                <div className="hp-head">
                  <span className="status waiting">仮押さえ</span>
                  <strong>{sample.summary}</strong>
                </div>
                {card.face === 'warn' ? (
                  <>
                    {card.impact.head && (
                      <p className="wc-impact">
                        {card.impact.head}
                        {card.impact.yen && <span className="wc-yen">（{card.impact.yen}）</span>}
                        {card.impact.tail}
                      </p>
                    )}
                    {card.provenance && (
                      <p className="wc-prov">
                        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d={WC_LOCK_PATH} fill="currentColor" /></svg>
                        <span>{card.provenance}</span>
                      </p>
                    )}
                    {card.safePrimary?.kind === 'place' && (
                      <span className="btn primary wc-safe">
                        <span className="wc-safe-main">{card.safePrimary.main}</span>
                        <span className="wc-safe-sub">{card.safePrimary.sub}</span>
                      </span>
                    )}
                    {card.commit?.kind === 'hold' && (
                      <span className={`wc-hold${card.commit.enabled ? '' : ' st-off'}`}>
                        <span className="wc-hold-clip" aria-hidden="true"><span className="wc-hold-fill" /></span>
                        <span className="wc-hold-text">{card.commit.label}</span>
                      </span>
                    )}
                    {card.commit?.kind === 'press' && (
                      <span className={`btn wc-warn-btn${card.commit.enabled ? '' : ' st-off'}`}>{card.commit.label}</span>
                    )}
                    {card.commit?.kind === 'approval' && (
                      <span className={`btn wc-approve${card.commit.enabled ? '' : ' st-off'}`}>{card.commit.label}</span>
                    )}
                    {card.commit?.note && <p className="wc-note">{card.commit.note}</p>}
                    {card.lock && (
                      <p className="wc-lock">
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d={WC_LOCK_PATH} fill="currentColor" /></svg>
                        <span>{card.lock}</span>
                      </p>
                    )}
                    {card.greensLine && <p className="wc-greens">{card.greensLine}</p>}
                    {card.rows.length > 0 && (
                      <div className="holdbar-checks wc-rows">
                        {card.rows.map((c) => <span className={`ck${c.tone ? ` ${c.tone}` : ''}`} key={c.label}>{c.label}</span>)}
                      </div>
                    )}
                    <div className="hp-actions wc-foot"><span className="btn">元に戻す</span></div>
                  </>
                ) : (
                  // The CLEAN face, byte-identical to the one the board ships:
                  // the check strip and the two buttons, nothing else.
                  <>
                    <div className="holdbar-checks">
                      {card.rows.map((c) => <span className={`ck${c.tone ? ` ${c.tone}` : ''}`} key={c.label}>{c.label}</span>)}
                    </div>
                    <div className="hp-actions">
                      <span className="btn primary">この内容で確定</span>
                      <span className="btn">元に戻す</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="st-pv-cap">設定を変えると、スタッフが見るカードがその場で変わります</p>
            <p className="st-pv-cap dim">すき間の販売・会員ランク・予約の刻みは、このカードには出ません</p>
          </section>

          {/* ============ 詳細設定 ============ */}
          <div className="st-col-adv">
            <details className="st-adv" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
              <summary><span className="st-caret" aria-hidden="true" />詳細設定<span className="st-sum-d">一つずつ変えられます</span></summary>

              {/* a. 上書きの権限 */}
              <section
                className="st-row"
                aria-labelledby="stPermLabel"
                data-guide-title="上書きの権限"
                data-guide="確保枠を壊す場所に、誰が自分の権限で置けるかを決めます。ここで選ばれていない人も、いまは確認のうえで置けます。下の「店長のみでも警告を止める」をONにすると、選ばれていない人は確定できなくなります。"
              >
                <p className="st-ctrl-l" id="stPermLabel">上書きの権限</p>
                <div className="st-seg" role="group" aria-labelledby="stPermLabel">
                  <button type="button" className={perm === 'staff' ? 'on' : undefined} aria-pressed={perm === 'staff'} onClick={() => setPerm('staff')}>スタッフOK</button>
                  <button type="button" className={perm === 'approve' ? 'on' : undefined} aria-pressed={perm === 'approve'} onClick={() => setPerm('approve')}>店長の承認</button>
                  <button type="button" className={perm === 'manager' ? 'on' : undefined} aria-pressed={perm === 'manager'} onClick={() => setPerm('manager')}>店長のみ</button>
                </div>
                {/* ⚖ 9/1 (fix round 1 F1) — AND IT SAYS WHAT THIS DIAL DOES IN
                    BOTH STRICT STATES. 「誰が置けるか」 was false at the loosened
                    setting: ⚖ ruling 1/2 lets everyone place through a merely
                    costly landing, and what this dial changes there is WHOSE
                    authority the record carries. It becomes a wall only when the
                    dial below is ON, and that is the half worth naming — a
                    manager reading one sentence about two states deserves both. */}
                <p className="st-ctrl-d">確保枠を壊す場所に、誰が自分の権限で置けるか</p>
                <p className="st-ctrl-d dim">選ばれていない人も、いまは確認のうえで置けます（操作した人の名前が記録に残ります）。下の「店長のみでも警告を止める」をONにすると、選ばれていない人は確定できなくなります</p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>「店長の承認」の承認フローは、近日追加予定です</p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* b. 名指しロック */}
              <section
                className="st-row"
                aria-labelledby="stLockLabel"
                data-guide-title="名指しロック"
                data-guide="いつも注意が必要な場所に置いてしまうスタッフを、名前で指定して止められます。プリセットでは変わらない、個人ごとの例外です。"
              >
                <p className="st-ctrl-l" id="stLockLabel">名指しロック</p>
                <div className="st-locks">
                  {shownLocks.length === 0
                    ? <span className="st-locks-empty">まだ誰も指定していません</span>
                    : shownLocks.map((id) => (
                        <span className="st-lockchip" key={id}>
                          {nameOf(id)}
                          <button type="button" aria-label={`${nameOf(id)} を名指しロックから外す`} onClick={() => setLocks((was) => was.filter((x) => x !== id))}>×</button>
                        </span>
                      ))}
                </div>
                <div className="st-lockadd">
                  {/* ⚖ MOCK DEVIATION, and the reason is the data: `lockedOut` is
                      keyed by staff_id, and a typed NAME cannot produce one. The
                      mock's free-text field would either mis-key or need a
                      matcher that guesses at people. A roster picker is the same
                      control with no way to get it wrong (⚖ 8/21 — staff CAN'T
                      err at the moment of the action). */}
                  <select value={lockPick} onChange={(e) => setLockPick(e.target.value)} aria-label="名指しロックに追加するスタッフ">
                    <option value="">スタッフを選ぶ</option>
                    {lockable.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className="st-btn-add"
                    disabled={lockPick === '' || lastOneStanding}
                    onClick={() => { setLocks((was) => [...was, lockPick]); setLockPick('') }}
                  >
                    追加
                  </button>
                </div>
                <p className="st-ctrl-d">名指しされたスタッフは、注意が必要な場所に置けなくなります</p>
                <p className="st-ctrl-d dim">名指しロックは、プリセットとは別の個人ごとの例外です</p>
                {lastOneStanding && <p className="st-ctrl-d warn">全員を名指しロックにはできません。少なくとも一人は置ける人が必要です</p>}
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* c. 長押しで確定 */}
              <section
                className="st-row"
                aria-labelledby="stHoldLabel"
                data-guide-title="長押しで確定"
                data-guide="注意が必要な場所に置くときだけ、確定を長押しにします。ふつうの確定はどの設定でもタップのままです。"
              >
                <p className="st-ctrl-l" id="stHoldLabel">長押しで確定</p>
                <div className="st-seg" role="group" aria-labelledby="stHoldLabel">
                  <button type="button" className={hold ? 'on' : undefined} aria-pressed={hold} onClick={() => setHold(true)}>ON</button>
                  <button type="button" className={!hold ? 'on' : undefined} aria-pressed={!hold} onClick={() => setHold(false)}>OFF</button>
                </div>
                {/* The sentence ⚖ 92 wrote for this dial, in `fixtures-today.ts`,
                    carried word for word so the settings round does not invent a
                    second description of one switch. */}
                <p className="st-ctrl-d">注意が必要な場所への配置に、0.6秒の長押しを求めます</p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* d. 店長のみでも警告を止める — core `gap_guard_mode` STRICT */}
              <section
                className="st-row"
                aria-labelledby="stStrictLabel"
                data-guide-title="店長のみでも警告を止める"
                data-guide="ONにすると、権限のないスタッフは注意が必要な場所に確定できなくなります。カードには安全な時間の提案と元に戻すだけが残ります。"
              >
                <p className="st-ctrl-l" id="stStrictLabel">店長のみでも警告を止める</p>
                {/* ⚖ 9/1 (fix round 1 F4) — THREE STATES, TWO BUTTONS, AND NO
                    FABRICATED POSITION. A store whose guard is OFF is neither ON
                    nor OFF on this dial, so neither button is pressed and the
                    line below says why — rather than lighting OFF, which would
                    read as 「the guard is running, without the wall」 and would
                    quietly turn the guard ON the moment anything saved. */}
                <div className="st-seg" role="group" aria-labelledby="stStrictLabel">
                  <button type="button" className={mode === 'STRICT' ? 'on' : undefined} aria-pressed={mode === 'STRICT'} onClick={() => setMode('STRICT')}>ON</button>
                  <button type="button" className={mode === 'STANDARD' ? 'on' : undefined} aria-pressed={mode === 'STANDARD'} onClick={() => setMode('STANDARD')}>OFF</button>
                </div>
                <p className="st-ctrl-d">ONにすると、権限のないスタッフは注意が必要な場所に確定できなくなります（安全な時間の提案と元に戻すだけになります）</p>
                {guardOff && <p className="st-ctrl-d warn">いまこの店舗は、確保枠の見張りそのものを止めています。ONとOFFのどちらを押しても、見張りは動き出します</p>}
              </section>

              {/* e. すき間の販売 */}
              <section
                className="st-row"
                aria-labelledby="stGapsLabel"
                data-guide-title="すき間の販売"
                data-guide="予約と予約のあいだに残った短い空き時間を、そのまま予約枠として売るかどうかです。"
              >
                <p className="st-ctrl-l" id="stGapsLabel">すき間の販売</p>
                <div className="st-seg" role="group" aria-labelledby="stGapsLabel">
                  <button type="button" className={gaps ? 'on' : undefined} aria-pressed={gaps} onClick={() => setGaps(true)}>ON</button>
                  <button type="button" className={!gaps ? 'on' : undefined} aria-pressed={!gaps} onClick={() => setGaps(false)}>OFF</button>
                </div>
                <p className="st-ctrl-d">短い空き時間も予約枠として販売します</p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* f. 新規のお客様の確保 — core `new_client_session_minutes` */}
              <section
                className="st-row"
                aria-labelledby="stMinutesLabel"
                data-guide-title="新規のお客様の確保"
                data-guide="新規のお客様のために空けておく施術時間の長さです。長くするほど一枠は取りやすくなりますが、1日に確保できる枠の数は減ります。下の行がその数を教えてくれます。"
              >
                <p className="st-ctrl-l" id="stMinutesLabel">新規のお客様の確保</p>
                {/* ⚖ 1b RULED — three fixed choices, because the wire's own type
                    is `60 | 75 | 90`. The mock's stepper is superseded. */}
                <div className="st-seg" role="group" aria-labelledby="stMinutesLabel">
                  {MINUTE_CHOICES.map((m) => (
                    <button key={m} type="button" className={minutes === m ? 'on' : undefined} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m}分</button>
                  ))}
                </div>
                <p className="st-ctrl-d">新規のお客様のために確保する施術時間の長さ</p>
                {/* ⚖ THE GUARDRAIL, from the store's real day through the guard
                    engine's own `protectedCapacity` — never a count this room
                    derives. ⚖ 8/25 — the number says WHAT it counts. */}
                <p className={`st-ctrl-d${scene.capacity === 0 ? ' warn' : ' dim'}`} aria-live="polite">
                  {scene.capacity === 0
                    ? `この長さでは、この店舗の1日に新規のお客様の確保枠をひとつも作れません（0枠）`
                    : `この店舗では、1日に新規のお客様の確保枠を${scene.capacity}枠作れます`}
                </p>
              </section>

              {/* g. 確保枠の会員ランク開放 */}
              <section
                className="st-row"
                aria-labelledby="stRankLabel"
                data-guide-title="確保枠の会員ランク開放"
                data-guide="新規のお客様のために空けている枠を、選んだランク以上の常連さんにもネット予約で開放するかどうかです。既定では開放しません。"
              >
                <p className="st-ctrl-l" id="stRankLabel">確保枠の会員ランク開放</p>
                <div className="st-seg" role="group" aria-labelledby="stRankLabel">
                  {RANK_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={rank === value ? 'on' : undefined} aria-pressed={rank === value} onClick={() => setRank(value)}>{label}</button>
                  ))}
                </div>
                <p className="st-ctrl-d">確保枠の標準枠を、選んだランク以上のお客様のネット予約に開放します</p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* h. 予約の刻み */}
              <section
                className="st-row"
                aria-labelledby="stSlotLabel"
                data-guide-title="予約の刻み"
                data-guide="予約カードが動く時間の単位です。30分なら、予約は10:00・10:30…にそろいます。数字以外は保存されません。"
              >
                <p className="st-ctrl-l" id="stSlotLabel">予約の刻み</p>
                <div className="st-step">
                  <div className="st-step-g">
                    <button type="button" aria-label="5分減らす" onClick={() => setSlotText(String(clampSlot(dials.slot - SLOT_MIN)))}>−</button>
                    <input
                      id="stSlot"
                      type="text"
                      inputMode="numeric"
                      aria-labelledby="stSlotLabel"
                      value={slotText}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/[^0-9]/g, '')
                        if (clean !== e.target.value) setSlotWarn(true)
                        setSlotText(clean)
                      }}
                      onBlur={() => { setSlotText(String(clampSlot(Number(slotText)))); setSlotWarn(false) }}
                    />
                    <button type="button" aria-label="5分増やす" onClick={() => setSlotText(String(clampSlot(dials.slot + SLOT_MIN)))}>＋</button>
                  </div>
                  <span className="st-step-u">分</span>
                </div>
                <p className="st-ctrl-d">予約がそろう時間の単位</p>
                {/* ⚖ 9/1 (fix round 1 F10) — THE REJECTION IS SAID, NOT ONLY
                    COLOURED. A polite live region whose TEXT never changes
                    announces nothing, so the only signal that a keystroke was
                    thrown away was quiet→orange: WCAG 1.4.1, colour as the sole
                    carrier of information, on the one field in this room an
                    operator actually types into. The sentence itself changes now,
                    inside the region that was already there. */}
                <p className={`st-ctrl-d${slotWarn ? ' warn' : ' dim'}`} aria-live="polite">
                  {slotWarn ? '数字以外は保存されません。いま入力された数字以外の文字は消しました' : '数字以外は保存されません'}
                </p>
                <p className="st-ctrl-d dim"><span className="st-chip">準備中</span>{PENDING_NOTE}</p>
              </section>

              {/* i. 保存 — ⚖ THE HQ GATE, and an honest refusal.
                  The control is REFUSED rather than hidden, and its own reason
                  rides its accessible DESCRIPTION: per accname the button's text
                  content wins the NAME (この設定を保存), and `title` supplies the
                  description — which is the correct place for a reason, and is
                  what every sibling in this family already does. (⚖ 9/1 fix round
                  1 F9 — this note used to claim the reason was on the NAME. The
                  behaviour was right and the sentence describing it was wrong,
                  which is the kind of comment a later round builds on.) The
                  refusal is also PRINTED under the control, so it does not depend
                  on a tooltip at all. The family's standing pattern for an
                  action with no wire yet (BusinessTopbar's 操作履歴,
                  BusinessSidebar's 事業切替) is 「disabled with the reason, never a
                  button that pretends」 (⚖ L-7). Who MAY save is the store's own
                  manager-level list, decided on the server and named here so a
                  refused operator knows who to ask rather than just being stopped. */}
              <section
                className="st-row st-save"
                aria-labelledby="stSaveLabel"
                data-guide-title="保存"
                data-guide="変更を店舗の設定として保存します。保存できるのは、この店舗の責任者だけです。いまはまだ保存できないので、この画面での動きを確認したあと、そのまま閉じて大丈夫です。"
              >
                <p className="st-ctrl-l" id="stSaveLabel">保存</p>
                <button
                  className="btn primary"
                  type="button"
                  disabled={props.save.refusal !== null}
                  title={props.save.refusal ?? undefined}
                >
                  この設定を保存
                </button>
                {props.save.refusal !== null && <p className="st-ctrl-d warn">{props.save.refusal}</p>}
                <p className="st-ctrl-d dim">保存できるのは{props.save.roles.join('・')}です</p>
              </section>
            </details>
          </div>
        </div>
      </div>

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. */}
      {tourOpen && (
        <>
          <div
            className="st-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
              if (hit >= 0) setTourIdx(hit)
              else setTourIdx(-1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="st-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="st-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="st-spot-card"
            id="stTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="st-spot-text">{tourStep?.text ?? ''}</span>
            <div className="st-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="st-spot-foot">
              <button type="button" className="st-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="st-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="st-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="st-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** 予約の刻み's clamp. `!(x >= SLOT_MIN)` rather than `x < SLOT_MIN` for the one
 *  reason that spelling exists in this codebase: NaN fails EVERY comparison, so
 *  `<` would let an empty or non-numeric field through and `String(NaN)` would
 *  land 「NaN」 in the box. Same shape as `impactOf`'s own `!(protectedDur > 0)`. */
function clampSlot(value: number): number {
  if (!(Number.isFinite(value) && value >= SLOT_MIN)) return SLOT_MIN
  return Math.min(SLOT_MAX, Math.round(value))
}
