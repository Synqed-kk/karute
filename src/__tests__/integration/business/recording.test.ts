/**
 * 録音 — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: A RECORDING SESSION IS THE PHONE APP'S
 * SESSION, AND THIS ROOM READS IT BACK AT A DESK. Not one fact about a person, a
 * day, a store, a staff member or a menu is written down in this room's own
 * plane — every one of them is READ through the booking a take joins, so the
 * computer door and the phone cannot disagree about what happened in a session.
 * That is asserted as EQUALITIES AGAINST THE WORLD rather than as spot checks,
 * and as a SOURCE SCAN against the plane, because the W7 candidate's breach was
 * exactly this: a plane that restated the world and DELETED two of the world's
 * own assertions to make itself fit.
 *
 * Second job: THE FOUR W7 DUTIES, each one operated rather than argued.
 *   W7-1 consent fails closed in EVERY mode — one predicate, one argument.
 *   W7-2 a below-floor discard still writes a reason — one dialog, no exceptions.
 *   W7-3 recovery parity — single-slot, one action, never two offers at once.
 *   W7-4 a failed save never promotes policy — every policy string comes from
 *        the plane's saved truth, by construction.
 *
 * Third job: THREE REDACTIONS, ALL ABOVE THE SERIALIZER. Another store's takes
 * never enter the props; a staff reader's props hold only their OWN takes; a
 * discarded take's reason and transcript never enter them without
 * `discardReview`. All three are proven by scanning the SERIALIZED props for
 * strings that must not be anywhere in them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jstDayKey, jstSlot, jstYmd } from '@/business/lib/clock'
import {
  appointments,
  customers,
  menus,
  operator,
  staff,
  staffCards,
  STORE_A,
  STORE_B,
  type FixtureAppointment,
} from '@/business/lib/fixtures'
import { records as recordPlane } from '@/business/lib/fixtures-karute'
import {
  consentGrants,
  takes as takePlane,
  BELOW_FLOOR_SEC,
  CONSENT_POLICY_VERSION,
  type FixtureTake,
} from '@/business/lib/fixtures-recording'
import {
  accessFor,
  buildTakes,
  cardIdOfStaff,
  canStartRecording,
  consentGateNote,
  consentOf,
  consentProofLine,
  consentScript,
  discardCounts,
  discardFailLine,
  discardLedger,
  feedsCounts,
  fmtElapsed,
  isBelowFloor,
  ownDiscardsThisMonth,
  permissionNotice,
  pickerOptions,
  hasWrittenReason,
  staffBand,
  staffNameOfCard,
  takeStateOf,
  transcriptAbsenceOf,
  waveformBars,
  windowTakes,
  // ── v5's own derivations ──────────────────────────────────────────────────
  attentionCounts,
  bookingPhaseOf,
  briefFactsOf,
  consentActionLabel,
  consentShortLine,
  daysLeftLine,
  defaultPick,
  grantedWhen,
  slotHint,
  BRIEF_RECORDS_SHOWN,
  LOCAL_AUDIO_DAYS,
  CONSENT_LABEL,
  durationText,
  takeDurationLabel,
  transcriptEntries,
  DISCARD_FAILED_LINE,
  DISCARD_STALE_LINE,
  DISCARD_SUBMITTING_LABEL,
  RECORDER_LABEL,
  RECORDER_TONE,
  TAKE_REASON_LINE,
  TAKE_STATE_CHIP,
  TAKE_STATE_LABEL,
  TRANSCRIPT_ABSENCE_LINE,
  TRANSCRIPT_FAILED_LINE,
  WINDOW_DAYS,
  type TakeModel,
} from '@/business/lib/recording'
import { jstMinuteOfDay } from '@/business/lib/clock'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/business/lib/karute'
import { makeSpring } from '@/business/lib/spring'
import { recordingProps } from '@/app/[locale]/(business)/business/recording/recording-props'

const ROOM_DIR = 'src/app/[locale]/(business)/business/recording'
const SCREEN = readFileSync(join(process.cwd(), `${ROOM_DIR}/RecordingScreen.tsx`), 'utf8')
const PROPS_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/recording-props.ts`), 'utf8')
const PAGE_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/page.tsx`), 'utf8')
const LIB_SRC = readFileSync(join(process.cwd(), 'src/business/lib/recording.ts'), 'utf8')
const PLANE_SRC = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-recording.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SCREEN_CODE = stripComments(SCREEN)
const PLANE_CODE = stripComments(PLANE_SRC)
const LIB_CODE = stripComments(LIB_SRC)

/** `settleDiscard`'s own body — the one function that mints every receipt. */
function SCREeN_SETTLE(): string {
  const at = SCREEN_CODE.indexOf('const settleDiscard = ()')
  const body = SCREEN_CODE.slice(at)
  return body.slice(0, body.indexOf('\n  }') + 4)
}

/**
 * ⚠ EVERY 今月 ASSERTION IN THIS FILE RUNS ON A PINNED CLOCK, and it is not a
 * convenience.
 *
 * The demo plane dates every booking and every take RELATIVE to today, so
 * 「今月の破棄」 is a question whose answer changes with the calendar: on the 1st
 * or 2nd of a month every demo discard belongs to the month just gone and the
 * per-staff block is legitimately empty. That is correct product behaviour and
 * a broken test — and it broke two of them, at the parent tip, with nothing
 * changed, when this round happened to run on 2026-09-01. A month-dependent
 * assertion taken on the real clock is a test that passes 28 days out of 31.
 *
 * `MID_MONTH` is a JST midday well inside a month, so a relative plane built
 * around it cannot straddle a boundary in either direction. The JST-boundary
 * cases are their own matrix at the bottom of this file, on this same pin.
 */
const RealDate = Date
const MID_MONTH = '2026-08-15T03:00:00.000Z' // 12:00 JST, 2026-08-15
function pinClock(iso: string) {
  const fixed = new RealDate(iso)
  global.Date = class extends RealDate {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed.getTime())
      else super(...(args as [number]))
    }
    static now() { return fixed.getTime() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}
function unpinClock() { global.Date = RealDate }
/** Every describe whose numbers are a CALENDAR question calls this. */
/** A dayKey read back as the JST day it stands for (`jstDayKey`'s inverse). */
const dayOfKey = (dayKey: number) => new Date(dayKey * 86_400_000)
function onAPinnedMonth(iso: string = MID_MONTH) {
  beforeEach(() => pinClock(iso))
  afterEach(unpinClock)
}

const managerAccess = accessFor('店舗管理者')
const staffAccess = accessFor('スタッフ')
const selfCard = cardIdOfStaff(operator.staff_id, staffCards, staff)

/** The demo world's models, built through the REAL derivations under the 銀座
 *  lens, exactly as the assembly does. */
function models(over: Partial<Parameters<typeof buildTakes>[0]> = {}): TakeModel[] {
  const now = new Date()
  return buildTakes({
    takes: takePlane,
    appointments: appointments(now).filter((a) => a.store_id === STORE_A),
    customers,
    staff,
    staffCards,
    records: recordPlane,
    storeId: STORE_A,
    todayKey: jstDayKey(now),
    access: managerAccess,
    selfCardId: selfCard,
    ...over,
  })
}

// ═══ THE PLANE — ADD-ONLY, AND THE JOIN IS THE ONLY THING IT NAMES ═══════════

describe('⚠ the W7 breach class, pinned at the plane', () => {
  it('every bound take resolves against a booking THE WORLD ALREADY HOLDS', () => {
    const ids = new Set(appointments().map((a) => a.id))
    for (const t of takePlane) {
      if (t.appointment_id === null) continue
      expect({ take: t.id, known: ids.has(t.appointment_id) }).toEqual({ take: t.id, known: true })
    }
  })

  it('exactly ONE of appointment_id / store_id is non-null on every take', () => {
    for (const t of takePlane) {
      const bound = t.appointment_id !== null
      expect({ take: t.id, bound, store: t.store_id !== null, day: t.day_offset !== null }).toEqual({
        take: t.id,
        bound,
        // A bound take reads its store through the booking; an unbound one
        // carries its own store AND its own day. One home per fact.
        store: !bound,
        day: !bound,
      })
    }
  })

  it('the plane RESTATES nothing the world already states — no name, no date, no menu', () => {
    // Every customer name, staff name, menu name and store name the world holds.
    const worldStrings = [
      ...customers.map((c) => c.name),
      ...customers.map((c) => c.member_number),
      ...staff.map((s) => s.full_name),
      ...menus.map((m) => m.name),
    ]
    // ⚠ THE SOURCE, not the export: a restatement that never renders is still a
    // second home for a fact, and it is what rots the day the world changes.
    for (const s of worldStrings) {
      expect({ string: s, inPlane: PLANE_CODE.includes(s) }).toEqual({ string: s, inPlane: false })
    }
    // No absolute date anywhere either (⚖ L-6).
    expect(PLANE_CODE).not.toMatch(/20\d\d-\d\d-\d\dT/)
  })

  it('the plane imports the store constant and NOTHING else', () => {
    // ⚠ THE PATTERN IS BUILT, NOT WRITTEN AS A LITERAL. The phone-safety
    // import-isolation gate scans territory source for `from '…'` and a regex
    // literal spelling it reads to that scanner as a real import off the
    // allowlist — a pin failing for a reason that is not a defect.
    const IMPORT_RE = new RegExp(String.raw`from\s+'([^']+)'`, 'g')
    const imports = [...PLANE_CODE.matchAll(IMPORT_RE)].map((m) => m[1])
    expect(imports).toEqual(['./fixtures'])
  })

  it('the CONSENT fact and the カルテ plane COHERE rather than restate each other', () => {
    // A record may claim a session was recorded WITH consent; the grant plane
    // says whether that customer's consent is CURRENT today. Those are different
    // facts about different moments and neither is derived from the other — what
    // must never happen is a record claiming consent for a customer the world
    // has no consent story for at all.
    const bookingById = new Map(appointments().map((a) => [a.id, a]))
    for (const r of recordPlane) {
      if (!r.recording?.consent) continue
      const booking = bookingById.get(r.appointment_id)
      expect(booking).toBeDefined()
      const grant = consentGrants.find((g) => g.customer_id === booking!.customer_id)
      expect({ record: r.id, hasGrantStory: grant !== undefined }).toEqual({ record: r.id, hasGrantStory: true })
    }
  })

  it('every required data state is present in the demo plane', () => {
    const has = (p: (t: FixtureTake) => boolean) => takePlane.some(p)
    expect({
      currentConsent: consentGrants.some((g) => g.policy_version === CONSENT_POLICY_VERSION),
      staleConsent: consentGrants.some((g) => g.policy_version !== CONSENT_POLICY_VERSION),
      absentConsent: customers.some((c) => !consentGrants.some((g) => g.customer_id === c.id)),
      richDiscard: has((t) => t.discarded !== null && (t.discarded.transcript?.length ?? 0) > 0 && t.ticket_redeemed),
      belowFloorDiscard: has((t) => t.discarded !== null && isBelowFloor(t.duration_seconds)),
      noConsentDiscard: has((t) => t.discarded !== null && t.discarded.transcript === null && !isBelowFloor(t.duration_seconds)),
      departedStaffer: has((t) => t.discarded !== null && staffNameOfCard(t.discarded.by_staff_card_id, staffCards, staff) === '担当者不明'),
      recoveryTake: has((t) => t.local_audio && t.discarded === null),
      otherStore: has((t) => t.appointment_id === 'apt-11'),
    }).toEqual({
      currentConsent: true, staleConsent: true, absentConsent: true,
      richDiscard: true, belowFloorDiscard: true, noConsentDiscard: true,
      departedStaffer: true, recoveryTake: true, otherStore: true,
    })
  })
})

// ═══ W7-1 · CONSENT FAILS CLOSED IN EVERY MODE ══════════════════════════════

describe('⚖ W7-1 — the consent floor has exactly one predicate', () => {
  it('canStartRecording takes ONE argument, so no flag can be read beside it', () => {
    expect(canStartRecording.length).toBe(1)
    // …and the ONE thing it looks at is the consent state.
    const body = LIB_CODE.slice(LIB_CODE.indexOf('export function canStartRecording'))
      .slice(0, LIB_CODE.slice(LIB_CODE.indexOf('export function canStartRecording')).indexOf('}') + 1)
    expect(body).toContain("consent.state === 'current'")
    expect(body).not.toMatch(/\|\||\?\?/)
  })

  it('opens ONLY on a current grant — stale and absent both close it', () => {
    expect(canStartRecording({ state: 'current', grantedVersion: CONSENT_POLICY_VERSION, grantedDaysAgo: 1 })).toBe(true)
    expect(canStartRecording({ state: 'stale', grantedVersion: 'v1-2026-05', grantedDaysAgo: 120 })).toBe(false)
    expect(canStartRecording({ state: 'absent', grantedVersion: null, grantedDaysAgo: null })).toBe(false)
  })

  it('a STALE grant is not 同意なし — it says so in its own words', () => {
    const stale = consentOf('cus-06', consentGrants)
    expect(stale.state).toBe('stale')
    expect(CONSENT_LABEL[stale.state]).toBe('同意の記録が古い')
    expect(consentGateNote(stale, '見本 かえる')).toContain('いまの説明文とは違う内容')
    expect(consentProofLine(stale)).toContain('v1-2026-05')
    // A customer who genuinely consented is never told she did not.
    expect(consentGateNote(stale, '見本 かえる')).not.toContain('同意がまだ取得されていません')
  })

  it('an ABSENT grant closes the gate with the other sentence', () => {
    const absent = consentOf('cus-07', consentGrants)
    expect(absent.state).toBe('absent')
    expect(consentGateNote(absent, '見本 きり')).toContain('まだ取得されていません')
  })

  it('a null customer (an unbound take) never opens the gate', () => {
    expect(canStartRecording(consentOf(null, consentGrants))).toBe(false)
  })

  it('THE SERIALIZED GATE: every picker option carries the one answer, and the stale one is closed', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const stale = props.contexts.find((c) => c.customerId === 'cus-06')
    expect(stale).toBeDefined()
    expect({ state: stale!.consentState, canStart: stale!.canStart }).toEqual({ state: 'stale', canStart: false })
    for (const c of props.contexts) {
      expect({ id: c.appointmentId, ok: c.canStart }).toEqual({
        id: c.appointmentId,
        ok: consentOf(c.customerId, consentGrants).state === 'current',
      })
    }
  })

  it('the screen never re-decides the gate — it renders `canStart` and the demo consent, and nothing else', () => {
    // The ONE widening term is a consent taken through the read-aloud flow.
    expect(SCREEN_CODE).toContain('current.canStart || demoConsent[current.appointmentId] === true')
    // No mode, no flag, no permissive field anywhere near the record control:
    // `canStart` is read EXACTLY once in the whole screen, and the one term
    // beside it is another CONSENT.
    // `canStart` is READ exactly twice: once to decide whether the record button
    // may fire, and once to say 「同意あり（デモ）」 rather than 「同意あり」 when the
    // grant came from the read-aloud flow instead of the record. Neither reading
    // widens the gate, and the third occurrence is the prop's own declaration.
    expect([...SCREEN_CODE.matchAll(/current\.canStart/g)].length).toBe(2)
    expect(SCREEN_CODE).not.toMatch(/\b(forceStart|allowStart|bypassConsent|overrideConsent|skipConsent)\b/)
    // ⚠ AND THE GATE EXPRESSION IS PINNED WHOLE, not merely scanned for known
    // bad words. The W7 candidate's defect was a permissive field read BESIDE
    // the consent — `|| mode === 'x'`, `|| row.optional` — and no denylist can
    // anticipate the next spelling of that. Pinning the expression means ANY
    // extra term fails the round, and a legitimate new prerequisite has to be
    // added as an `&&` here with its own argument.
    const gate = SCREEN_CODE.match(/const consentOk = ([^\n]+)/)?.[1]
    expect(gate).toBe(
      "current !== null && (current.canStart || demoConsent[current.appointmentId] === true)",
    )
  })

  it('the read-aloud script is the CURRENT v2 one — it includes the photo clause', () => {
    const script = consentScript('見本 きり')
    expect(script).toContain('経過写真の撮影・保存')
    expect(script).toContain('録音データと写真はカルテ作成とサービス改善のみに使用されます')
    expect(script.startsWith('見本 きり様、')).toBe(true)
  })
})

// ═══ W7-2 · NO REASON-FREE DISCARD ROUTE EXISTS ═════════════════════════════

describe('⚖ W7-2 — every discard writes a reason', () => {
  it('the ledger refuses to build a row without a non-empty reason', () => {
    const planted: FixtureTake[] = takePlane.map((t) =>
      t.id === 'rs-0003' ? { ...t, discarded: { ...t.discarded!, reason: '   ' } } : t,
    )
    const rows = discardLedger(models({ takes: planted }), () => false)
    expect(rows.some((r) => r.takeId === 'rs-0003')).toBe(false)
    // …and the honest ones are all still there.
    expect(rows.length).toBe(models().filter((m) => m.discarded !== null).length - 1)
  })

  it('the BELOW-FLOOR discard went through the SAME dialog and carries a reason', () => {
    const below = takePlane.find((t) => t.discarded !== null && isBelowFloor(t.duration_seconds))!
    expect(below.discarded!.reason.trim().length).toBeGreaterThan(0)
    // 10秒未満 is DERIVED from the duration, never a STORED flag — the server
    // derives it the same way, so the two can never disagree — and there is no
    // reason MENU and no pre-select anywhere (⚖ 8/17's vocabulary ruling).
    expect(PLANE_CODE).not.toMatch(/below_floor\s*:/)
    expect(PLANE_CODE).not.toMatch(/reason_code|reason_category|REASON_OPTIONS/)
    expect(SCREEN_CODE).not.toMatch(/<select[^>]*reason|defaultValue=\{?'?破棄/)
  })

  it('the screen has ONE discard settle path and it is guarded by the text', () => {
    expect(SCREEN_CODE).toContain("if (text === '') return")
    // ONE function produces every receipt, and it is `settleDiscard`
    const settle = SCREEN_CODE.slice(SCREEN_CODE.indexOf('const settleDiscard = ()'))
    const body = settle.slice(0, settle.indexOf('\n  }') + 4)
    expect([...SCREEN_CODE.matchAll(/setReceipt\(\{/g)].length).toBe(
      [...body.matchAll(/setReceipt\(\{/g)].length,
    )
    // the confirm is ALSO disabled — belt and brace, and the guard above is the
    // belt. The second term is the refused write's own no-double-submit guard.
    expect(SCREEN_CODE).toContain("disabled={reason.trim() === '' || submitting}")
  })

  it('⚖ B1-12 — THE REFUSED WRITE IS A DESIGNED STATE: nothing settles, the text survives', async () => {
    // §4 asks for 「fail-closed submit rendering (typed text survives a refused
    // write state)」 and the room had none: the local settle always succeeded, so
    // the shape the reconnect lands on was the one part of the flow nobody had
    // designed. It is behind a named param (the `?recovery=1` precedent) because
    // a dialog that ALWAYS fails claims a failure that did not happen.
    const off = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(off.props.discardFail).toBeNull()

    // BOTH variants, and they are DIFFERENT sentences — 「we could not write it」
    // and 「it is too late」 send a staffer to two different next steps.
    const fail = await recordingProps({ locale: 'ja', store: STORE_A, discardFail: '1' })
    const stale = await recordingProps({ locale: 'ja', store: STORE_A, discardFail: 'stale' })
    expect(fail.props.discardFail).toEqual({
      submitLabel: '破棄中...',
      errorLine: '破棄を記録できませんでした。もう一度お試しください。',
    })
    expect(stale.props.discardFail).toEqual({
      submitLabel: '破棄中...',
      errorLine: 'この録音はすでに文字起こしに進んでいます。破棄できませんでした。',
    })
    expect(fail.props.discardFail!.errorLine).not.toBe(stale.props.discardFail!.errorLine)
    // an unknown value is NOT a failure — fail-closed on the DEMO, not on the room
    expect((await recordingProps({ locale: 'ja', store: STORE_A, discardFail: 'yes' })).props.discardFail).toBeNull()

    // ⚠ THE REFUSAL RETURNS ABOVE EVERYTHING THAT CHANGES STATE. Nothing is
    // discarded until the trace has landed, so the branch sits above the receipt,
    // above `setRecoveryDismissed` and above `reset()` — pinned on the ORDER,
    // because a refusal that had already reset the machine would be the exact
    // defect the phone's own dialog comment names.
    const settle = SCREeN_SETTLE()
    const at = settle.indexOf('if (props.discardFail !== null) {')
    expect(at).toBeGreaterThan(-1)
    for (const after of ['setReceipt({', 'setRecoveryDismissed(true)', 'reset()']) {
      expect({ line: after, before: settle.indexOf(after) > at }).toEqual({ line: after, before: true })
    }
    // …and the typed reason is NEVER cleared on that path: `setReason('')` lives
    // only past the refusal, and in `closeDiscard`.
    expect(settle.slice(0, at)).not.toContain("setReason('')")
    // the confirm wears 破棄中... while it waits, and the error renders inline
    expect(SCREEN_CODE).toContain("{submitting && props.discardFail ? props.discardFail.submitLabel : '破棄する'}")
    expect(SCREEN_CODE).toContain('{submitError && <p className="rc-dlg-error" role="alert">{submitError}</p>}')
    // every exit is shut while it waits, in ONE place — cancel, backdrop and
    // Escape all route through `closeDiscard`.
    expect(SCREEN_CODE).toContain('if (submitting) return')
    expect(SCREEN_CODE).toContain('disabled={submitting} onClick={closeDiscard}')
    // …and the two strings are the PHONE's, verbatim
    expect(DISCARD_SUBMITTING_LABEL).toBe('破棄中...')
    expect(DISCARD_FAILED_LINE).toBe('破棄を記録できませんでした。もう一度お試しください。')
    expect(DISCARD_STALE_LINE).toBe('この録音はすでに文字起こしに進んでいます。破棄できませんでした。')
  })

  it('EVERY close path clears the field exactly once', () => {
    // Cancel, Escape and the backdrop all route through `closeDiscard`.
    expect(SCREEN_CODE).toContain('const closeDiscard = useCallback(')
    expect([...SCREEN_CODE.matchAll(/setReason\('' \)|setReason\(''\)/g)].length).toBe(2) // closeDiscard + settle
    expect(SCREEN_CODE).toContain("if (dialog === 'discard') {\n      closeDiscard()")
  })

  it('the dialog copy is the phone’s, verbatim', () => {
    for (const line of [
      '録音を破棄する理由',
      '破棄する理由を入力してください（必須）',
      '破棄の記録（日時・担当者・理由）が残ります。',
      '破棄する',
    ]) {
      expect(SCREEN_CODE).toContain(line)
    }
  })
})

// ═══ W7-3 · RECOVERY PARITY, SINGLE-SLOT ════════════════════════════════════

describe('⚖ W7-3 — one recovery slot, one action', () => {
  it('the props carry ONE recovery object or none — never two offers', async () => {
    const off = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(off.props.recovery).toBeNull()
    const on = await recordingProps({ locale: 'ja', store: STORE_A, recovery: '1' })
    expect(on.props.recovery).not.toBeNull()
    expect(Array.isArray(on.props.recovery)).toBe(false)
  })

  it('the banner offers ONE commit, and the discard exit only for a below-floor take', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, recovery: '1' })
    expect(props.recovery!.belowFloor).toBe(true)
    // exactly one 保存する control in the banner's markup
    expect([...SCREEN_CODE.matchAll(/rc-recovery-save/g)].length).toBe(1)
    expect(SCREEN_CODE).toContain('{recovery.belowFloor && (')
    // …and no ✕ / no 破棄 button beside 保存する
    const banner = SCREEN_CODE.slice(SCREEN_CODE.indexOf('rc-recovery"'), SCREEN_CODE.indexOf('</section>', SCREEN_CODE.indexOf('rc-recovery"')))
    expect(banner).not.toContain('rc-danger')
  })

  it('⚖ 8/26 (b) — THE DISCARD DIALOG KNOWS WHO OPENED IT, AND THE EXIT EXITS', () => {
    // ⚠ THE BLOCKER THIS ROUND FIXED. Two different controls opened ONE
    // parameterless dialog, and the settle then read the RECORDER's context
    // whichever had been pressed: throwing away yesterday's 6-second residue
    // printed a receipt naming TODAY's 10:00 booking — a different customer, a
    // different session, a different day — and left the banner standing.
    //
    // Pinned on the SOURCE because this file cannot mount a React tree; the
    // browser probe operates BOTH entry points and reads the receipt's VALUES.
    expect(SCREEN_CODE).toContain("const [discardOf, setDiscardOf] = useState<'recorder' | 'recovery'>('recorder')")
    // BOTH open sites set the context — and there are exactly two of them.
    const opens = [...SCREEN_CODE.matchAll(/setDialog\('discard'\)/g)].length
    expect(opens).toBe(2)
    expect([...SCREEN_CODE.matchAll(/setDiscardOf\('(recorder|recovery)'\); setDialog\('discard'\)/g)].length).toBe(2)
    // the settle BRANCHES on it, and the recovery branch builds from
    // `props.recovery` rather than from the picker's booking
    const settle = SCREeN_SETTLE()
    expect(settle).toContain("if (discardOf === 'recovery')")
    expect(settle).toContain('const r = props.recovery')
    expect(settle).toContain('r.recordedAtLabel')
    // ⚠ AND `reset()` FIRES ONLY ON THE RECORDER PATH — the banner is not the
    // machine, and resetting a recorder that was never recording is a lever
    // pretending to have done something.
    const recoveryBranch = settle.slice(settle.indexOf("if (discardOf === 'recovery')"), settle.indexOf('} else {'))
    expect(recoveryBranch).not.toContain('reset()')
    expect(settle).toContain('setRecoveryDismissed(true)')
    // ⚠ AND THE RECOVERY BRANCH NEVER READS THE PICKER AT ALL. That is what
    // makes the zero-booking world work: the banner renders above the
    // 本日の予約がありません state, so `current` is null there and a settle that
    // consulted it filled in a required field, showed a live 破棄する, and
    // returned in silence — the standing lane law's own example of a silent
    // failure. The ONE `current === null` guard belongs to the RECORDER branch,
    // where it is true (it is the picked session's take being thrown away).
    expect(recoveryBranch).not.toContain('current')
    expect([...settle.matchAll(/current === null/g)].length).toBe(1)
    expect(settle.slice(settle.indexOf('} else {'))).toContain('if (current === null) return')
    // …and the SCREEN reads the dismissible slot, never the raw prop, at the
    // banner (a server prop cannot be cleared, which is why the exit never
    // exited).
    expect(SCREEN_CODE).toContain('const recovery = recoveryDismissed ? null : props.recovery')
    expect(SCREEN_CODE).toContain('{recovery && (')
  })

  it('⚖ B1-4 — the receipt’s 日時 is the DISCARD’s moment, in JST, and it is the room’s ONE clock', () => {
    // Two of the receipt's four fields used to state the same fact — the
    // booking's start time — and the one the dialog had just promised
    // (「破棄の記録（日時・担当者・理由）が残ります。」) was absent.
    const settle = SCREeN_SETTLE()
    expect(settle).toContain('const when = JST_STAMP.format(new Date())')
    expect(settle).not.toContain('current.dateLabel')
    // JST is EXPLICIT: the ledger this receipt stands in for is a JST record.
    const stamp = SCREEN_CODE.slice(SCREEN_CODE.indexOf('const JST_STAMP'))
    expect(stamp.slice(0, stamp.indexOf('})') + 2)).toContain("timeZone: 'Asia/Tokyo'")
    // ⚠ AND IT IS THE ONLY CLOCK OR FORMATTER IN THE SCREEN. Every RENDER-TIME
    // date still crosses the boundary as a server-formatted string; this one is
    // a post-interaction fact, so there is no first render for it to disagree
    // with (canon stamps it the same way, :843).
    expect([...SCREEN_CODE.matchAll(/new Date\(/g)].length).toBe(1)
    expect([...SCREEN_CODE.matchAll(/Intl\./g)].length).toBe(1)
    expect(SCREEN_CODE).not.toMatch(/toLocaleString|toLocaleDateString|fixtures/)
  })

  it('⚖ B1-11 — an UNBOUND residue is told to PICK A CUSTOMER, in the phone’s own words', async () => {
    // The room's only recovery take is unbound (`appointment_id: null`). It
    // correctly named the customer 「未選択（保存時に選択）」 — and then the button
    // said 保存する and the caption said 「保存するまでこの案内が残ります。」, so the
    // one recovery state this room ships told the staffer the wrong next step.
    // An unbound take has no destination yet; the phone branches on exactly that
    // (`RecoveryBanner.tsx:181-187`) and both strings are taken verbatim.
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, recovery: '1' })
    expect(props.recovery!.customerLabel).toBe('未選択（保存時に選択）') // recording.recoverCustomerUnset
    expect(props.recovery!.saveLabel).toBe('お客様を選んで保存する') // recording.recoverPickAndSaveAction
    // recording.recoverCaptionUnbound — 「録音日（{date}）の…」, and `{date}` is the
    // recording DAY alone, exactly as the phone fills it
    expect(props.recovery!.caption).toMatch(/^録音日（\d+月\d+日\(.\)）の予約リストからお客様を選びます。$/)
    expect(props.recovery!.caption).not.toContain('保存するまでこの案内が残ります')
    // …and the BOUND wording is still what a bound take gets — the branch is a
    // branch, not a rename. Proven by handing the assembly a bound residue.
    // `apt-23` is a 銀座 booking with NO カルテ record, so the residue stays
    // 復元可能 (a record would make it 保存済み) and only its BINDING changes.
    const bound = takePlane.map((t) =>
      t.local_audio && t.appointment_id === null
        ? { ...t, appointment_id: 'apt-23', store_id: null, day_offset: null }
        : t,
    )
    const b = (await recordingProps({ locale: 'ja', store: STORE_A, recovery: '1', world: { takes: bound } })).props
    expect(b.recovery!.saveLabel).toBe('保存する') // recording.recoverSaveAction
    expect(b.recovery!.caption).toBe('録音は消えません。保存するまでこの案内が残ります。') // recording.recoverCaption
    expect(b.recovery!.customerLabel).not.toBe('未選択（保存時に選択）')
    // ⚠ THE ACTION STILL REFUSES, with the refusal grammar unchanged — what
    // branched is the NEXT STEP it names, never whether it commits.
    expect(SCREEN_CODE).toContain("refused(recovery.saveLabel, props.refusals.save, { className: 'rc-recovery-save' })")
  })

  it('the copy is accurate to the plane’s numbers, and never claims an auto-SAVE', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, recovery: '1' })
    const take = takePlane.find((t) => t.local_audio)!
    expect(props.recovery!.lengthLabel).toBe(`${take.duration_seconds}秒`)
    // ⚠ §2b-8's cross-lane crumb: the phone's auto-stop copy says 「自動的に保存
    // しました」 and the 2h cap only STOPS. This room must not copy the lie.
    expect(props.recovery!.stopNote).toContain('停止しただけで保存はされない')
    expect(JSON.stringify(props)).not.toContain('自動的に保存しました')
  })
})

// ═══ W7-4 · POLICY COMES FROM THE PLANE, BY CONSTRUCTION ════════════════════

describe('⚖ W7-4 — no optimistic policy state exists', () => {
  it('the pinned version printed on the page IS the plane’s constant', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const row = props.trace.find((r) => r.label === '録音の同意')!
    expect(row.value).toContain(CONSENT_POLICY_VERSION)
  })

  it('the room owns no settings write — every policy lever refuses to a registry line', () => {
    expect(props0().refusals.policy).toContain('まだつないでいません')
    expect(props0().refusals.enroll).toContain('まだつないでいません')
  })

  it('the trace card claims NO org dial that does not exist on main', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const all = props.trace.map((r) => `${r.label} ${r.value}`).join(' ')
    // canon claimed a 保持期間 org setting and a configurable consent switch.
    expect(all).toContain('店舗ごとの切り替えはありません')
    expect(all).toContain('店舗ごとの保持期間の設定はありません')
    // the ONE trace link is a route that really exists today
    const links = props.trace.filter((r) => r.href !== null)
    expect(links.map((l) => l.label)).toEqual(['担当者の名簿'])
    expect(links[0].href).toContain('/business/shifts')
  })

  it('no policy string is assembled anywhere but the assembly', () => {
    expect(SCREEN_CODE).not.toContain(CONSENT_POLICY_VERSION)
    expect(SCREEN_CODE).not.toMatch(/保持期間|7日間/)
  })
})

/** A tiny synchronous handle on the demo props for the string pins above. */
let _props0: Awaited<ReturnType<typeof recordingProps>>['props'] | null = null
function props0() {
  if (!_props0) throw new Error('props0 used before beforeAll')
  return _props0
}
beforeAll(async () => {
  _props0 = (await recordingProps({ locale: 'ja', store: STORE_A })).props
})

// ═══ THE SIX STATES, DISCARDED FIRST ════════════════════════════════════════

describe('⚖ the take states and their precedence', () => {
  it('a DISCARDED session can never resurface as saved or actionable', () => {
    // Every combination of the other inputs, with the discard on.
    for (const hasRecord of [true, false]) {
      for (const settled of [true, false]) {
        for (const job of ['queued', 'running', 'done', 'failed', null] as const) {
          for (const jobError of ['empty-transcript', 'generic', null] as const) {
            for (const localAudio of [true, false]) {
              expect(takeStateOf({ discarded: true, hasRecord, settled, job, jobError, localAudio }).state).toBe('discarded')
            }
          }
        }
      }
    }
  })

  it('the other five read off real evidence', () => {
    const s = (o: Parameters<typeof takeStateOf>[0]) => takeStateOf(o).state
    const base = { discarded: false, hasRecord: false, settled: false, job: null, jobError: null, localAudio: false } as const
    expect(s({ ...base, hasRecord: true, settled: true })).toBe('saved')
    expect(s({ ...base, hasRecord: true, settled: false })).toBe('awaiting-check')
    expect(s({ ...base, job: 'running' })).toBe('processing')
    expect(s({ ...base, job: 'failed' })).toBe('failed')
    expect(s({ ...base, localAudio: true })).toBe('recoverable')
  })

  // ── the two SENTENCES the row prints, and where each one comes from ────────

  it('確認待ち says the phone’s OWN word — 「自動で保存されました」, never 処理中’s sentence', async () => {
    // ⚠ THE ROW USED TO CONTRADICT ITSELF TWO CELLS APART: 「カルテ K-0002」 …
    // 「確認待ち」 … 「まだ結果が届いていません」. The result HAD arrived — the row was
    // showing its id. `unsettled` is 処理中's reason; 確認待ち's is `autoSaved`.
    const base = { discarded: false, hasRecord: true, settled: false, job: null, jobError: null, localAudio: false } as const
    expect(takeStateOf(base)).toEqual({ state: 'awaiting-check', reason: 'autoSaved' })
    expect(TAKE_REASON_LINE.autoSaved).toBe('この録音は自動で保存されました（まだ確認されていません）')
    expect(TAKE_REASON_LINE.autoSaved).not.toBe(TAKE_REASON_LINE.unsettled)

    // …and the census on the SHIPPED props: every state's sub-line is the one
    // the phone's own map gives that state, with no state borrowing another's.
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const byState = new Map<string, Set<string | null>>()
    for (const t of props.takes) {
      if (!byState.has(t.stateLabel)) byState.set(t.stateLabel, new Set())
      byState.get(t.stateLabel)!.add(t.reasonLine)
    }
    expect([...(byState.get('確認待ち') ?? [])]).toEqual([TAKE_REASON_LINE.autoSaved])
    expect([...(byState.get('処理中') ?? [])].every((l) => l === TAKE_REASON_LINE.transcribing || l === TAKE_REASON_LINE.unsettled)).toBe(true)
    expect([...(byState.get('復元可能') ?? [])]).toEqual([TAKE_REASON_LINE.localAudio])
    expect([...(byState.get('保存済み') ?? [])]).toEqual([null])
    expect([...(byState.get('破棄済み') ?? [])]).toEqual([null])
  })

  it('the 失敗 sub-line is derived from `job_error` — never from whether the AUDIO survived', async () => {
    // ⚠ `local_audio` says whether the DEVICE still holds the take, which is a
    // different question and answers 復元可能. Deriving the failure SENTENCE from
    // it told a staffer their microphone had picked up nothing for an
    // infrastructure failure — and printed the right sentence on the demo plane
    // only because the one failed take happened to carry the one code.
    const base = { discarded: false, hasRecord: false, settled: false, job: 'failed', localAudio: false } as const
    for (const localAudio of [true, false]) {
      expect(takeStateOf({ ...base, localAudio, jobError: 'empty-transcript' }).reason).toBe('emptyTranscript')
      expect(takeStateOf({ ...base, localAudio, jobError: 'generic' }).reason).toBe('genericFailure')
      expect(takeStateOf({ ...base, localAudio, jobError: null }).reason).toBe('genericFailure')
    }
    // …and the plane carries BOTH codes with the SAME `local_audio`, so the two
    // rows differ in exactly the field the mapping reads and in nothing else.
    const failed = takePlane.filter((t) => t.job === 'failed')
    expect(new Set(failed.map((t) => t.job_error))).toEqual(new Set(['empty-transcript', 'generic']))
    expect(new Set(failed.map((t) => t.local_audio)).size).toBe(1)

    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const t of failed) {
      const row = props.takes.find((r) => r.id === t.id)!
      expect({ id: t.id, line: row.reasonLine }).toEqual({
        id: t.id,
        line: t.job_error === 'empty-transcript' ? TAKE_REASON_LINE.emptyTranscript : TAKE_REASON_LINE.genericFailure,
      })
    }
  })

  it('THE DEMO WORLD SHOWS ALL SIX', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(new Set(props.takes.map((t) => t.stateLabel))).toEqual(
      new Set(Object.values(TAKE_STATE_LABEL)),
    )
  })

  it('THREE of the discarded takes ALSO have a カルテ — which is what makes the precedence provable', () => {
    const recordApts = new Set(recordPlane.map((r) => r.appointment_id))
    const overlapping = takePlane.filter((t) => t.discarded !== null && t.appointment_id !== null && recordApts.has(t.appointment_id))
    expect(overlapping.length).toBeGreaterThanOrEqual(3)
    for (const t of overlapping) {
      const model = models().find((m) => m.id === t.id)
      if (!model) continue
      expect({ id: t.id, state: model.state, hasRecord: model.karuteRecordId !== null }).toEqual({
        id: t.id, state: 'discarded', hasRecord: true,
      })
    }
  })

  it('破棄済み is the QUIETEST chip — no red, no amber, no accent', () => {
    expect(TAKE_STATE_CHIP.discarded).toBe('rc-chip is-discarded')
    const css = readFileSync(join(process.cwd(), `${ROOM_DIR}/recording.css`), 'utf8')
    // it takes the BASE chip and states no colour of its own
    expect(css).not.toMatch(/\.rc-chip\.is-discarded\s*\{[^}]*(?:red|amber|accent)/i)
  })
})

// ═══ ⚖ R2 · A DISCARDED TAKE FEEDS NOTHING ══════════════════════════════════

describe('⚖ R2 — a discarded take feeds no number and offers no lever', () => {
  it('feedsCounts is the ONE structural gate', () => {
    expect(feedsCounts('discarded')).toBe(false)
    for (const s of ['saved', 'awaiting-check', 'processing', 'failed', 'recoverable'] as const) {
      expect(feedsCounts(s)).toBe(true)
    }
  })

  it('⚖ B1-5 — …AND IT HAS CONSUMERS: every suppression ROUTES THROUGH IT, none is hand-written', () => {
    // ⚠ THE DEFECT THIS PINS. `feedsCounts`'s own doc-comment claims 「ONE
    // predicate, called by every consumer that counts, totals or offers an
    // action, so a future consumer cannot forget the rule」 — and it was called
    // by NOTHING but the test above it. The two real suppressions were
    // hand-written `=== 'discarded'` in two different files, so the R2 property
    // held by luck (the room has no other count surface yet) and the next
    // number added would route around a gate that only existed on paper.
    //
    // Behaviour cannot see this — a hand-written copy of the rule gives the same
    // answer — so the pin is on the SOURCE, which is where the disease is.
    const call = /feedsCounts\(/g
    expect([...LIB_CODE.matchAll(call)].length).toBeGreaterThanOrEqual(2) // declared + ≥1 consumer
    expect([...stripComments(PROPS_SRC).matchAll(call)].length).toBeGreaterThanOrEqual(2)
    // …and the two consumers the room has today are exactly the two the finding
    // named: the ticket burn (a number's input) and the row's lever.
    expect(LIB_CODE).toContain('ticketRedeemed: feedsCounts(state) && take.ticket_redeemed,')
    expect(stripComments(PROPS_SRC)).toContain('action: !feedsCounts(t.state)')
    expect(stripComments(PROPS_SRC)).toContain('karuteRecordLabel: feedsCounts(t.state) ? t.karuteRecordId : null,')
    // ⚠ AND NO CONSUMER SPELLS THE RULE ITSELF. `'discarded'` is COMPARED in
    // exactly two places in the whole room: inside the gate, and on the row's
    // gray-treatment flag — which is a rendering verdict rather than a count or
    // a lever, and says so where it is set.
    const spellings = [
      ...LIB_CODE.matchAll(/[!=]== 'discarded'/g),
      ...stripComments(PROPS_SRC).matchAll(/[!=]== 'discarded'/g),
    ].length
    expect(spellings).toBe(2)
    expect(LIB_CODE).toContain("return state !== 'discarded'")
    expect(stripComments(PROPS_SRC)).toContain("isDiscarded: t.state === 'discarded',")
  })

  it('the ticket burn is withheld from the MODEL’s counting field on a discarded take', () => {
    const rich = models().find((m) => m.id === 'rs-0003')!
    const source = takePlane.find((t) => t.id === 'rs-0003')!
    expect({ plane: source.ticket_redeemed, model: rich.ticketRedeemed }).toEqual({ plane: true, model: false })
  })

  it('…but the MANAGER is still told the burn happened (⚖ 8/20 (b) — money never auto-reverses)', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const row = props.discardRows.find((r) => r.takeId === 'rs-0003')!
    expect(row.ticketNote).toContain('回数券を1回消化していました')
    expect(row.ticketNote).toContain('返却の要否')
  })

  it('EVERY discarded row offers NOTHING — no 開く, no 保存, no 再試行', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const discarded = props.takes.filter((t) => t.isDiscarded)
    expect(discarded.length).toBeGreaterThan(0)
    for (const t of discarded) {
      expect({ id: t.id, action: t.action, record: t.karuteRecordLabel }).toEqual({
        id: t.id, action: null, record: null,
      })
    }
  })

  it('the evidence is KEPT internally — the affordance is what is suppressed', () => {
    // The model still carries the karute id; only the SERIALIZED row nulls it.
    const rich = models().find((m) => m.id === 'rs-0003')!
    expect(rich.karuteRecordId).not.toBeNull()
  })

  it('⚖ R3 — there is NO unlink and ⚖ #547 — there is NO delete lever, anywhere', () => {
    expect(SCREEN_CODE).not.toMatch(/削除|unlink|紐付けを解除|リンクを外/)
    expect(PROPS_SRC).not.toMatch(/削除/)
  })

  it('⚖ R4 — there is no approval step on the review screen', () => {
    expect(SCREEN_CODE).not.toMatch(/承認する|却下|差し戻/)
  })
})

// ═══ THE ROLE SPLIT, PROVEN ABOVE SERIALIZATION ═════════════════════════════

describe('⚖ the three redactions happen above the serializer', () => {
  onAPinnedMonth()

  it('a STAFF reader’s props contain their OWN takes and no others', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    // ⚠ THE EXPECTED SET IS DERIVED FROM THE PLANE, NOT FROM `buildTakes`. The
    // first cut computed it by calling the same function the props go through,
    // so a mutation that widened the scope moved BOTH sides and the pin stayed
    // green — a pin true for the reason it was meant to catch. The plane says
    // who recorded what; the props must say the same thing about the operator
    // and nothing about anybody else.
    const bookings = new Map(appointments().map((a) => [a.id, a]))
    const mine = takePlane
      .filter((t) => t.by_staff_card_id === selfCard)
      .filter((t) => (t.appointment_id ? bookings.get(t.appointment_id)?.store_id === STORE_A : t.store_id === STORE_A))
      .map((t) => t.id)
    expect(mine.length).toBeGreaterThan(0)
    expect(props.takes.map((t) => t.id).sort()).toEqual([...mine].sort())
    // …and every take the plane says belongs to somebody ELSE is absent BY ID.
    const theirs = takePlane.filter((t) => t.by_staff_card_id !== selfCard).map((t) => t.id)
    const payload = JSON.stringify(props)
    for (const id of theirs) expect({ id, leaked: payload.includes(id) }).toEqual({ id, leaked: false })
  })

  it('the REDACTION happens above the serializer — a staff-access MODEL carries no reason and no transcript', () => {
    // ⚠ THE MODEL, NOT THE PAYLOAD, AND THAT IS THE POINT. The serialized take
    // row has no reason field at all, so a mutation that removes the redaction
    // inside `buildTakes` is invisible in the props — the outer gate holds and
    // the pin below stays green for a reason that is not the one it claims.
    // Both gates are real and both are stated: this one pins the INNER one,
    // which is the one the room's own comment says exists.
    const world = takePlane.map((t) =>
      t.id === 'rs-0003'
        ? { ...t, by_staff_card_id: selfCard!, discarded: { ...t.discarded!, by_staff_card_id: selfCard! } }
        : t,
    )
    const staffModels = models({ takes: world, access: staffAccess })
    const mine = staffModels.find((m) => m.id === 'rs-0003')
    expect(mine).toBeDefined()
    // the ROW survives — existence is never hidden, from anyone, including the
    // person who discarded it (⚖ 8/20 ①)…
    expect(mine!.state).toBe('discarded')
    expect(mine!.discarded).not.toBeNull()
    expect(mine!.discarded!.byName.length).toBeGreaterThan(0)
    // …and its CONTENT is withheld, because the room opens no door to it for a
    // reader without the 破棄の記録 review (⚖ 8/20 ②).
    expect({ reason: mine!.discarded!.reason, transcript: mine!.discarded!.transcript }).toEqual({
      reason: null, transcript: null,
    })
    // the same reader WITH the review gets both.
    const managerView = models({ takes: world }).find((m) => m.id === 'rs-0003')!
    expect(managerView.discarded!.reason).not.toBeNull()
    expect(managerView.discarded!.transcript).not.toBeNull()
  })

  it('a STAFF reader is handed NO discard reason and NO transcript — not even their own', async () => {
    // ⚠ THE DEMO WORLD HAS NO STAFF-OWNED DISCARD, so a pin taken on it would be
    // green for the wrong reason: the content is absent because the ROW is
    // absent. This world gives the operator a discard of her own, so the only
    // thing that can keep the reason out of the payload is the redaction.
    const world = takePlane.map((t) =>
      t.id === 'rs-0003'
        ? { ...t, by_staff_card_id: selfCard!, discarded: { ...t.discarded!, by_staff_card_id: selfCard! } }
        : t,
    )
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ', takes: world } })
    expect(props.takes.some((t) => t.id === 'rs-0003')).toBe(true)
    const payload = JSON.stringify(props)
    const source = world.find((t) => t.id === 'rs-0003')!
    expect(payload).not.toContain(source.discarded!.reason)
    for (const seg of source.discarded!.transcript ?? []) expect(payload).not.toContain(seg.text)
    // …and no colleague content either, in the demo world.
    const plain = JSON.stringify((await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })).props)
    for (const t of takePlane) {
      if (t.discarded === null) continue
      expect({ take: t.id, leaked: plain.includes(t.discarded.reason) }).toEqual({ take: t.id, leaked: false })
      for (const seg of t.discarded.transcript ?? []) {
        expect({ take: t.id, leaked: plain.includes(seg.text) }).toEqual({ take: t.id, leaked: false })
      }
    }
  })

  it('⚖ B2-1 — the COUNTS are gated where the ROWS are, so a staff persona’s props carry none', async () => {
    // ⚠ THE DEMO OPERATOR OWNS NO DISCARD, so a pin taken on the demo world
    // would be green because the block is EMPTY rather than because it is
    // ABSENT — the same trap the reason pin above was written to avoid. This
    // world gives her one, and a per-staff count row still never appears.
    const world = takePlane.map((t) =>
      t.id === 'rs-0003'
        ? { ...t, by_staff_card_id: selfCard!, discarded: { ...t.discarded!, by_staff_card_id: selfCard! } }
        : t,
    )
    const staffSide = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ', takes: world } })
    expect(staffSide.props.counts).toBeNull()
    // her OWN monthly line is ungated self-knowledge and is still there
    expect(staffSide.props.ownDiscardLine).toMatch(/^自分が今月破棄した録音 \d+件$/)
    // the payload carries no count sentence at all…
    const payload = JSON.stringify(staffSide.props)
    expect(payload).not.toContain('記録されている破棄')
    expect(payload).not.toContain('スタッフ別')
    // …and the manager door is unchanged. (This `it` and the 25-staff one below
    // both went red AT THE PARENT TIP on 2026-09-01, on the calendar rollover
    // alone — which is what put the whole file on a pinned clock.)
    const manager = await recordingProps({ locale: 'ja', store: STORE_A, world: { takes: world } })
    expect(manager.props.counts).not.toBeNull()
    expect(manager.props.counts!.totalLine).toMatch(/^記録されている破棄 全[1-9]\d*件$/)
    expect(manager.props.counts!.byStaff.length).toBeGreaterThan(0)
  })

  it('a STAFF reader gets no 破棄の記録 screen and no ledger rows', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect({ review: props.canReviewDiscards, rows: props.discardRows.length }).toEqual({ review: false, rows: 0 })
  })

  it('a MANAGER gets the store’s takes and the review', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.canReviewDiscards).toBe(true)
    expect(props.discardRows.length).toBeGreaterThan(0)
    expect(props.historyCaption).toContain('この店舗の録音')
  })

  it('⚖ B1-9 — the HEAD’s own sentence is access-derived, and never promises a screen the reader cannot open', async () => {
    // 破棄の記録 exists only for `discardReview`, and §2e-2 makes the スタッフ
    // reader a proven, first-class mode of this room — so a hardcoded head
    // sentence promising 「破棄された録音の記録」 was the page's OPENING line being
    // false for one of its two personas. `historyCaption`, `noticeLines` and
    // `ownDiscardLine` were all already derived; this one is now too.
    const manager = (await recordingProps({ locale: 'ja', store: STORE_A })).props
    const staffProps = (await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })).props
    expect(manager.headGuide).toContain('破棄された録音の記録')
    expect(staffProps.headGuide).not.toContain('破棄')
    // …and what each one IS promised is exactly what they can open
    expect({ says: manager.headGuide.includes('破棄'), can: manager.canReviewDiscards })
      .toEqual({ says: true, can: true })
    expect({ says: staffProps.headGuide.includes('破棄'), can: staffProps.canReviewDiscards })
      .toEqual({ says: false, can: false })
    // both are real tour copy, and both obey the tour's PLAIN-COPY rule — the
    // scan the interactions suite runs on every literal declaration, run here on
    // the two strings this one assembles.
    for (const g of [manager.headGuide, staffProps.headGuide]) {
      expect(g.startsWith('施術中の会話を録音して、その録音からカルテを作る画面です。')).toBe(true)
      expect(g.length).toBeGreaterThan(60)
      expect(g).not.toMatch(/registry|props|fixture|API|DTO|W7|SDK/i)
      expect(g).not.toMatch(/\d+秒未満/)
    }
    // the screen READS it rather than restating it
    expect(SCREEN_CODE).toContain('data-guide={props.headGuide}')
    expect(SCREEN_CODE).not.toContain('破棄された録音の記録をまとめて')
  })

  it('an UNKNOWN role fails closed (Object.hasOwn, not a bare index)', () => {
    for (const role of ['constructor', '__proto__', 'toString', '謎の役職']) {
      expect(accessFor(role)).toEqual({ storeWide: false, discardReview: false })
    }
  })

  it('the notice says what is TRUE about the transcript rule — never a hardcoded verdict', () => {
    for (const access of [managerAccess, staffAccess]) {
      const lines = permissionNotice(access).join(' ')
      expect(lines).toContain('文字起こしの閲覧は店舗の設定に従います（未接続）。')
      expect(lines).not.toContain('管理者も文字起こしは見られません')
    }
  })
})

// ═══ ⚖ THE STORE ISOLATION LAW ══════════════════════════════════════════════

describe('⚖ 8/17 — the store lens is the gate, and it leaves nothing behind', () => {
  it('the other store’s takes never ENTER the 銀座 props', async () => {
    const a = await recordingProps({ locale: 'ja', store: STORE_A })
    const b = await recordingProps({ locale: 'ja', store: STORE_B })
    expect(a.props.takes.some((t) => t.id === 'rs-0020' || t.id === 'rs-0021')).toBe(false)
    expect(b.props.takes.some((t) => t.id === 'rs-0021')).toBe(true)
  })

  it('LEAVES NOTHING BEHIND — BOTH DIRECTIONS, ids, reasons, transcripts and store-only names', async () => {
    // ⚠ THE SCAN RUNS BOTH WAYS. It used to run one — the 銀座 payload searched
    // for 代官山 strings — and a one-directional pin cannot tell a real gate from
    // a gate that only happens to face one way.
    const props = {
      [STORE_A]: (await recordingProps({ locale: 'ja', store: STORE_A })).props,
      [STORE_B]: (await recordingProps({ locale: 'ja', store: STORE_B })).props,
    }
    const takesOf = (store: string) =>
      takePlane.filter((t) =>
        t.appointment_id
          ? appointments().find((a) => a.id === t.appointment_id)?.store_id === store
          : t.store_id === store,
      )
    const customersOf = (store: string) =>
      new Set(appointments().filter((a) => a.store_id === store).map((a) => a.customer_id))

    for (const [lens, other] of [[STORE_A, STORE_B], [STORE_B, STORE_A]] as const) {
      const payload = JSON.stringify(props[lens])
      const theirs = takesOf(other)
      expect(theirs.length).toBeGreaterThan(0) // …or the direction proves nothing
      for (const t of theirs) {
        expect({ lens, take: t.id, leaked: payload.includes(t.id) }).toEqual({ lens, take: t.id, leaked: false })
        for (const seg of t.discarded?.transcript ?? []) {
          expect({ lens, take: t.id, leaked: payload.includes(seg.text) }).toEqual({ lens, take: t.id, leaked: false })
        }
        if (t.discarded) {
          expect({ lens, take: t.id, leaked: payload.includes(t.discarded.reason) }).toEqual({ lens, take: t.id, leaked: false })
        }
      }
      // …and no customer only the OTHER store ever sees
      const mine = customersOf(lens)
      for (const id of [...customersOf(other)].filter((c) => !mine.has(c))) {
        const name = customers.find((c) => c.id === id)!.name
        expect({ lens, name, leaked: payload.includes(name) }).toEqual({ lens, name, leaked: false })
      }
    }
  })

  it('THE ROSTER BRIDGE IS CLAMPED TOO — a foreign store’s card resolves 担当者不明, and the pin is LIVE', async () => {
    // The sharpest NAME question in the room: an UNBOUND take recorded by a card
    // that belongs to the other store's staffer. `staffNameOfCard` bridges
    // through the door's CLAMPED roster on all three tiers, so the 銀座 lens
    // cannot name him — and the pin is live rather than vacuous, because the
    // very same plant under the 代官山 lens DOES name him.
    const unbound = takePlane.find((t) => t.id === 'rs-0007')!
    const plant = (storeId: string): FixtureTake[] => [
      ...takePlane,
      { ...unbound, id: 'rs-9200', store_id: storeId, by_staff_card_id: 'c-02' },
    ]
    const a = await recordingProps({ locale: 'ja', store: STORE_A, world: { takes: plant(STORE_A) } })
    const b = await recordingProps({ locale: 'ja', store: STORE_B, world: { takes: plant(STORE_B) } })
    const rowA = a.props.takes.find((t) => t.id === 'rs-9200')!
    const rowB = b.props.takes.find((t) => t.id === 'rs-9200')!
    expect(rowB.byName).not.toBe('担当者不明') // …the probe is live
    expect(rowA.byName).toBe('担当者不明')
    expect(JSON.stringify(a.props)).not.toContain(rowB.byName)
  })

  it('an UNBOUND take is clamped by its own store, and a storeless one is hidden', () => {
    const planted: FixtureTake[] = [
      ...takePlane,
      { ...takePlane.find((t) => t.id === 'rs-0007')!, id: 'rs-9000', store_id: STORE_B },
      { ...takePlane.find((t) => t.id === 'rs-0007')!, id: 'rs-9001', store_id: null, appointment_id: null },
    ]
    const ids = models({ takes: planted }).map((m) => m.id)
    expect(ids).not.toContain('rs-9000')
    expect(ids).not.toContain('rs-9001')
  })

  it('the store count never enters the page (⚖ N-STORES: one store lens)', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    // ⚠ 「全店舗」 IS EXCLUDED FROM THE SCAN ON PURPOSE: `menu-06` is literally
    // named 「見本 全店舗メニュー」 in the world, so matching it would fail on a
    // MENU NAME rather than on a store count. What must never appear is a
    // BUSINESS-WIDE figure or a cross-store read.
    expect(JSON.stringify(props)).not.toMatch(/店舗を運営|\d+店舗|すべての店舗の録音/)
  })
})

// ═══ ⚖ #799 · THE TWO-SPACE ID BRIDGE ═══════════════════════════════════════

describe('⚖ #799 — names bridge card ↔ profile on BOTH keys', () => {
  it('resolves through user_id, through email, through the card’s own row, then 担当者不明', () => {
    // c-04 links only by user_id (it carries no email)
    expect(staffNameOfCard('c-04', staffCards, staff)).toBe('見本 しろう')
    // c-01 links only by email (user_id is null)
    expect(staffNameOfCard('c-01', staffCards, staff)).toBe('見本 はなこ')
    // c-03 is a card id that IS a profile id — ⚖ 「the card's own name」
    expect(staffNameOfCard('c-03', staffCards, staff)).toBe('テスト さぶろう')
    // c-08 resolves to nothing — the DEPARTED staffer
    expect(staffNameOfCard('c-08', staffCards, staff)).toBe('担当者不明')
  })

  it('a departed staffer’s row still renders — losing the person is not losing the record', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const row = props.discardRows.find((r) => r.takeId === 'rs-0006')
    expect(row).toBeDefined()
    expect(row!.byName).toBe('担当者不明')
    expect(row!.reason.length).toBeGreaterThan(0)
  })

  it('the SELF scope bridges the other way, or a staffer’s own history would be empty', () => {
    expect(selfCard).toBe('c-06')
    expect(cardIdOfStaff(null, staffCards, staff)).toBeNull()
    expect(cardIdOfStaff('p-99', staffCards, staff)).toBeNull()
  })

  it('the plane stores CARD ids, never profile ids or names', () => {
    for (const t of takePlane) {
      expect(t.by_staff_card_id.startsWith('c-')).toBe(true)
      if (t.discarded) expect(t.discarded.by_staff_card_id.startsWith('c-')).toBe(true)
    }
  })
})

// ═══ ⚖ 8/25 · THE COUNTS, BOTH WAYS, AS LABELLED PLAIN FACTS ════════════════

describe('⚖ 8/25 ruling B — the counts', () => {
  onAPinnedMonth()

  it('both ways, and each number says WHAT it counts — the SHIPPED screen’s own sentences', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const { y, m } = jstYmd(new Date())
    const expected = discardCounts(models(), y, m)
    // ⚠ VERBATIM `settings.discardReasons.countThisMonth` / `.countTotal` /
    // `.byStaffTitle`. The 8/31 mock's shorter 「累計 N件」 is NOT adopted
    // (deviation R6-11): the layout is the mock's, the words are the phone's, so
    // a phone-daily manager meets the same sentence on both doors.
    expect(props.counts!.thisMonthLine).toBe(`今月の破棄 ${expected.thisMonth}件`)
    expect(props.counts!.totalLine).toBe(`記録されている破棄 全${expected.total}件`)
    expect(props.counts!.byStaffLabel).toBe('スタッフ別（今月）')
    for (const s of props.counts!.byStaff) expect(s.line).toMatch(/^\d+件$/)
    // ⚠ AND THE PER-STAFF ROWS ARE KEYED BY CARD ID, not by name: two departed
    // staffers both resolve to 担当者不明, and a list keyed on the name would give
    // two different people one React key (⚖ #799's own two-space case).
    const rowKeys = props.counts!.byStaff.map((s) => s.rowKey)
    expect(new Set(rowKeys).size).toBe(rowKeys.length)
    expect(rowKeys.every((id) => id.length > 0)).toBe(true)
  })

  it('the per-staff block is heaviest-first and carries NO ranking colour or sort control', () => {
    const { y, m } = jstYmd(new Date())
    const counts = discardCounts(models(), y, m)
    const ns = counts.byStaff.map((s) => s.thisMonth)
    expect([...ns].sort((a, b) => b - a)).toEqual(ns)
    // ⚠ 「評価」 appears once in the screen — in the tour copy that says this
    // list is NOT one — so the scan looks for a CONTROL rather than the word.
    // ⚠ THE SCAN LOOKS FOR A CONTROL, NOT A WORD: the tour copy says out loud
    // that this list is not a ranking, so 「順位」 and 「評価」 both appear in it.
    expect(SCREEN_CODE).not.toMatch(/並べ替え|sort=|onSort|<select[^>]*(?:staff|count)/)
  })

  it('TRUNCATION IS HONEST past the read cap', () => {
    const many: TakeModel[] = Array.from({ length: 260 }, (_, i) => ({
      ...models().find((m) => m.discarded !== null)!,
      id: `syn-${i}`,
    }))
    const counts = discardCounts(many, jstYmd(new Date()).y, jstYmd(new Date()).m)
    expect({ truncated: counts.truncated, total: counts.total }).toEqual({ truncated: true, total: 200 })
  })

  it('the STAFF half is ungated self-knowledge — and NULL renders nothing, never 0', async () => {
    const { y, m } = jstYmd(new Date())
    expect(ownDiscardsThisMonth(models(), null, y, m)).toBeNull()
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    // The operator has no discard of her own this month, so the line reads 0件 —
    // an HONEST zero, computed from rows she can see. A null would render
    // nothing at all, which is the case the screen must also handle.
    expect(props.ownDiscardLine === null || /^自分が今月破棄した録音 \d+件$/.test(props.ownDiscardLine)).toBe(true)
    expect(SCREEN_CODE).toContain('{props.ownDiscardLine && <> ・ {props.ownDiscardLine}</>}')
  })
})

// ═══ F6 · THE COUNTS CANNOT LIE, AND THE WALK CANNOT STALL ══════════════════

describe('F6 — the four truths the final stress sweep bought', () => {
  onAPinnedMonth()

  /** A salon closed for a fortnight: takes on day 0, −1, −40, −41, −80. Nothing
   *  in the demo plane has a gap wider than a week, which is exactly why no
   *  existing pin caught F6-1. */
  const gapped = [0, -1, -40, -41, -80].map((d) => ({ dayKey: 20000 + d }))

  it('⚖ F6-1 — さらに表示 REVEALS on every press: the walk returns the step it landed on', () => {
    // The screen stores `walk.step + 1`, so the trace below is the button.
    const trace: Array<{ steps: number; visible: number; hidden: number }> = []
    let steps = 1
    for (let i = 0; i < 12; i += 1) {
      const walk = windowTakes(gapped, steps)
      trace.push({ steps, visible: walk.visible.length, hidden: walk.hidden })
      if (walk.hidden === 0) break
      steps = walk.step + 1
    }
    // every press strictly grows the window, and the walk reaches the end
    const sizes = trace.map((t) => t.visible)
    expect(sizes).toEqual([...new Set(sizes)])
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
    expect(trace[trace.length - 1].hidden).toBe(0)
    // …and the effective step really OVERTOOK the asked-for one, or the fix
    // would be pinning a number nothing moved.
    expect(windowTakes(gapped, 2).step).toBeGreaterThan(2)
    // the ordinary case is untouched: no gap, no extension
    expect(windowTakes([{ dayKey: 20000 }, { dayKey: 19999 }], 1).step).toBe(1)
    // …and the BUTTON really counts from the walk rather than from its own
    // state, which is the half a pure-function test cannot see.
    expect(SCREEN_CODE).toContain('onClick={() => setSteps(walk.step + 1)}')
    expect(SCREEN_CODE).not.toContain('setSteps((s) => s + 1)')
  })

  it('⚖ F6-5 (A8) — ONE row-eligibility predicate, so a count can never exceed the list', () => {
    const base = models().find((m) => m.discarded !== null)!
    // ⚠ STAMPED TO TODAY — an arithmetic pin never inherits the plane's calendar.
    const today = jstDayKey(new Date())
    const R = (reason: string) => ({ ...base.discarded!, reason, hasReason: reason.trim() !== '' })
    const world: TakeModel[] = [
      { ...base, id: 'f6-a', dayKey: today, discarded: R('理由あり1') },
      { ...base, id: 'f6-b', dayKey: today, discarded: R('') },
      { ...base, id: 'f6-c', dayKey: today, discarded: R('   ') },
      { ...base, id: 'f6-d', dayKey: today, discarded: R('理由あり2') },
    ]
    const { y, m } = jstYmd(new Date())
    const counts = discardCounts(world, y, m)
    const ledger = discardLedger(world, () => false)
    expect(ledger.length).toBe(2)
    expect(counts.total).toBe(ledger.length)
    expect(counts.thisMonth).toBe(ledger.length)
    expect(counts.byStaff.reduce((n, s) => n + s.thisMonth, 0)).toBe(ledger.length)
    // the predicate itself, on all four shapes — trim included
    expect(world.map(hasWrittenReason)).toEqual([true, false, false, true])
    expect(hasWrittenReason({ ...base, discarded: null })).toBe(false)
    // …and it is asked ONCE rather than re-spelled: neither consumer carries its
    // own reason test any more, which is the whole point of the fix.
    expect([...LIB_CODE.matchAll(/reason\.trim\(\) !== ''/g)].length).toBe(1)
  })

  it('⚖ F6-6 — one person’s month is ONE number: the own-count reads the SAME capped ledger', async () => {
    const base = models().find((m) => m.discarded !== null)!
    const mine = base.discarded!.byCardId
    const { y, m } = jstYmd(new Date())
    const today = jstDayKey(new Date())
    const many: TakeModel[] = Array.from({ length: 260 }, (_, i) => ({ ...base, id: `f6-own-${i}`, dayKey: today }))
    // past the cap the number is a FLOOR and not a count — the phone's own rule
    // (`myDiscardCountThisMonth` returns null the moment its read is partial),
    // so the line renders NOTHING rather than a bigger number than the band's.
    expect(ownDiscardsThisMonth(many, mine, y, m)).toBeNull()
    expect(discardCounts(many, y, m).truncated).toBe(true)
    // under the cap the two agree exactly, and the own-count is still there
    const few = many.slice(0, 30)
    const band = discardCounts(few, y, m).byStaff.find((s) => s.cardId === mine)!
    expect(ownDiscardsThisMonth(few, mine, y, m)).toBe(band.thisMonth)
    // a reason-less discard is not the reader's either
    const withBlank: TakeModel[] = [...few, { ...base, id: 'f6-blank', dayKey: today, discarded: { ...base.discarded!, reason: '  ', hasReason: false } }]
    expect(ownDiscardsThisMonth(withBlank, mine, y, m)).toBe(band.thisMonth)

    // ⚠ AND THE PREDICATE ASKS THE FACT, NOT THE REDACTED CONTENT. A staff
    // reader's reasons are ALWAYS redacted to `null` (`buildTakes`), so a
    // predicate that tested the content would judge every one of her own
    // discards reason-less and hand her 「自分が今月破棄した録音 0件」 for a
    // month in which she threw away four takes.
    const hers = takePlane.map((t) =>
      t.discarded !== null
        ? { ...t, by_staff_card_id: selfCard!, discarded: { ...t.discarded, by_staff_card_id: selfCard! } }
        : t,
    )
    const herModels = models({ takes: hers, access: staffAccess })
    const herDiscards = herModels.filter((m2) => m2.discarded !== null)
    expect(herDiscards.length).toBeGreaterThan(0)
    // the CONTENT really is gone…
    for (const m2 of herDiscards) expect(m2.discarded!.reason).toBeNull()
    // …and the FACT is not, so her own count is the real one
    expect(herDiscards.every(hasWrittenReason)).toBe(true)
    const hersThisMonth = herDiscards.filter((m2) => jstYmd(dayOfKey(m2.dayKey)).m === m).length
    expect(hersThisMonth).toBeGreaterThan(0)
    expect(ownDiscardsThisMonth(herModels, selfCard, y, m)).toBe(hersThisMonth)
    const staffSide = await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ', takes: hers } })
    expect(staffSide.props.ownDiscardLine).toBe(`自分が今月破棄した録音 ${hersThisMonth}件`)
  })

  it('⚖ F6-7 — the band GROUPS what the reader cannot tell apart, and says how many people it is', async () => {
    const base = models().find((m) => m.discarded !== null)!
    const { y, m } = jstYmd(new Date())
    const today = jstDayKey(new Date())
    const world: TakeModel[] = [
      ...Array.from({ length: 25 }, (_, i) => ({
        ...base, id: `f6-u-${i}`, dayKey: today,
        discarded: { ...base.discarded!, byCardId: `c-gone-${i}`, byName: '担当者不明' },
      })),
      { ...base, id: 'f6-named', dayKey: today, discarded: { ...base.discarded!, byCardId: 'c-06', byName: '見本 あずさ' } },
    ]
    const counts = discardCounts(world, y, m)
    // THE MODEL KEEPS EVERY CARD — ⚖ #799 / L1's B1-10: two departed staffers
    // are two different people and never share a row or a React key.
    expect(counts.byStaff.length).toBe(26)
    // …and the BAND prints the unresolvable ones once, with their number
    const band = staffBand(counts.byStaff)
    expect(band.length).toBe(2)
    const unknown = band.find((b) => b.name === '担当者不明')!
    expect({ people: unknown.people, thisMonth: unknown.thisMonth }).toEqual({ people: 25, thisMonth: 25 })
    expect(band.find((b) => b.name === '見本 あずさ')).toEqual({ rowKey: 'c-06', name: '見本 あずさ', thisMonth: 1, people: 1 })
    // heaviest first is kept, and the keys stay unique
    expect(band.map((b) => b.thisMonth)).toEqual([25, 1])
    expect(new Set(band.map((b) => b.rowKey)).size).toBe(band.length)
    // ONE unresolvable staffer is not a group — the departed case reads as it did
    const one = staffBand([{ cardId: 'c-gone-1', name: '担当者不明', thisMonth: 25 }, { cardId: 'c-06', name: '見本 あずさ', thisMonth: 5 }])
    expect(one.map((b) => ({ name: b.name, people: b.people }))).toEqual([
      { name: '担当者不明', people: 1 }, { name: '見本 あずさ', people: 1 },
    ])
    // …and the rendered line names the people, never a raw id
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const s of props.counts!.byStaff) expect(s.name).not.toMatch(/^c-|\bc-\d/)
  })
})

// ═══ ⚖ 8/25 RULING A · REASON + TRANSCRIPT, AND THE THREE ABSENCE STATES ════

describe('⚖ 8/25 ruling A — the reason and the evidence, side by side', () => {
  it('every ledger row carries BOTH halves, each labelled', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const r of props.discardRows) {
      expect(r.reason.length).toBeGreaterThan(0)
      expect(r.transcript !== null || r.absenceLine.length > 0).toBe(true)
    }
    expect(SCREEN_CODE).toContain('スタッフの記入した理由')
    expect(SCREEN_CODE).toContain('文字起こし（全文）')
  })

  it('the absence lines are the shipped screen’s, VERBATIM', () => {
    expect(TRANSCRIPT_ABSENCE_LINE.belowFloor).toBe(`録音が${BELOW_FLOOR_SEC}秒未満のため、文字起こしは行っていません。`)
    expect(TRANSCRIPT_ABSENCE_LINE.none).toBe('この録音の文字起こしはありません。')
    // …and a FAILED READ is a DISTINCT string, never folded into 「ありません」.
    expect(TRANSCRIPT_FAILED_LINE).toBe('文字起こしを読み込めませんでした。')
    expect(TRANSCRIPT_FAILED_LINE).not.toBe(TRANSCRIPT_ABSENCE_LINE.none)
  })

  it('⚖ B1-6 — the failed-read line is a CARRIED CONSTANT, not a prop that never renders', async () => {
    // It used to ride `RecordingProps` and the screen's interface with NO render
    // site anywhere, so a props census read as if THREE absence states render
    // when two do (`TranscriptAbsence` has exactly two members). R6-6's argument
    // is sound — a fixture plane cannot fail a read, so the fourth state has no
    // surface — but then the string must not ride the props either. The constant
    // stays exported, with its distinctness pin above, because the reconnect
    // needs the distinction (⚖ #798).
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect('transcriptFailedLine' in props).toBe(false)
    expect(JSON.stringify(props)).not.toContain(TRANSCRIPT_FAILED_LINE)
    expect(SCREEN_CODE).not.toContain('transcriptFailedLine')
    // …and the two states that DO render still each have their own render site.
    expect(SCREEN_CODE).toContain('{r.absenceLine}')
  })

  it('WHICH absence it is comes off the take’s own facts', () => {
    const below = models().find((m) => m.id === 'rs-0004')!
    const noConsent = models().find((m) => m.id === 'rs-0005')!
    expect(transcriptAbsenceOf(below)).toBe('belowFloor')
    expect(transcriptAbsenceOf(noConsent)).toBe('none')
  })

  it('an ABOVE-FLOOR discard keeps the words that WERE kept', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const rich = props.discardRows.find((r) => r.takeId === 'rs-0003')!
    expect(rich.transcript!.length).toBeGreaterThan(0)
  })

  it('⚖ 8/31 — the 5分 markers are DERIVED from the words’ own clock, never from line count', () => {
    // The plane carries CONTRACT-SHAPED segments (`recordings.upsertSegments`'s
    // own `{ start_time, end_time, text }`), so the reading panel's intervals are
    // a fact about when things were said rather than a decoration.
    const rich = takePlane.find((t) => t.id === 'rs-0003')!.discarded!.transcript!
    const entries = transcriptEntries(rich)
    const dividers = entries.filter((e) => e.kind === 'divider')
    const lines = entries.filter((e) => e.kind === 'line')
    expect(lines.length).toBe(rich.length)
    // one marker per interval the words actually land in, and the label is that
    // interval's own minute
    expect(dividers.map((d) => (d.kind === 'divider' ? d.label : ''))).toEqual(
      [...new Set(rich.map((s) => Math.floor(s.start_time / 300)))].filter((b) => b > 0).map((b) => `${b * 5}分`),
    )
    // …and the timestamps are the segments' own, in mm:ss
    expect(lines.map((l) => (l.kind === 'line' ? l.at : ''))).toEqual(rich.map((s) => fmtElapsed(s.start_time)))
    // a take whose words all sit inside the first interval gets NO marker
    expect(transcriptEntries([{ start_time: 4, end_time: 9, text: 'あ' }, { start_time: 200, end_time: 210, text: 'い' }])
      .filter((e) => e.kind === 'divider')).toEqual([])
    // every key is unique, so the panel can render them as a list
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
  })

  it('⚖ 8/25 — a length says WHAT it measures, EXACTLY, and it has one home', async () => {
    // ⚠ THE OLD LABEL ROUNDED: `Math.round(sec / 60)分` reads a 15分40秒 take as
    // 「16分」 and an 11-second take as 「1分」 — five times its real length, in
    // exactly the band where a manager is judging whether a written reason fits
    // the recording it explains.
    expect(durationText(null)).toBeNull()
    expect(durationText(11)).toBe('11秒')
    expect(durationText(940)).toBe('15分40秒')
    expect(durationText(2760)).toBe('46分') // a whole minute drops the empty 秒
    // ⚠ AND IT NAMES ITSELF EXACTLY ONCE. The word 長さ lives on the column
    // header at a desk and on the row's own `::before` at card widths, so a
    // 長さ inside the string as well printed it twice (v5's 1280 shot).
    expect(takeDurationLabel(8, true)).toBe('8秒（10秒未満）')
    expect(takeDurationLabel(null, false)).toBe('記録なし')
    expect(takeDurationLabel(2760, false)).not.toContain('長さ')
    // ONE home: both surfaces compose from the same two functions.
    expect(PROPS_SRC).not.toMatch(/Math\.round\([^)]*\/ 60\)/)
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const r of props.discardRows) {
      const source = takePlane.find((t) => t.id === r.takeId)!
      expect({ id: r.takeId, len: r.lengthText }).toEqual({
        id: r.takeId,
        len: durationText(source.duration_seconds) ?? '記録なし',
      })
    }
  })

  it('✓確認済み DOES NOT EXIST — the lever is REFUSED with the honest note (registry ⑩)', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.refusals.checked).toContain('確認済みの印を保存する機能はまだありません')
    expect(props.refusals.checked).toContain('作成と一覧のみ')
    expect(SCREEN_CODE).toContain("refused('確認済みにする', props.refusals.checked)")
  })
})

// ═══ THE ACCIDENTAL-TAP FLOOR ═══════════════════════════════════════════════

describe('⚖ the accidental-tap floor has ONE home in this room', () => {
  it('is DERIVED from the stamped duration, exactly as the server derives it', () => {
    expect(BELOW_FLOOR_SEC).toBe(10)
    expect(isBelowFloor(9)).toBe(true)
    expect(isBelowFloor(10)).toBe(false)
    expect(isBelowFloor(null)).toBe(false) // an unknown length is not a claim
  })

  it('the number appears ONCE in the room’s own source', () => {
    const plane = [...PLANE_CODE.matchAll(/BELOW_FLOOR_SEC = 10/g)].length
    expect(plane).toBe(1)
    expect(LIB_CODE).not.toMatch(/< ?10\b/)
    // …and the SCREEN never spells the threshold at all: the number a reader
    // sees comes off `durationLabel`, which the assembly builds from the
    // constant. A tour card that hardcoded 「10秒」 would be a second home for it
    // and would go stale the day the floor moves.
    expect(SCREEN_CODE).not.toMatch(/\d+秒未満/)
  })

  it('10秒未満 is a PLAIN FACT on the row, never a warning', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const below = props.takes.find((t) => t.id === 'rs-0004')!
    // ⚠ NO 「長さ」 IN THE STRING: the column header names it at a desk and the
    // row's own `::before` names it at card widths, so carrying it here as well
    // printed the word twice (this round's 1280 shot).
    expect(below.durationLabel).toBe('8秒（10秒未満）')
    expect(below.durationLabel).not.toContain('長さ')
  })
})

// ═══ THE PICKER ═════════════════════════════════════════════════════════════

describe('canon’s picker rule, and the 来店なし exclusion', () => {
  it('today’s bookings with a staffer, not a no-show, time-sorted', async () => {
    const now = new Date()
    const todays = appointments(now).filter((a) => a.store_id === STORE_A && jstDayKey(a.starts_at) === jstDayKey(now))
    const opts = pickerOptions({
      appointments: todays, customers, menus, staff, grants: consentGrants,
      todayKey: jstDayKey(now), minuteOf: jstMinuteOfDay,
      // `null` = NO SELF TO SCOPE TO, which returns the unscoped list — this
      // case is about canon's OWN four filters (day, staffed, cancelled,
      // no-show) and would be answering a different question with a scope on.
      // The staff scope has its own case below.
      ownStaffId: null,
    })
    expect(opts.length).toBeGreaterThan(0)
    // no no-show, no cancelled, no staffless
    const noshow = todays.filter((a) => a.board_state === 'noshow').map((a) => a.id)
    expect(noshow.length).toBeGreaterThan(0)
    for (const id of noshow) expect(opts.some((o) => o.appointmentId === id)).toBe(false)
    for (const o of opts) {
      const a = todays.find((x) => x.id === o.appointmentId)!
      expect({ id: a.id, staffed: a.staff_id !== null, cancelled: a.status === 'cancelled' }).toEqual({
        id: a.id, staffed: true, cancelled: false,
      })
    }
    // time-sorted
    const mins = opts.map((o) => o.startedMinute)
    expect([...mins].sort((a, b) => a - b)).toEqual(mins)
  })

  it('the picker is DISABLED while the machine is not idle', () => {
    expect(SCREEN_CODE).toContain("disabled={phase !== 'idle'}")
  })

  it('an operator with no OWN bookings today gets a DESIGNED empty state, not a blank', async () => {
    const now = new Date()
    const { props } = await recordingProps({
      locale: 'ja', store: STORE_A,
      world: { appointments: appointments(now).filter((a) => jstDayKey(a.starts_at) !== jstDayKey(now)) },
    })
    expect(props.contexts).toEqual([])
    // ⚠ AND IT SAYS WHOSE LIST IS EMPTY. The picker is staff-scoped (⚖ Liam F-1
    // R1-3), so 「本日の予約がありません」 would be a claim about the STORE — a
    // different sentence, and a false one on an evening when colleagues are
    // still working. The copy names the operator's own list instead.
    expect(props.emptyOwnScope).toEqual({
      title: '本日、あなたの担当の予約はありません',
      body: '予約が入ると、ここに時間順で並びます。録音は予約を選んでから始めます。',
    })
    expect(SCREEN_CODE).toContain('あなたの担当の予約はありません')
  })

  it('⚖ LIAM F-1 R1-3 — the picker is STAFF-SCOPED: bookings under your OWN name', async () => {
    const now = new Date()
    const todays = appointments(now).filter((a) => a.store_id === STORE_A && jstDayKey(a.starts_at) === jstDayKey(now))
    const mine = 'p-06'
    const scoped = pickerOptions({
      appointments: todays, customers, menus, staff, grants: consentGrants,
      todayKey: jstDayKey(now), minuteOf: jstMinuteOfDay, ownStaffId: mine,
    })
    const all = pickerOptions({
      appointments: todays, customers, menus, staff, grants: consentGrants,
      todayKey: jstDayKey(now), minuteOf: jstMinuteOfDay, ownStaffId: null,
    })
    // there IS something to exclude — a colleague's booking on the same day
    expect(all.length).toBeGreaterThan(scoped.length)
    // …and every option that survives is hers
    for (const o of scoped) {
      expect(todays.find((a) => a.id === o.appointmentId)!.staff_id).toBe(mine)
    }
    // ⚠ IT IS A READ, NOT A FILTER OVER A RENDERED LIST: a colleague's booking
    // never becomes an option, so nothing about it — a customer's name, a menu,
    // a consent state — is in the props at all.
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const ids = props.contexts.map((c) => c.appointmentId)
    const notHers = todays.filter((a) => a.staff_id !== mine).map((a) => a.id)
    expect(notHers.length).toBeGreaterThan(0)
    for (const id of notHers) expect(ids).not.toContain(id)
    // …and the label SAYS whose list it is and how long it is
    expect(props.pickerLabel).toBe(`あなたの担当の予約 ${props.contexts.length}件（${props.operatorName}・本日）`)
  })
})

// ═══ THE WINDOWED WALK (ANY-ROSTER-SIZE on the take dimension) ══════════════

describe('⚖ ANY-ROSTER-SIZE — the walk, and the 200-take world', () => {
  onAPinnedMonth()

  it('a step that reveals nothing is not a step', () => {
    const rows = [{ dayKey: 100 }, { dayKey: 40 }]
    const one = windowTakes(rows, 1)
    expect(one.visible.length).toBe(1)
    expect(one.hidden).toBe(1)
    // the next press must actually reveal the old row rather than sitting still
    let steps = 2
    let walk = windowTakes(rows, steps)
    while (walk.visible.length === one.visible.length && steps < 20) { steps += 1; walk = windowTakes(rows, steps) }
    expect(walk.visible.length).toBe(2)
  })

  it('the window is the span the room says it is', () => {
    expect(WINDOW_DAYS).toBe(7)
    expect(SCREEN_CODE).toContain('1週間ぶんずつさかのぼって')
  })

  it('⚖ B1-13 — the 録音履歴 caption NAMES the span it opens on, in ONE wording', async () => {
    // The phone's caption is 「過去7日間の自分の録音」 — a fixed window it can claim
    // because it has one. This room WALKS past 7 days on request, so it cannot
    // borrow that sentence; it said nothing about the span instead, and a list
    // that opens on a window and never mentions it reads as the whole history.
    const manager = (await recordingProps({ locale: 'ja', store: STORE_A })).props
    const staffProps = (await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })).props
    expect(manager.historyCaption).toBe('この店舗の録音（新しい順・まず1週間ぶん）')
    expect(staffProps.historyCaption).toBe('自分の録音（新しい順・まず1週間ぶん）')
    // ⚠ ONE WORDING FOR ONE SPAN (⚖ A8): the caption and さらに表示 say 「1週間ぶん」,
    // and neither surface ever spells it a second way.
    for (const src of [stripComments(PROPS_SRC), SCREEN_CODE]) {
      expect(src).not.toMatch(/7日ぶん|七日|過去7日間/)
    }
  })

  it('⚖ B1-13 — the 破棄の記録 empty state is the shipped sentence, trailing 。 and all', () => {
    // `settings.discardReasons.empty` = 「破棄の記録はまだありません。」 — the room
    // dropped the 。, which is a second wording for one state.
    expect(SCREEN_CODE).toContain('<strong>破棄の記録はまだありません。</strong>')
  })

  it('200 takes on 200 bookings walk backwards through the REAL derivations', async () => {
    const now = new Date()
    const synthetic: FixtureAppointment[] = Array.from({ length: 200 }, (_, i) => ({
      id: `apt-syn-${i}`, store_id: STORE_A, customer_id: customers[i % customers.length].id,
      staff_id: staff[i % 5].id, menu_id: menus[i % 3].id,
      starts_at: jstSlot(-i, 10, 0, now), ends_at: jstSlot(-i, 11, 0, now),
      booked_price: 6600, status: 'done', display_no: `R-9${String(i).padStart(3, '0')}`,
      board_state: null, settlement: null, resource_id: null, source: '合成',
      reassigned_from: null, taken_days_ago: 1, updated_minute: null,
    }))
    const takes: FixtureTake[] = synthetic.map((a, i) => ({
      id: `rs-syn-${i}`, appointment_id: a.id, store_id: null, day_offset: null,
      started_minute: 10 * 60, by_staff_card_id: 'c-06', duration_seconds: 1800,
      job: 'done', job_error: null, local_audio: false, settled: true,
      ticket_redeemed: false, discarded: null,
    }))
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { appointments: synthetic, takes } })
    expect(props.takes.length).toBe(200)
    const walk = windowTakes(props.takes, 1)
    expect(walk.visible.length).toBeLessThan(200)
    expect(walk.visible.length + walk.hidden).toBe(200)
  })

  it('a 25+ staff counts block stays arithmetically exact (⚖ the staff dimension)', () => {
    const base = models().find((m) => m.discarded !== null)!
    // ⚠ STAMPED TO TODAY. This is an ARITHMETIC pin, so it may not inherit the
    // demo plane's own calendar: every demo discard is dated relative to today,
    // and on the 1st of a month they are all last month's — which took this
    // `it` red at the parent tip on 2026-09-01 with nothing changed.
    const today = jstDayKey(new Date())
    const many: TakeModel[] = Array.from({ length: 25 }, (_, i) => ({
      ...base,
      id: `syn-${i}`,
      dayKey: today,
      discarded: { ...base.discarded!, byCardId: `c-syn-${i}`, byName: `見本 スタッフ${i}` },
    }))
    const { y, m } = jstYmd(new Date())
    const counts = discardCounts(many, y, m)
    expect(counts.byStaff.length).toBe(25)
    expect(counts.byStaff.reduce((n, s) => n + s.thisMonth, 0)).toBe(counts.thisMonth)
  })
})

// ═══ THE CLOCK MATRIX ═══════════════════════════════════════════════════════

describe('the pinned-clock matrix — a JST calendar question, answered in JST', () => {
  // the SAME pin every other calendar assertion in this file uses — one clock
  // mechanism, so the matrix and the counts cannot drift apart.
  const at = pinClock
  afterEach(unpinClock)

  // Four instants that break a UTC-shaped month test: JST-midnight either side,
  // and the last/first day of a month read from a UTC clock in the wrong month.
  for (const iso of [
    '2026-08-31T14:59:59.000Z', // 23:59:59 JST on 8/31
    '2026-08-31T15:00:01.000Z', // 00:00:01 JST on 9/1
    '2026-03-31T16:00:00.000Z', // 01:00 JST on 4/1
    '2026-12-31T15:30:00.000Z', // 00:30 JST on 1/1
  ]) {
    it(`counts the JST calendar month at ${iso}`, async () => {
      at(iso)
      const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
      const { y, m } = jstYmd(new Date())
      const expected = discardCounts(models(), y, m)
      expect(props.counts!.thisMonthLine).toBe(`今月の破棄 ${expected.thisMonth}件`)
      // The dateline is the SAME instant the counts were taken at — one clock
      // read per render, so a page cannot straddle JST midnight.
      expect(props.dateline).toContain('サンプルデータ')
    })
  }
})

// ═══ THE REFUSAL CENSUS ═════════════════════════════════════════════════════

describe('every write door refuses, with its OWN reason', () => {
  it('each refusal names what it would have done', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const rs = props.refusals
    expect(new Set(Object.values(rs)).size).toBe(Object.keys(rs).length) // no generic reused sentence
    expect(rs.use).toContain('カルテ')
    expect(rs.use).toContain('録音の破棄はこの画面で最後まで試せます')
    expect(rs.save).toContain('録音はこの案内が消えるまで失われません')
    expect(rs.transcript).toContain('店舗の設定')
    for (const r of Object.values(rs)) expect(r.length).toBeGreaterThan(30)
  })

  it('a refused control is aria-disabled and keeps its reason on the accessible NAME', () => {
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true' as const")
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
    // …and the className merge happens LAST so a call site cannot overwrite it
    const helper = SCREEN_CODE.slice(SCREEN_CODE.indexOf('const refused = ('))
    expect(helper.indexOf('...rest')).toBeLessThan(helper.indexOf("className: ['btn', className]"))
  })

  it('THE `refused()` HELPER ITSELF cannot emit a handler — the contract, not the call sites (⚖ 47)', () => {
    // ⚠ THE CALL-SITE SCAN BELOW IS NOT ENOUGH, and that was proved by mutation:
    // an `onClick` added INSIDE the helper made every refused control mutate
    // state and all 180 tests stayed green, because the helper is where the
    // props are actually built. The contract is pinned HERE, on the helper's own
    // body: it returns exactly `type` / `aria-disabled` / `title` / `aria-label`
    // / `className`, plus whatever `extra` a call site hands it — and `extra` is
    // typed to `className` and `aria-describedby` alone, so no call site can pass
    // a handler through it either.
    const at = SCREEN_CODE.indexOf('const refused = (')
    const helper = SCREEN_CODE.slice(at, SCREEN_CODE.indexOf('\n  }', at) + 4)
    expect(helper.length).toBeGreaterThan(100)
    expect(helper).not.toMatch(/on[A-Z]\w+\s*:/) // no handler of ANY name
    expect(helper).toContain("type: 'button' as const")
    expect(helper).toContain("'aria-disabled': 'true' as const")
    expect(helper).toContain('title: reason')
    expect(helper).toContain("'aria-label': `${label} — ${reason}`")
    // the escape hatch is typed shut
    const sig = SCREEN_CODE.slice(at, SCREEN_CODE.indexOf('=> {', at))
    expect(sig).toContain("extra?: { className?: string; 'aria-describedby'?: string }")
    // …and the ONE spread is the typed `rest`, never an untyped props bag
    expect(helper).toContain('...rest')
  })

  it('no refused control carries an onClick — the call sites too', () => {
    const sites = [...SCREEN_CODE.matchAll(/\{\.\.\.refused\([^)]*\)\}\s*(onClick)?/g)]
    expect(sites.length).toBeGreaterThanOrEqual(5) // …or the scan proves nothing
    for (const m of sites) expect(m[1]).toBeUndefined()
  })

  it('the standing footnote is on screen before anyone reaches for a control', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.actionFootnote).toContain('見本データ')
    expect(SCREEN_CODE).toContain('id="rcFootnote"')
  })

  it('⚖ R6-D3 — the DISCARD demos to the end while the COMMIT refuses', () => {
    // the discard settles locally and produces a receipt
    expect(SCREEN_CODE).toContain('const settleDiscard = ()')
    // the commit is a refused lever inside the confirm dialog
    expect(SCREEN_CODE).toContain("refused('この録音を使う', props.refusals.use, { className: 'rc-commit' })")
  })
})

// ═══ THE DEMO MACHINE ═══════════════════════════════════════════════════════

describe('the recorder’s own machine', () => {
  it('mm:ss, and it never goes negative', () => {
    expect(fmtElapsed(0)).toBe('00:00')
    expect(fmtElapsed(61)).toBe('01:01')
    expect(fmtElapsed(3599)).toBe('59:59')
    expect(fmtElapsed(-5)).toBe('00:00')
  })

  it('the waveform is PURE — same answer twice, and always inside scaleY’s range', () => {
    expect(waveformBars(40, 7)).toEqual(waveformBars(40, 7))
    expect(waveformBars(40, 7)).not.toEqual(waveformBars(40, 8))
    for (const v of waveformBars(40, 3)) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    // no clock, no random — a hydration mismatch would be the cost of either
    const fn = LIB_CODE.slice(LIB_CODE.indexOf('export function waveformBars'))
    expect(fn.slice(0, fn.indexOf('\n}') + 2)).not.toMatch(/Math\.random|Date/)
  })

  it('⚖ B4-3 — an UNRESOLVED stopped take offers NO reset lever, only 破棄 and 使う', () => {
    // The phone refuses exactly this path in words (RecordButtonCard.tsx:83-85:
    // wiring a restart here would 「invent a supersede path over an unsaved
    // take」), and the ⚖ 8/20 integrity doctrine has no reason-free route out of
    // a take. 「やり直す」 sat ABOVE the 破棄 / この録音を使う row — the no-paperwork
    // exit offered first and the recorded one second.
    expect(SCREEN_CODE).not.toContain('やり直す')
    // `reset` is called by the RESOLUTION and by the picker's own effect, and by
    // nothing a reader can press.
    const calls = [...SCREEN_CODE.matchAll(/[^a-zA-Z]reset\(\)/g)].length
    expect(calls).toBe(1)
    expect(SCREeN_SETTLE()).toContain('reset()')
    expect(SCREEN_CODE).not.toMatch(/onClick=\{reset\}|onClick=\{\(\) => reset\(\)\}/)
    // …and the ended state still offers both real resolutions.
    expect(SCREEN_CODE).toContain('rc-discard')
    expect(SCREEN_CODE).toContain('この録音を使う')
  })

  it('⚖ R6-18 / B1-7 — the machine has FOUR states, and every one of them is REACHABLE', () => {
    // ⚖ R6-D3's commit REFUSES, so nothing in this room can ever put the machine
    // into canon's fifth state (反映済み). It was carried anyway — in the label
    // map, in the tone map, in the `ended` branch and in the sheet — so a reader
    // counting the room's states counted one that does not exist. Argued as
    // R6-18 and REMOVED; registry ⑦ is where it comes back.
    expect(Object.keys(RECORDER_LABEL)).toEqual(['idle', 'recording', 'paused', 'stopped'])
    expect(Object.keys(RECORDER_TONE)).toEqual(['idle', 'recording', 'paused', 'stopped'])
    // every state the maps name is one `setPhase` can produce
    const reached = new Set([...SCREEN_CODE.matchAll(/setPhase\('(\w+)'\)/g)].map((m) => m[1]))
    reached.add('idle') // the initial state, and `reset()`'s
    expect([...reached].sort()).toEqual(Object.keys(RECORDER_LABEL).sort())
    // …and 反映済み is nowhere a reader can meet it: not a label, not a tone, not
    // a branch, not a rule. (The prose that ARGUES its absence stays — stripped
    // here, kept in the file, which is where R6-18 is written down.)
    const ROOM_CSS_CODE = stripComments(readFileSync(join(process.cwd(), `${ROOM_DIR}/recording.css`), 'utf8'))
    for (const src of [LIB_CODE, SCREEN_CODE, ROOM_CSS_CODE]) {
      expect(src).not.toContain('反映済み')
      expect(src).not.toContain('is-committed')
    }
    expect(SCREEN_CODE).not.toContain('committed')
    expect(SCREEN_CODE).toContain("const ended = phase === 'stopped'")
  })

  it('⚖ B4-4 — NO SIDE CONTROL REPEATS THE BIG BUTTON’S CURRENT VERB', () => {
    // §2f's argument is that the control a staffer presses to stop IS the one
    // they pressed to start. A labelled 停止 forty pixels under a morphing record
    // button that is also a stop dilutes exactly that: two stops, and no way to
    // tell which is canonical. ONE VERDICT, ONE HOME.
    const row = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('<div className="rc-controls">'),
      SCREEN_CODE.indexOf('</div>', SCREEN_CODE.indexOf('<div className="rc-controls">')),
    )
    /** The visible WORDS the row offers in one phase — every `>…</button>` inside
     *  that phase's own guard. */
    const verbsIn = (phase: string) => {
      const at = row.indexOf(`{phase === '${phase}' && (`)
      if (at < 0) return ['(no branch)']
      const next = row.indexOf('{phase ===', at + 10)
      const block = row.slice(at, next < 0 ? undefined : next)
      return [...block.matchAll(/>([^<>]+)<\/button>/g)].map((m) => m[1].trim())
    }
    // the big button's own verb, per phase, read off ITS aria-label
    expect(SCREEN_CODE).toContain("aria-label={ended ? '録音終了' : live ? '録音停止' : '録音開始'}")
    // recording — the big button STOPS, so the row carries 一時停止 and nothing else
    expect(verbsIn('recording')).toEqual(['一時停止'])
    // paused — the big button RESUMES, so the row carries the verb it does not: 停止
    expect(verbsIn('paused')).toEqual(['停止'])
    // …stated as a rule rather than as two examples: the row never prints 停止
    // while the big button is a stop, and never prints 再開 at all.
    expect(row).not.toContain('再開')
    expect([...row.matchAll(/>停止<\/button>/g)].length).toBe(1)
    // and the ONE way to end a take is still the loudest thing on the panel
    expect(SCREEN_CODE).toContain('if (live) { stop(); return }')
  })

  it('a stop NEVER auto-saves — the staffer resolves the take', () => {
    expect(SCREEN_CODE).toContain("setPhase('stopped')")
    expect(SCREEN_CODE).not.toMatch(/自動的に保存/)
    // the stopped phase offers exactly two ways out, and both are deliberate
    expect(SCREEN_CODE).toContain("{phase === 'stopped' && (")
  })

  it('changing the booking resets the machine — a take belongs to its own session', () => {
    expect(SCREEN_CODE).toContain('}, [pickedId])')
  })
})

// ═══ THE SIBLING-SHEET FENCE, DERIVED FRESH ═════════════════════════════════

describe('⚖ the sibling-sheet fence', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  const ROOM_CSS = readFileSync(join(BIZ, 'business/recording/recording.css'), 'utf8')
  const dirs = readdirSync(join(BIZ, 'business')).filter((d) => {
    if (d === 'recording') return false
    try { readFileSync(join(BIZ, 'business', d, `${d}.css`)); return true } catch { return false }
  })

  /** ⚠ WALKS THE AT-RULES (the room-5 F-K11 defect, fixed here from day one).
   *  Splitting on '}' and slicing to the first '{' is blind to the FIRST rule of
   *  every @media block — the media query's own brace is the one it finds — so a
   *  planted bare `.biz .<name>` rule inside a media query stays invisible, which
   *  is precisely the shape this fence exists to catch. */
  const selectorsOf = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@(?:media|supports|layer|container)[^{]*\{/g, '')
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
      })
      .filter((s) => s !== '' && !s.startsWith('@'))
  const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

  it('THE PARSER IS RED-PROVEN against a first-in-@media plant', () => {
    const plant = '@media (max-width: 743px) {\n  .biz .panel { display: none; }\n  .biz .other { color: red; }\n}'
    expect(selectorsOf(plant)).toContain('.biz .panel')
  })

  /** Every class the room's MARKUP can put on an element, plus every class its
   *  own sheet names. This is the set a sibling rule has to be measured
   *  against: a rule naming anything OUTSIDE it can never match this room's DOM
   *  at all, however loud it is. */
  const roomClasses = (() => {
    const out = new Set<string>()
    for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const n of (m[1] ?? m[2] ?? '').split(/[^A-Za-z0-9_-]+/)) if (n) out.add(n)
    }
    for (const sel of selectorsOf(ROOM_CSS)) for (const n of classesIn(sel)) out.add(n)
    return out
  })()

  /** Every unscoped sibling rule that COULD match something in this room — every
   *  class it names is a class this room's elements carry. Derived fresh from
   *  today's nine sibling sheets. */
  const rivals = (() => {
    const out: Array<{ sheet: string; sel: string; n: number; names: string[] }> = []
    for (const d of dirs) {
      for (const sel of selectorsOf(readFileSync(join(BIZ, `business/${d}/${d}.css`), 'utf8'))) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
        const names = classesIn(sel)
        if (names.length === 0 || !names.every((n) => roomClasses.has(n))) continue
        out.push({ sheet: d, sel, n: names.length, names })
      }
    }
    return out
  })()

  /** Every class name in one compound selector (`.rc-chip.is-saved` \u2192 both).
   *  A compound carrying an `rc-` class \u2014 or the room root itself \u2014 is FENCED
   *  BY THAT NAME: a sibling can only reach the element by also matching it, and
   *  no sibling has one. The names genuinely EXPOSED to a neighbour are the ones
   *  this room states in a compound with neither. */
  const compoundsOf = (sel: string) => sel.split(/[\s>+~]+/).filter(Boolean)
  const exposedNames = () => {
    const out = new Set<string>()
    for (const sel of selectorsOf(ROOM_CSS)) {
      if (!sel.includes('pg-recording')) continue
      for (const comp of compoundsOf(sel)) {
        const names = classesIn(comp)
        if (names.length === 0) continue
        if (names.some((n) => n.startsWith('rc-') || n === 'pg-recording')) continue
        for (const n of names) out.add(n)
      }
    }
    return [...out].sort()
  }

  it('the room exposes only the SHELL\u2019s own names \u2014 everything else is `rc-`-fenced', () => {
    // `app` rides the one `:has()` rule that lifts the shell's 1180px floor
    // (\u2696 R6-1, argued at the rule itself); `page` / `btn` / `primary` are the
    // shell's own and are outranked below.
    // `page` and `app` do NOT appear: the room states them only compounded with
    // `pg-recording` (`.page.pg-recording`, and the `:has()` that lifts the
    // shell's 1180px floor), which is a name no sibling has. What is left is the
    // shell's `.btn` / `.btn.primary`, stated on descendants \u2014 outranked below.
    expect(exposedNames()).toEqual(['btn', 'primary'])
  })

  it('every rule this room states OUTRANKS every sibling rule that could reach it', () => {
    // \u2696 THE FENCE'S OPERATIVE PROPERTY IS OUTRANKING, NOT A LITERAL PREFIX. A
    // TIE is decided by whichever sheet App Router happened to insert last,
    // which is not a fence \u2014 so a rival must be strictly quieter, never equal.
    // ⚠ THE COMPARISON IS ON THE SUBJECT, not on any shared word. Two rules
    // collide only when they can paint the SAME element, which is decided by
    // their LAST compound: `.biz .page .btn` styles a `.btn`, and this room's
    // `.biz .page.pg-recording` styles the page \u2014 they never meet, and comparing
    // them would be a pin that fails for a reason that is not a defect.
    const subjectOf = (sel: string) => classesIn(compoundsOf(sel).at(-1) ?? '')
    const losses: string[] = []
    for (const rival of rivals) {
      const theirSubject = subjectOf(rival.sel)
      for (const r of selectorsOf(ROOM_CSS)) {
        if (!r.includes('pg-recording')) continue
        if (!subjectOf(r).some((n) => theirSubject.includes(n))) continue
        if (classesIn(r).length <= rival.n) losses.push(`${r}  (ties/loses to ${rival.sheet}: ${rival.sel})`)
      }
    }
    expect(losses).toEqual([])
    // \u2026and there ARE real rivals, or the pin above proves nothing.
    expect(rivals.length).toBeGreaterThan(0)
  })

  it('NO SIBLING states a bare rule that reaches a name only this room owns', () => {
    // The shell's four are answered by the outranking pin; anything else in the
    // rival set would be a neighbour styling this room's own elements \u2014 the
    // room-2 BLOCKER class.
    const shell = new Set(['app', 'btn', 'page', 'primary'])
    const bleeds = rivals.filter((r) => r.names.some((n) => !shell.has(n)))
    expect(bleeds.map((b) => `${b.sheet}: ${b.sel}`)).toEqual([])
    expect(roomClasses.size).toBeGreaterThan(40)
  })

  it('⚖ PAGE-SCROLL — ONE named exception owns an axis, and NOTHING ELSE does', () => {
    // The DECLARATIONS, not the prose: the sheet's own header argues about
    // overflow and sticky at length, and a scan that read comments would be
    // pinned on a paragraph rather than on the CSS.
    //
    // ⚠ THE EXEMPTION IS BY NAME, AND IT IS EXACTLY ONE PANEL. ⚖ Liam 8/31
    // approved the 破棄の記録 transcript's BOUNDED READING panel — sticky header,
    // 5分 markers, fade, visible bar — precisely so a 47-minute transcript costs
    // the page no height. The ⚖ 8/22 law it sits beside governs BOARD and LIST
    // wrappers, and every one of those in this room still scrolls with the page.
    const decls = ROOM_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    // every INNERMOST rule, with its own selector — an at-rule's prelude carries
    // no declarations of its own, so this walks the real ones.
    const blocks = [...decls.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
    expect(blocks.length).toBeGreaterThan(80)
    const rulesWith = (re: RegExp) => blocks.filter((b) => re.test(b.body)).map((b) => b.sel)
    // whichever selector states each of them, it is the reading panel's
    for (const [prop, re] of [
      ['overflow-y', /overflow-y\s*:\s*(auto|scroll)/],
      ['overscroll-behavior', /overscroll-behavior/],
      ['max-height', /max-height\s*:\s*(?!none)/],
      ['position: sticky', /position\s*:\s*sticky/],
    ] as const) {
      const owners = rulesWith(re)
      expect({ prop, owners }).toEqual({
        prop,
        owners: owners.filter((s) => /\.rc-tscroll\b|\.rc-tpanel-head\b/.test(s)),
      })
      expect({ prop, any: owners.length > 0 }).toEqual({ prop, any: true })
    }
    // …and NOTHING pans sideways, anywhere, ever.
    expect(decls).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
    // …and NOTHING THAT HOLDS A CONTROL CLIPS, or a focus ring would be cut off
    // (the room-3 F2 lesson). The ban used to be blanket, which no room with an
    // ellipsis or a line clamp can actually obey — so it names what it protects
    // instead, and is stricter for it: `overflow: hidden` is legal ONLY in the
    // same block as a text truncation, which is a span of words and never a
    // focusable thing.
    const clippers = blocks.filter((b) => /overflow\s*:\s*hidden/.test(b.body))
    expect(clippers.map((b) => b.sel)).toEqual(
      clippers.filter((b) => /text-overflow\s*:\s*ellipsis|-webkit-line-clamp|-webkit-box-orient/.test(b.body)).map((b) => b.sel),
    )
    expect(clippers.length).toBeGreaterThan(0)
    // …and the two rules that genuinely must clip a HEIGHT — the four collapse
    // panels and the footnote's — use `overflow: clip`, which cannot become a
    // scroll container at all. ⚠ NO CLIP MARGIN: a closed panel is 0px tall, so
    // a margin let its first card paint under the control that closes it.
    const TRUNCATES = /text-overflow\s*:\s*ellipsis|-webkit-line-clamp|-webkit-box-orient/
    const clipped = blocks.filter((b) => /overflow\s*:\s*clip/.test(b.body) && !TRUNCATES.test(b.body))
    expect(clipped.length).toBe(2) // .rc-collapse (four users) and .rc-fn-panel
    for (const b of clipped) expect(b.body).not.toMatch(/overflow-clip-margin/)
    expect(decls).not.toMatch(/overflow-clip-margin/)
  })

  it('⚖ F-R1 — the 1180px floor is lifted from the SHELL’s own opt-in list, not from here', () => {
    // The shell's own comment states the rule: 「the selector is SHELL-owned, so
    // no route sheet can ever reach up and lift its own floor」. This room used to
    // carry a copy of the rule in its own sheet, which is exactly that reach
    // however carefully it was scoped.
    const shell = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'), 'utf8')
    expect(shell).toContain('.biz .app:has(.page.pg-inbox, .page.pg-register, .page.pg-karute, .page.pg-recording) { min-width: 0; }')
    expect(ROOM_CSS).not.toMatch(/\.biz \.app:has/)
    // …and the room's sheet reaches OUTSIDE its own subtree nowhere at all:
    // every selector it states is scoped by `pg-recording`.
    const unscoped = selectorsOf(ROOM_CSS).filter((s) => !s.includes('pg-recording'))
    expect(unscoped).toEqual([])
  })
})

// ═══ THE ROUTE ENTRY ════════════════════════════════════════════════════════

describe('the route entry', () => {
  it('gates on admission, keys the screen by the resolved lens, and reads nothing itself', () => {
    expect(PAGE_SRC).toContain('await requireBusinessAdmission()')
    expect(PAGE_SRC).toContain('key={storeKey}')
    expect(PAGE_SRC).not.toMatch(/listAppointments|listCustomers|new Date\(/)
    // ⚠ EVERY NAMED DEMO PARAM IS PASSED THROUGH, and both are OFF by default:
    // the route reads them, the assembly decides what they mean, and the screen
    // is handed a resolved object or `null`.
    expect(PAGE_SRC).toContain('recovery: query.recovery,')
    expect(PAGE_SRC).toContain('discardFail: query.discardFail,')
    expect(discardFailLine(undefined)).toBeNull()
  })

  it('the screen holds no data access, and its ONE clock is the discard receipt’s own stamp', () => {
    expect(SCREEN_CODE).not.toMatch(/toLocaleString|toLocaleDateString|fixtures/)
    // ⚠ EVERY RENDER-TIME DATE STILL CROSSES AS A SERVER-FORMATTED STRING —
    // that is what keeps the two renders from disagreeing about a day. The one
    // exception is the moment the staffer pressed 破棄する, which no server render
    // can know and which only exists AFTER an interaction, so there is no first
    // render for it to differ from (canon stamps it the same way, :843). It is
    // read in `settleDiscard` and nowhere else.
    expect([...SCREEN_CODE.matchAll(/new Date\(/g)].length).toBe(1)
    expect([...SCREEN_CODE.matchAll(/Intl\./g)].length).toBe(1)
    expect(SCREeN_SETTLE()).toContain('JST_STAMP.format(new Date())')
  })

  it('react-dom never enters the room’s runtime', () => {
    for (const src of [SCREEN, PROPS_SRC, PAGE_SRC, LIB_SRC, PLANE_SRC]) {
      expect(src).not.toContain('react-dom')
    }
  })

  it('the room reaches into NO phone runtime', () => {
    for (const src of [SCREEN_CODE, stripComments(PROPS_SRC), stripComments(PAGE_SRC), LIB_CODE, PLANE_CODE]) {
      expect(src).not.toMatch(/from '@\/lib\/(recording|recordings|karute)/)
    }
  })
})


// ═══ V5 · THE DERIVATIONS THE ACCEPTED MOCK'S COMPOSITION NEEDED ════════════
// Every one is a PURE function in `recording.ts` (⚖ A8: one predicate per
// verdict), and every one is pinned here rather than at the screen — a screen
// test would prove that the room CALLS them, not that they are right.

describe('v5 — the hero chip, the default selection and the slot hint', () => {
  it('⚖ THE PHASE IS HALF-OPEN: at the end minute the session is OVER', () => {
    // Two back-to-back bookings must never both read 施術中, which is what a
    // closed interval would do at the shared minute.
    expect(bookingPhaseOf(600, 660, 599)).toBe('upcoming')
    expect(bookingPhaseOf(600, 660, 600)).toBe('now')
    expect(bookingPhaseOf(600, 660, 659)).toBe('now')
    expect(bookingPhaseOf(600, 660, 660)).toBe('past')
    expect(bookingPhaseOf(600, 660, 661)).toBe('past')
  })

  it('⚖ THE SCREEN NEVER PICKS — in the room now, else next up, else last of day', () => {
    const opts = [
      { appointmentId: 'a', startedMinute: 600, endMinute: 660 },
      { appointmentId: 'b', startedMinute: 800, endMinute: 860 },
      { appointmentId: 'c', startedMinute: 1000, endMinute: 1060 },
    ]
    expect(defaultPick(opts, 500)).toBe('a')   // nothing running → the NEXT one
    expect(defaultPick(opts, 630)).toBe('a')   // in the room now
    expect(defaultPick(opts, 700)).toBe('b')   // between two → the next
    expect(defaultPick(opts, 1200)).toBe('c')  // evening → the last of the day
    expect(defaultPick([], 600)).toBeNull()
    // ⚠ THE ONE IN THE ROOM WINS EVEN WHEN IT IS NOT THE FIRST IN THE LIST —
    // the rule is about the CLOCK, not about position.
    expect(defaultPick([opts[0], { appointmentId: 'z', startedMinute: 690, endMinute: 750 }], 700)).toBe('z')
  })

  it('the slot hint SAYS WHAT IT COUNTS, and today is the N+1th visit', () => {
    expect(slotHint('now', 3)).toBe('いま施術中')
    expect(slotHint('upcoming', 0)).toBe('初めてのご来店')
    expect(slotHint('upcoming', 3)).toBe('ご来店 4回目')
    expect(slotHint('past', 7)).toBe('ご来店 8回目')
  })

  it('the hero chip and the picker hint come off ONE clock read, not two', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const c of props.contexts) {
      // the chip's tone and its words agree, by construction
      if (c.heroChipTone === 'now') expect(c.heroChipLabel).toBe('いま施術中')
      if (c.heroChipTone === 'upcoming') expect(c.heroChipLabel).toMatch(/^このあと \d\d:\d\d 開始$/)
      if (c.heroChipTone === 'past') expect(c.heroChipLabel).toMatch(/^終了 \d\d:\d\d$/)
      // …and the slot hint is 施術中 EXACTLY when the chip is
      expect(c.slotHint === 'いま施術中').toBe(c.heroChipTone === 'now')
    }
    // the default IS one of the options, always
    if (props.contexts.length > 0) {
      expect(props.contexts.map((c) => c.appointmentId)).toContain(props.defaultAppointmentId)
    }
  })
})

describe('v5 — 前回までの流れ is a JOIN, and it states nothing', () => {
  const factsFor = (customerId: string) => {
    const now = new Date()
    return briefFactsOf({
      customerId,
      todayKey: jstDayKey(now),
      appointments: appointments(now).filter((a) => a.store_id === STORE_A),
      menus, staff, records: recordPlane,
      categoryOrder: CATEGORY_ORDER, categoryLabel: CATEGORY_LABEL,
    })
  }

  it('every row it returns hangs off a booking THIS LENS holds, newest first', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.contexts.length).toBeGreaterThan(0)
    let sawARecord = false
    for (const c of props.contexts) {
      const f = factsFor(c.customerId)
      // newest first, strictly
      const keys = f.records.map((r) => r.dayKey)
      expect([...keys].sort((a, b) => b - a)).toEqual(keys)
      // …and every カルテ id it names really is in the plane
      for (const r of f.records) {
        expect(recordPlane.some((x) => x.id === r.recordId)).toBe(true)
        sawARecord = true
      }
      // the door counts what is BEHIND it, and only appears when there is depth
      const shown = f.records.slice(0, BRIEF_RECORDS_SHOWN)
      expect(c.brief.records.map((r) => r.id)).toEqual(shown.map((r) => r.recordId))
      expect(c.brief.doorLabel).toBe(
        f.records.length > shown.length ? `すべてのカルテを見る（${f.records.length}件）` : null,
      )
    }
    expect(sawARecord).toBe(true)
  })

  it('the summary is the EFFECTIVE one — a human rewrite outranks the AI text', () => {
    const withEdit = recordPlane.find((r) => r.summary_edited !== null && r.summary_edited !== undefined)
    if (withEdit) {
      const booking = appointments(new Date()).find((a) => a.id === withEdit.appointment_id)
      if (booking) {
        const f = factsFor(booking.customer_id)
        if (f.last?.recordId === withEdit.id) expect(f.summary).toBe(withEdit.summary_edited)
      }
    }
    // …and where there is no record at all, there is no summary and no memo —
    // never an empty string standing in for a sentence.
    const firstTimer = customers.find((c) => factsFor(c.id).last === null)
    expect(firstTimer).toBeTruthy()
    const none = factsFor(firstTimer!.id)
    expect({ last: none.last, summary: none.summary, memo: none.memo, records: none.records })
      .toEqual({ last: null, summary: null, memo: [], records: [] })
  })

  it('⚠ THE ROW TITLE IS THE MENU NAME — the room never invents a topic (R6-24)', () => {
    const titles = new Set<string>()
    for (const c of customers) for (const r of factsFor(c.id).records) titles.add(r.title)
    expect(titles.size).toBeGreaterThan(0)
    const menuNames = new Set(menus.map((m) => m.name))
    for (const t of titles) expect(menuNames.has(t) || t === 'メニュー未記録').toBe(true)
  })

  it('⚠ THE MEMO LABEL IS THE カルテ ROOM’S OWN — never a lead this room wrote', () => {
    const labels = new Set<string>()
    for (const c of customers) for (const m of factsFor(c.id).memo) labels.add(m.label)
    expect(labels.size).toBeGreaterThan(0)
    for (const l of labels) expect(Object.values(CATEGORY_LABEL)).toContain(l)
  })

  it('⚖ REGISTRY ⑪ — the AI pre-brief is NAMED, never invented', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    // the card says the absence out loud…
    expect(SCREEN_CODE).toContain('会話のきっかけ・今日のおすすめ（AIの事前ブリーフ）は、実データ接続後に表示されます。')
    // …and the props carry no field for any of the five the phone generates.
    const serialized = JSON.stringify(props)
    for (const field of ['hooks', 'opener', 'recommendedFocus', 'memoAnalysis', 'reservationMemo']) {
      expect(serialized).not.toContain(`"${field}"`)
    }
    // ⚠ THE SOURCE-SCAN HALF: every string the briefing renders is READ from a
    // prop, so there is no literal in the screen for a staffer to take for the
    // AI's own words. The card's own two labels and its empty states are the
    // only literals inside it, and they are about the ABSENCE.
    const brief = SCREEN_CODE.slice(SCREEN_CODE.indexOf('rc-brief-body'), SCREEN_CODE.indexOf('rc-bnote'))
    expect(brief).toContain('{current.brief.summary}')
    expect(brief).toContain('{m.text}')
    expect(brief).not.toMatch(/会話のきっかけ["'][^)]*[:=]/)
  })
})

describe('v5 — the 要対応 strip cannot lie, and it is absent at zero', () => {
  it('⚖ THE PILL/COUNT LAW — every pill’s number is what its filter reveals', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.attention).not.toBeNull()
    const byLabel = new Map<string, number>()
    for (const t of props.takes) byLabel.set(t.stateLabel, (byLabel.get(t.stateLabel) ?? 0) + 1)
    for (const pill of props.attention!.pills) {
      // the pill's own count IS the number of rows carrying that state label
      expect(pill.countLabel).toBe(`${byLabel.get(pill.stateLabel) ?? 0}件`)
      // …and the chip it wears is that state's own chip, not a second spelling
      expect(pill.chip).toContain('rc-chip')
    }
    // the header count is the sum of the three, and nothing else
    const sum = props.attention!.pills.reduce((n, p) => n + Number(p.countLabel.replace('件', '')), 0)
    expect(props.attention!.countLine).toBe(`${sum}件`)
  })

  it('⚠ A CLEAN DESK SEES NO STRIP AT ALL — 「要対応 0件」 is a page inventing a warning', () => {
    expect(attentionCounts([])).toEqual({ recoverable: 0, failed: 0, awaiting: 0, total: 0 })
    expect(attentionCounts([{ state: 'saved' }, { state: 'discarded' }, { state: 'processing' }]))
      .toEqual({ recoverable: 0, failed: 0, awaiting: 0, total: 0 })
    expect(attentionCounts([{ state: 'failed' }, { state: 'failed' }, { state: 'recoverable' }, { state: 'awaiting-check' }]))
      .toEqual({ recoverable: 1, failed: 2, awaiting: 1, total: 4 })
    // …and the screen renders NOTHING rather than a zero header
    expect(SCREEN_CODE).toContain('{props.attention && (')
  })

  it('the 7-day window promises nothing it cannot keep', () => {
    expect(LOCAL_AUDIO_DAYS).toBe(7)
    expect(daysLeftLine(100, 100)).toBe('あと7日で端末から消えます')
    expect(daysLeftLine(94, 100)).toBe('あと1日で端末から消えます')
    // ⚠ 「あと0日」 IS NOT A PROMISE, and a negative one is arithmetic on the page
    expect(daysLeftLine(93, 100)).toBeNull()
    expect(daysLeftLine(80, 100)).toBeNull()
  })
})

describe('v5 — the consent line’s three states, and F6-9', () => {
  it('⚠ A SAME-DAY GRANT READS 「本日」, NEVER 「0日前」 (F6-9)', () => {
    expect(grantedWhen(0)).toBe('本日')
    expect(grantedWhen(1)).toBe('1日前')
    expect(grantedWhen(12)).toBe('12日前')
    // …and it is ONE home: the thin line, its pop-down and the gate all read it
    expect(consentShortLine({ state: 'current', grantedDaysAgo: 0, grantedVersion: CONSENT_POLICY_VERSION }))
      .toBe('同意取得の記録があります（本日・口頭）')
    expect(consentProofLine({ state: 'current', grantedDaysAgo: 0, grantedVersion: CONSENT_POLICY_VERSION }))
      .toContain('本日')
    expect(consentProofLine({ state: 'current', grantedDaysAgo: 0, grantedVersion: CONSENT_POLICY_VERSION }))
      .not.toContain('0日前')
  })

  it('the line OFFERS something only when the gate is shut', () => {
    expect(consentActionLabel('current')).toBeNull()
    expect(consentActionLabel('stale')).toBe('同意を取り直す')
    expect(consentActionLabel('absent')).toBe('同意を取得')
  })

  it('every context carries its own short line AND its own full proof', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    for (const c of props.contexts) {
      expect(c.consentShort.length).toBeGreaterThan(0)
      expect(c.consentProof.length).toBeGreaterThan(c.consentShort.length)
      expect(c.consentAction).toBe(consentActionLabel(c.consentState))
      // ⚖ THE GATE IS STILL ONE ANSWER: an action offered means the gate is shut
      expect(c.consentAction === null).toBe(c.canStart)
    }
  })
})

describe('v5 — the spring is the mock’s, and it is PURE', () => {
  const drive = (frames: number, opts: Parameters<typeof makeSpring>[1] = {}) => {
    const seen: number[] = []
    let t = 0
    const queue: Array<(t: number) => void> = []
    const sp = makeSpring((v) => seen.push(v), {
      ...opts,
      raf: (cb) => { queue.push(cb); return queue.length },
      cancel: () => {},
    })
    return {
      sp,
      run: () => { for (let i = 0; i < frames && queue.length > 0; i += 1) { t += 16; queue.shift()!(t) } },
      seen,
    }
  }

  it('it ARRIVES, without overshooting, and it rests exactly on target', () => {
    const { sp, run, seen } = drive(400)
    sp.set(100)
    run()
    expect(seen.length).toBeGreaterThan(3)
    expect(seen[seen.length - 1]).toBe(100)
    // critically damped: nothing ever goes past the target
    for (const v of seen) expect(v).toBeLessThanOrEqual(100.0001)
  })

  it('`jump` re-seats the integrator and is NOT an arrival — onRest must not fire', () => {
    const rests: number[] = []
    const { sp, run } = drive(400, { onRest: (v) => rests.push(v) })
    sp.jump(50)
    run()
    expect(rests).toEqual([])
    sp.set(60)
    run()
    expect(rests).toEqual([60])
  })

  it('⚠ REDUCED MOTION IS A CONSTRUCTOR ARGUMENT — it lands instantly, it does not vanish', () => {
    const seen: number[] = []
    const rests: number[] = []
    const sp = makeSpring((v) => seen.push(v), {
      reduced: true,
      onRest: (v) => rests.push(v),
      raf: () => { throw new Error('a reduced spring must never schedule a frame') },
      cancel: () => {},
    })
    sp.set(42)
    // the STATE still changed; it simply stopped moving
    expect(seen).toEqual([42])
    expect(rests).toEqual([42])
  })

  it('it touches NO React and NO DOM — that is what lets one integrator serve three uses', () => {
    const src = readFileSync(join(process.cwd(), 'src/business/lib/spring.ts'), 'utf8')
    expect(src).not.toMatch(/\bfrom 'react'|useState|useEffect|useRef/)
    expect(src).not.toMatch(/document\.|getElementById|querySelector|getBoundingClientRect|window\./)
    // …and the screen constructs EVERY spring with the reader's own answer
    const constructions = [...SCREEN_CODE.matchAll(/makeSpring\(/g)].length
    expect(constructions).toBeGreaterThanOrEqual(3)
    expect([...SCREEN_CODE.matchAll(/\breduced\b/g)].length).toBeGreaterThanOrEqual(constructions)
  })
})


// ═══ V5 · THE SIX TRUTHS THE BATTERY FOUND UNPINNED ═════════════════════════
// Each one survived a mutation because the only thing that could see it was the
// browser probe — a geometry or a source shape no assertion named. A truth the
// suites cannot see is a truth the next round can delete by accident.

const V5_ROOM_CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/recording.css`), 'utf8')

describe('v5 — the composition’s own truths, named', () => {
  it('M64 · THE DEFAULT IS THE CLOCK’S ANSWER, not “the first option”', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.contexts.length).toBeGreaterThan(0)
    // the rule, re-stated from the SERIALIZED chips rather than by calling the
    // same function the props called (a pin that asks the code what the code
    // said is not a pin)
    const inRoom = props.contexts.find((c) => c.heroChipTone === 'now')
    const upcoming = props.contexts.filter((c) => c.heroChipTone === 'upcoming')
    const want = inRoom
      ? inRoom.appointmentId
      : upcoming.length > 0
        ? upcoming[0].appointmentId
        : props.contexts[props.contexts.length - 1].appointmentId
    expect(props.defaultAppointmentId).toBe(want)

    // ⚠ AND THE WIRING IS PINNED BY NAME, because the ASSERTION ABOVE CANNOT SEE
    // IT ON ITS OWN. For most of the day the rule's answer and 「the first
    // option」 are the same booking — before the first appointment they both say
    // 「the next one」 — so a props line that had quietly gone back to
    // `options[0]` would pass every behavioural check made at that hour and fail
    // only in the evening, on a real desk. The rule's own three branches are
    // unit-pinned above (`defaultPick`); what this line pins is that the room
    // still ASKS it. The battery's M64 is the red-run.
    expect(PROPS_SRC).toContain('defaultAppointmentId: defaultPick(options, nowMinute),')
    expect(PROPS_SRC).not.toMatch(/defaultAppointmentId:\s*(contexts|options)\[0\]/)
    // …and the screen READS it rather than choosing for itself
    expect(SCREEN_CODE).toContain('useState<string | null>(props.defaultAppointmentId)')
    expect(SCREEN_CODE).not.toMatch(/setPickedId\(props\.contexts\[0\]/)
  })

  it('M70 · A CLEAN DESK SEES NO 要対応 STRIP AT ALL', async () => {
    // a world whose takes are all settled: nothing needs a hand, so there is
    // nothing to head a strip with
    const settled = takePlane.filter((t) => t.discarded !== null)
    expect(settled.length).toBeGreaterThan(0)
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A, world: { takes: settled } })
    expect(props.takes.length).toBeGreaterThan(0)
    const needsHand = props.takes.filter((t) =>
      ['復元可能', '失敗', '確認待ち'].includes(t.stateLabel))
    expect(needsHand).toEqual([])
    expect(props.attention).toBeNull()
    // …and the demo world, which DOES have work in it, still gets one
    const live = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(live.props.attention).not.toBeNull()
  })

  it('M74 · THE WAVEFORM STAYS — 「keep everything the phone app has」 (R6-22)', () => {
    // it renders while the take is LIVE or PAUSED, frozen once stopped, and it
    // moves on `transform: scaleY` alone — a composite-only property
    expect(SCREEN_CODE).toMatch(/\{\(live \|\| phase === 'paused'\) && \(\s*<div className="rc-wave"/)
    expect(SCREEN_CODE).toMatch(/\{ended && frozen\.length > 0 && \(\s*<div className="rc-wave is-frozen"/)
    expect(SCREEN_CODE).toContain('style={{ transform: `scaleY(${v})` }}')
    expect(V5_ROOM_CSS).toMatch(/\.rc-wave \{[^}]*height: 28px/)
    // …and never `height`, which would lay out on every frame
    expect(V5_ROOM_CSS).not.toMatch(/\.rc-bar \{[^}]*transition/)
  })

  it('M75 · FIVE COLUMNS, AND 状態・操作 IS ONE CELL — no labelled cell is ever empty', () => {
    const grid = V5_ROOM_CSS.slice(V5_ROOM_CSS.indexOf('.biz .pg-recording .rc-rowhead,\n.biz .pg-recording .rc-row {'))
    const block = grid.slice(0, grid.indexOf('}') + 1)
    const tracks = block.slice(block.indexOf('grid-template-columns:') + 'grid-template-columns:'.length,
      block.indexOf(';', block.indexOf('grid-template-columns:')))
    // ⚠ COUNT TRACKS, NOT TOKEN READS. お客様 is a `minmax()` holding two of the
    // six `--rc-c-*` variables, and a naive strip stops at the first `)` — so
    // this walks paren DEPTH and splits only at depth zero, which is what a
    // track list actually is.
    const flat: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of tracks) {
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (depth === 0 && /\s/.test(ch)) { if (cur.trim()) flat.push(cur.trim()); cur = '' } else cur += ch
    }
    if (cur.trim()) flat.push(cur.trim())
    expect(flat.length).toBe(5)
    // …and only お客様 is elastic; every other track is a fixed width
    expect(flat.filter((t) => t.startsWith('minmax(')).length).toBe(1)
    // …and the head names exactly those five, in that order
    const head = SCREEN_CODE.slice(SCREEN_CODE.indexOf('className="rc-rowhead"'))
    const labels = [...head.slice(0, head.indexOf('</div>')).matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1])
    expect(labels).toEqual(['日付', 'お客様', '録音者', '長さ', '状態・操作'])
    // …and the row renders exactly five cells
    const row = SCREEN_CODE.slice(SCREEN_CODE.indexOf('className={`rc-row${'))
    expect([...row.slice(0, row.indexOf('</div>\n                  ))')).matchAll(/className="rc-c-/g)].length).toBe(5)
  })

  it('M76 · THE SUB-MESSAGE LIVES INSIDE THE お客様 TRACK — never absolute, never spanning', () => {
    // by construction in the markup…
    expect(SCREEN_CODE).toMatch(/<span className="rc-custtxt">[\s\S]{0,900}?<span className="rc-sub">/)
    // …and by construction in the sheet: a cell child that took itself out of
    // flow could overlap a neighbouring column however the tracks are sized
    const sub = V5_ROOM_CSS.slice(V5_ROOM_CSS.indexOf('.biz .pg-recording .rc-sub {'))
    const block = sub.slice(0, sub.indexOf('}') + 1)
    expect(block).toContain('display: flex')
    expect(block).not.toMatch(/position\s*:\s*(absolute|fixed)/)
    expect(block).not.toMatch(/\bwidth\s*:/)
  })

  it('M79 · ⚖ THE ULTRA-WIDE LAW — the ONE width token is repeated on EVERY card', () => {
    expect(V5_ROOM_CSS).toContain('--rc-maxw: 1400px')
    // the view is the reading column…
    expect(V5_ROOM_CSS).toMatch(/\.rc-record-view,\n\.biz \.pg-recording \.rc-review-view \{ width: 100%; max-width: var\(--rc-maxw\)/)
    // …and every card repeats it as the v5-2 backstop, so a single engine quirk
    // on the wrapper cannot let one card stretch across a 2560px window
    const cap = V5_ROOM_CSS.slice(V5_ROOM_CSS.indexOf('.biz .pg-recording .rc-head,\n'))
    const block = cap.slice(0, cap.indexOf('}') + 1)
    for (const cls of ['.rc-head', '.rc-recovery', '.rc-grid', '.rc-attn', '.rc-history', '.rc-footnote']) {
      expect(block).toContain(`.biz .pg-recording ${cls}`)
    }
    expect(block).toContain('max-width: var(--rc-maxw)')
  })
})
