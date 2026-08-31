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
  discardLedger,
  feedsCounts,
  fmtElapsed,
  isBelowFloor,
  ownDiscardsThisMonth,
  permissionNotice,
  pickerOptions,
  staffNameOfCard,
  takeStateOf,
  transcriptAbsenceOf,
  waveformBars,
  windowTakes,
  CONSENT_LABEL,
  TAKE_STATE_CHIP,
  TAKE_STATE_LABEL,
  TRANSCRIPT_ABSENCE_LINE,
  TRANSCRIPT_FAILED_LINE,
  WINDOW_DAYS,
  type TakeModel,
} from '@/business/lib/recording'
import { jstMinuteOfDay } from '@/business/lib/clock'
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
    expect(SCREEN_CODE).toContain("if (text === '' || current === null) return")
    // exactly one function that produces a receipt
    expect([...SCREEN_CODE.matchAll(/setReceipt\(\{/g)].length).toBe(1)
    // the confirm is ALSO disabled — belt and brace, and the guard above is the belt
    expect(SCREEN_CODE).toContain("disabled={reason.trim() === ''}")
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
    expect(SCREEN_CODE).toContain('{props.recovery.belowFloor && (')
    // …and no ✕ / no 破棄 button beside 保存する
    const banner = SCREEN_CODE.slice(SCREEN_CODE.indexOf('rc-recovery"'), SCREEN_CODE.indexOf('</section>', SCREEN_CODE.indexOf('rc-recovery"')))
    expect(banner).not.toContain('rc-danger')
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
          for (const localAudio of [true, false]) {
            expect(takeStateOf({ discarded: true, hasRecord, settled, job, localAudio }).state).toBe('discarded')
          }
        }
      }
    }
  })

  it('the other five read off real evidence', () => {
    const s = (o: Parameters<typeof takeStateOf>[0]) => takeStateOf(o).state
    const base = { discarded: false, hasRecord: false, settled: false, job: null, localAudio: false } as const
    expect(s({ ...base, hasRecord: true, settled: true })).toBe('saved')
    expect(s({ ...base, hasRecord: true, settled: false })).toBe('awaiting-check')
    expect(s({ ...base, job: 'running' })).toBe('processing')
    expect(s({ ...base, job: 'failed' })).toBe('failed')
    expect(s({ ...base, localAudio: true })).toBe('recoverable')
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
    for (const line of source.discarded!.transcript ?? []) expect(payload).not.toContain(line)
    // …and no colleague content either, in the demo world.
    const plain = JSON.stringify((await recordingProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })).props)
    for (const t of takePlane) {
      if (t.discarded === null) continue
      expect({ take: t.id, leaked: plain.includes(t.discarded.reason) }).toEqual({ take: t.id, leaked: false })
      for (const line of t.discarded.transcript ?? []) {
        expect({ take: t.id, leaked: plain.includes(line) }).toEqual({ take: t.id, leaked: false })
      }
    }
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

  it('LEAVES NOTHING BEHIND — the 銀座 payload holds no 代官山 string of any kind', async () => {
    const payload = JSON.stringify((await recordingProps({ locale: 'ja', store: STORE_A })).props)
    const other = takePlane.filter((t) => ['rs-0020', 'rs-0021'].includes(t.id))
    for (const t of other) {
      expect(payload).not.toContain(t.id)
      for (const line of t.discarded?.transcript ?? []) expect(payload).not.toContain(line)
      if (t.discarded) expect(payload).not.toContain(t.discarded.reason)
    }
    // and no customer only 代官山 sees
    const bOnly = appointments().filter((a) => a.store_id === STORE_B).map((a) => a.customer_id)
    const aAny = new Set(appointments().filter((a) => a.store_id === STORE_A).map((a) => a.customer_id))
    for (const id of bOnly.filter((c) => !aAny.has(c))) {
      const name = customers.find((c) => c.id === id)!.name
      expect({ name, leaked: payload.includes(name) }).toEqual({ name, leaked: false })
    }
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
  it('both ways, and each number says WHAT it counts', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    const { y, m } = jstYmd(new Date())
    const expected = discardCounts(models(), y, m)
    expect(props.counts.thisMonthLine).toBe(`今月の破棄 ${expected.thisMonth}件`)
    expect(props.counts.totalLine).toBe(`記録されている破棄 全${expected.total}件`)
    for (const s of props.counts.byStaff) expect(s.line).toMatch(/^今月の破棄 \d+件$/)
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
    expect(SCREEN_CODE).toContain('{props.ownDiscardLine && <p className="rc-own-count">')
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

  it('✓確認済み DOES NOT EXIST — the lever is REFUSED with the honest note (registry ⑩)', async () => {
    const { props } = await recordingProps({ locale: 'ja', store: STORE_A })
    expect(props.refusals.checked).toContain('まだ保存できる場所がありません')
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
    expect(below.durationLabel).toBe('長さ 8秒（10秒未満）')
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

  it('a store with no bookings today gets a DESIGNED empty state, not a blank', async () => {
    const now = new Date()
    const { props } = await recordingProps({
      locale: 'ja', store: STORE_A,
      world: { appointments: appointments(now).filter((a) => jstDayKey(a.starts_at) !== jstDayKey(now)) },
    })
    expect(props.contexts).toEqual([])
    expect(SCREEN_CODE).toContain('本日の予約がありません')
  })
})

// ═══ THE WINDOWED WALK (ANY-ROSTER-SIZE on the take dimension) ══════════════

describe('⚖ ANY-ROSTER-SIZE — the walk, and the 200-take world', () => {
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
    const many: TakeModel[] = Array.from({ length: 25 }, (_, i) => ({
      ...base,
      id: `syn-${i}`,
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
  const RealDate = Date
  const at = (iso: string) => {
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
  afterEach(() => { global.Date = RealDate })

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
      expect(props.counts.thisMonthLine).toBe(`今月の破棄 ${expected.thisMonth}件`)
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

  it('no refused control carries an onClick — a refusal changes NOTHING (⚖ 47)', () => {
    for (const m of SCREEN_CODE.matchAll(/\{\.\.\.refused\([^)]*\)\}\s*(onClick)?/g)) {
      expect(m[1]).toBeUndefined()
    }
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
   *  today's eight sibling sheets. */
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

  it('⚖ PAGE-SCROLL — not one container in this room owns an axis', () => {
    // The DECLARATIONS, not the prose: the sheet's own header argues about
    // overflow and sticky at length, and a scan that read comments would be
    // pinned on a paragraph rather than on the CSS.
    const decls = ROOM_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(decls).not.toMatch(/overflow-y\s*:\s*(auto|scroll)/)
    expect(decls).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
    expect(decls).not.toMatch(/overscroll-behavior/)
    expect(decls).not.toMatch(/max-height\s*:\s*(?!none)/)
    expect(decls).not.toMatch(/position\s*:\s*sticky/)
    // …and no `overflow: hidden` either, or a focus ring would be clipped (F2)
    expect(decls).not.toMatch(/overflow\s*:\s*hidden/)
  })
})

// ═══ THE ROUTE ENTRY ════════════════════════════════════════════════════════

describe('the route entry', () => {
  it('gates on admission, keys the screen by the resolved lens, and reads nothing itself', () => {
    expect(PAGE_SRC).toContain('await requireBusinessAdmission()')
    expect(PAGE_SRC).toContain('key={storeKey}')
    expect(PAGE_SRC).not.toMatch(/listAppointments|listCustomers|new Date\(/)
  })

  it('the screen holds no clock, no formatter and no data access', () => {
    expect(SCREEN_CODE).not.toMatch(/new Date\(|Intl\.|toLocaleString|fixtures/)
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
