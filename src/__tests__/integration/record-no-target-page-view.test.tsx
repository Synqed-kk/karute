/**
 * @jest-environment jsdom
 *
 * RecordPageView with NO recording target — the screen the 8/19 ruling
 * created. buildRecordScreen no longer auto-picks a colleague's booking, so
 * `nextAppointment` is genuinely null for a staffer with nothing of their own
 * today, and this page is what they get.
 *
 * The blind round (A-4) found the whole state pinned only at the leaf: the
 * `showNoTargetActions` gate, the handler wiring, the hidden recorder column
 * and the day picker had ZERO coverage through the real component tree — an
 * inverted gate kept 125 tests green. These pin it end to end:
 *
 *   1. idle + null target → the two-action card, wired, recorder column gone,
 *      no salon-wide day picker, and exactly ONE empty-state card (A-3).
 *   2. anonymous take in flight → the unbound placeholder, still no picker
 *      (A-1: the LEGACY auto-context picker — RecordingTargetCard's 別の予約を
 *      選択 → SelectBookingSheet — must NOT surface in any null-target state;
 *      it is one tap away from the card's own 選択せずに録音する. The
 *      deliberately-opened お客様を選んで録音 dialog below is a DIFFERENT
 *      surface and is exempt by Liam's 8/19 mock ruling).
 *   3. pipeline busy + recorder idle → still the card (A-1: the gate reads
 *      recState, not the composite `live` — a take still transcribing in the
 *      background is a normal window to line up the next customer).
 *   4. お客様を選んで録音 opens the customer dialog.
 *
 * Dialog v2 (8/19 mock) adds its own describe below: today's bookings on open,
 * the 記録済 row that is not tappable, and BOTH navigation pins.
 *
 * Mock idiom copied from record-page-view-target-mismatch.test.tsx (same
 * transitive server-module wall); next-intl is key-echoed there too, so
 * assertions read as translation keys. The real-ja.json call-site check lives
 * in record-no-own-booking-card.test.tsx.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
let mockPipelineState: 'idle' | 'transcribing' | 'review' = 'idle'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null
const mockStartRecording = jest.fn()
const mockReplace = jest.fn()

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: null,
    error: null,
    stream: null,
    startedAt: mockRecState === 'idle' ? null : Date.now(),
    overrun: false,
    autoStopped: false,
    target: mockTarget,
    takeId: null,
    recordingSessionId: null,
    startRecording: mockStartRecording,
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
    state: 'idle',
    // The 録音履歴 store arms a settle watch on it (Build F1).
    subscribe: jest.fn(() => () => {}),
  },
}))
jest.mock('@/hooks/use-global-pipeline', () => ({
  useGlobalPipeline: () => ({
    state: mockPipelineState,
    error: null,
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
  }),
}))
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))

// C-2: a pass-through wrapper that COUNTS renders of the real dialog. B-8
// below proves the dialog is gone once a target binds; the counter proves it
// never renders even once on the way out — i.e. the enforcement lives in the
// RENDER gate (`showCustomerPicker && showNoTargetActions`), not in the effect
// that follows it. An effect-only gate ends in the same empty screen while
// still painting a full picker over a freshly-bound target for one commit,
// with rows that navigate away from a live recording target.
const mockDialogRenders = { n: 0 }
jest.mock('@/components/karute/redesign/record/RecordCustomerPickerDialog', () => {
  const actual = jest.requireActual<
    typeof import('@/components/karute/redesign/record/RecordCustomerPickerDialog')
  >('@/components/karute/redesign/record/RecordCustomerPickerDialog')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  return {
    ...actual,
    RecordCustomerPickerDialog: (
      props: Parameters<typeof actual.RecordCustomerPickerDialog>[0],
    ) => {
      mockDialogRenders.n++
      return createElement(actual.RecordCustomerPickerDialog, props)
    },
  }
})

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

// The no-target screen as the server actually builds it: every
// nextAppointment-derived field short-circuits to null/empty (pinned
// server-side in record-own-customer-only.test.ts t2).
const noTargetProps = {
  customers: [
    // Space in the id: encodeURIComponent turns it into %20, so a raw
    // concatenation (no encoding) produces a different, wrong URL — pins
    // both the query param name AND the encoding.
    { id: 'c 1', name: '原 奏恵', furigana: null, phone: null },
    { id: 'c-2', name: '佐藤 美咲', furigana: null, phone: null },
  ],
  locale: 'ja',
  nextAppointment: null,
  // A colleague's booking IS in the picker rows — the server still ships the
  // whole day for the explicit picker. That is exactly why no null-target
  // state may render the picker.
  nearbyBookings: [
    {
      id: 'a-theirs',
      start: '10:30',
      end: '12:00',
      customer: '佐藤 美咲',
      initials: '佐藤',
      karute: 'K-0142',
      service: 'カット',
      staff: '佐藤',
      staffId: 's-other',
      staffColorKey: null,
      statusKey: 'booked' as const,
      statusLabel: '予約済',
    },
  ],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  visitSegment: null,
  visitRhythm: null,
  targetHasTicketPack: false,
  targetPack: null,
  currentStaffName: '原',
  ticketsEnabled: true,
}

beforeEach(() => {
  mockRecState = 'idle'
  mockPipelineState = 'idle'
  mockTarget = null
  jest.clearAllMocks()
})

describe('RecordPageView — no own booking today (8/19 ruling)', () => {
  it('idle + null target: the two-action card, wired, no picker, no recorder column', () => {
    const { container } = render(<RecordPageView {...noTargetProps} />)

    // The card itself.
    expect(screen.getByText('noOwnBooking')).toBeInTheDocument()

    // Wiring — both actions reach their handlers. 選択せずに録音する starts an
    // UNBOUND take (the pre-existing walk-in flow, trigger moved onto the card).
    fireEvent.click(screen.getByText('recordWithoutCustomer'))
    expect(mockStartRecording).toHaveBeenCalledTimes(1)
    expect(mockStartRecording.mock.calls[0][0]).toMatchObject({ target: null })

    // The big record button steps aside (mock A2) — no second, competing
    // way to start a take on this screen.
    expect(screen.queryByLabelText('startAria')).not.toBeInTheDocument()

    // The salon-wide day picker is nowhere: not its trigger, not its rows.
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()

    // A-3: exactly ONE empty-state card — the brief's own noTarget explainer
    // used to stack below this one. aria-busy proves the whole Suspense
    // boundary is gone, not merely that the content hasn't streamed.
    expect(screen.queryByText('noTarget')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument()
  })

  it('お客様を選んで録音 opens the customer dialog, and picking navigates to the exact encoded ?customerId= URL', () => {
    render(<RecordPageView {...noTargetProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('chooseCustomer'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'target.chooseCustomer')
    // No take is started by merely opening the picker.
    expect(mockStartRecording).not.toHaveBeenCalled()

    // Pick 原 奏恵 (id 'c 1') from the combobox.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })
    fireEvent.click(screen.getByText('原 奏恵'))

    expect(mockReplace).toHaveBeenCalledWith('/sessions?customerId=c%201')
  })

  it('anonymous take in flight: unbound placeholder, still no picker', () => {
    mockRecState = 'recording' // 選択せずに録音する take, bound to nobody
    render(<RecordPageView {...noTargetProps} />)

    expect(screen.getByText('unboundHint')).toBeInTheDocument()
    // The two actions are gone (a take is already running)…
    expect(screen.queryByText('noOwnBooking')).not.toBeInTheDocument()
    // …and so is every route back to the colleague's booking.
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
    // The recorder controls stay: stopping the take must never be hidden.
    expect(screen.getByLabelText('stopAria')).toBeInTheDocument()
  })

  it('pipeline still crunching the LAST take, recorder idle: the card stays', () => {
    mockPipelineState = 'transcribing'
    render(<RecordPageView {...noTargetProps} />)

    expect(screen.getByText('noOwnBooking')).toBeInTheDocument()
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
  })
})

// ── picker dialog v2 (Liam-approved mock, 8/19) ──────────────────────────
// Today's bookings are listed the moment the dialog opens; a booking row binds
// THROUGH the booking (?appointmentId=), a searched customer keeps the
// pre-existing ?customerId= path, and a booking whose karute already exists is
// a receipt, not an offer.
const dialogProps = {
  ...noTargetProps,
  // Deliberately NOT in time order — the dialog sorts. Space in the tappable
  // row's id pins the encoding the same way 'c 1' does for the customer path.
  nearbyBookings: [
    {
      id: 'a done',
      start: '15:30',
      end: '16:30',
      customer: '山本 結衣',
      customerId: 'c-3',
      initials: '山本',
      karute: '#00099',
      service: 'パーマ',
      staff: '原',
      staffId: 's-1',
      staffColorKey: null,
      // Its karute already exists — buildRecordScreen stamps 'done'.
      statusKey: 'done' as const,
      statusLabel: '完了',
    },
    {
      id: 'a 2',
      start: '10:30',
      end: '11:30',
      customer: '佐藤 美咲',
      customerId: 'c-2',
      initials: '佐藤',
      karute: '#00058',
      service: '新規コース',
      staff: '鈴木',
      staffId: 's-2',
      staffColorKey: null,
      statusKey: 'booked' as const,
      statusLabel: '予約済',
    },
  ],
  customerFacts: [
    { id: 'c-2', karuteNumber: '#00058', isNew: true },
    {
      id: 'c 1',
      karuteNumber: '#00214',
      hasKarute: true,
      pack: { remaining: 5, size: 10 },
      lastVisitDate: '8月2日',
      lastVisitService: 'カット＋カラー',
      staffName: '原 奏恵',
    },
  ],
}

describe('RecordPageView — customer-picker dialog v2 (8/19 mock)', () => {
  function openDialog() {
    render(<RecordPageView {...dialogProps} />)
    fireEvent.click(screen.getByText('chooseCustomer'))
    return screen.getByRole('dialog')
  }

  it("opens on today's bookings, time-sorted, with the karute number on the row", () => {
    openDialog()

    expect(screen.getByText('target.todayBookingsCount')).toBeInTheDocument()
    expect(screen.getByText('佐藤 美咲')).toBeInTheDocument()
    expect(screen.getByText('山本 結衣')).toBeInTheDocument()
    expect(screen.getByText('#00058')).toBeInTheDocument()

    // Time ascending, regardless of the server's own-staff-first ordering.
    const times = screen
      .getAllByText(/^\d{2}:\d{2}$/)
      .map((el) => el.textContent)
    expect(times).toEqual(['10:30', '15:30'])
  })

  it('a booking whose karute exists is a 記録済 row, NOT tappable', () => {
    openDialog()

    // The row renders (staff can see the slot is handled)…
    expect(screen.getByText('山本 結衣')).toBeInTheDocument()
    expect(screen.getByText('target.recordedTag')).toBeInTheDocument()

    // …and it IS an option of the listbox (B-2: as a bare <li> it was invisible
    // to listbox semantics — a screen reader counted 1 option over a 2-row day
    // and skipped the slot entirely, which reads as "that time is free")…
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('佐藤 美咲')
    expect(options[1]).toHaveTextContent('山本 結衣')

    // …announced as unavailable rather than offered, and nothing about it
    // navigates.
    expect(options[1]).toHaveAttribute('aria-disabled', 'true')
    expect(options[0]).not.toHaveAttribute('aria-disabled')

    fireEvent.click(screen.getByText('山本 結衣'))
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('a11y: focus enters the panel, the header × is 閉じる, the clear × owns its own label', () => {
    const dialog = openDialog()

    // B-3: the opener keeps focus otherwise — a stray Enter re-fires it behind
    // the backdrop, and screen-reader focus never enters the modal.
    expect(dialog).toHaveFocus()

    // B-4: the header × dismisses, it does not "cancel" — that is the footer
    // button, which keeps キャンセル.
    expect(screen.getByLabelText('close')).toBeInTheDocument()
    expect(screen.getByText('cancel')).toBeInTheDocument()

    // B-1: the clear-search × appears only while searching, carries its OWN
    // label (it clears the box, it does not close the dialog), and has real
    // padding instead of being the bare 14px glyph.
    expect(screen.queryByLabelText('target.clearSearch')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })
    const clear = screen.getByLabelText('target.clearSearch')
    expect(clear).toHaveClass('p-1')

    fireEvent.click(clear)
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByText('target.todayBookingsCount')).toBeInTheDocument()
  })

  it('B-8: a target binding under the open dialog unmounts it (QuietRefresh)', async () => {
    const { rerender } = render(<RecordPageView {...dialogProps} />)
    fireEvent.click(screen.getByText('chooseCustomer'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // C-2: everything the dialog renders from here on must be ZERO.
    const rendersAtBind = mockDialogRenders.n

    // The server re-render QuietRefresh paints behind the screen: the staffer
    // now HAS a booking of their own. The picker may exist only in the
    // no-target state — floating over a bound target, its rows navigate away
    // from a live one.
    // Await: binding a target mounts StreamingBriefCard's use(aiBriefPromise),
    // which suspends once even on an already-resolved promise (React 19) —
    // unawaited, that leaves a dangling act() warning.
    await act(async () => {
      rerender(
        <RecordPageView
          {...dialogProps}
          nextAppointment={{
            id: 'a-mine',
            customerName: '原 奏恵',
            customerId: 'c 1',
            karuteNumber: '#00214',
            startTime: '2026-08-19T03:00:00.000Z',
            durationMinutes: 60,
            title: 'カット',
            notes: null,
            statusKey: 'booked' as const,
            staffName: '原',
          }}
        />,
      )
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // C-2: not "gone by the end of the commit" — never painted at all.
    expect(mockDialogRenders.n).toBe(rendersAtBind)

    // The target clears again (staffer's booking gets reassigned elsewhere).
    // The picker must NOT spring back open on its own — only an explicit tap
    // on chooseCustomer reopens it.
    await act(async () => {
      rerender(<RecordPageView {...dialogProps} />)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockDialogRenders.n).toBe(rendersAtBind)
  })

  it('B-9: the 本日 chip follows the booking still open, not the earlier 記録済 one', () => {
    // 原 奏恵 sits twice today: an early slot already written up, and a later
    // one still to record. The chip/stripe must point at the one the staffer
    // can still act on.
    const twice = [
      {
        ...dialogProps.nearbyBookings[0],
        id: 'a-early-done',
        start: '09:00',
        end: '10:00',
        customer: '原 奏恵',
        customerId: 'c 1',
        statusKey: 'done' as const,
      },
      {
        ...dialogProps.nearbyBookings[1],
        id: 'a-late-open',
        start: '13:00',
        end: '14:00',
        customer: '原 奏恵',
        customerId: 'c 1',
        statusKey: 'booked' as const,
      },
    ]
    render(<RecordPageView {...dialogProps} nearbyBookings={twice} />)
    fireEvent.click(screen.getByText('chooseCustomer'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })

    const row = screen.getByText('原 奏恵').closest('button')!
    const stripe = row.querySelector('span.absolute')!
    // BADGE_COLORS.green.solid (still booked) — never slate, the 記録済 grey.
    expect(stripe).toHaveClass('bg-green-500')
    expect(stripe).not.toHaveClass('bg-slate-400')
  })

  it('C-4: 新規 takes the blue stripe, but never outranks 記録済/施術中', () => {
    // 佐藤 美咲 (c-2) is a first-timer with a still-open booking → blue, the
    // colour 新規 has on every other surface. STRIPE.new existed but nothing
    // could ever reach it: buildRecordScreen's statusKey only carries
    // done/in-session/booked, so every first-timer read 予約済 green.
    render(
      <RecordPageView
        {...dialogProps}
        customerFacts={[
          { id: 'c-2', isNew: true },
          // …and the finished 15:30 slot belongs to a first-timer too. The
          // agenda's precedence (terminal > in-session > 新規 > 予約済) says
          // that row stays slate — it is a receipt, not an upcoming visit.
          { id: 'c-3', isNew: true },
        ]}
      />,
    )
    fireEvent.click(screen.getByText('chooseCustomer'))

    const open = screen.getByText('佐藤 美咲').closest('button')!
    expect(open.querySelector('span.absolute')).toHaveClass('bg-blue-500')

    const done = screen.getByText('山本 結衣').closest('li')!
    expect(done.querySelector('span.absolute')).toHaveClass('bg-slate-400')
    expect(done.querySelector('span.absolute')).not.toHaveClass('bg-blue-500')
  })

  it('tapping a booking row navigates to the exact encoded ?appointmentId= URL', () => {
    openDialog()

    fireEvent.click(screen.getByText('佐藤 美咲'))

    expect(mockReplace).toHaveBeenCalledWith('/sessions?appointmentId=a%202')
    // Never the customer path: binding THROUGH the booking is what threads the
    // booking's menu/consent/pack reads on the server re-resolve.
    expect(mockReplace).toHaveBeenCalledTimes(1)
    // Opening/choosing a row never starts a take on its own.
    expect(mockStartRecording).not.toHaveBeenCalled()
  })

  it('typing swaps to enriched search results, still on the ?customerId= path', () => {
    openDialog()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })

    // The day list is gone, the result rows carry the server-derived facts.
    expect(screen.queryByText('target.todayBookingsCount')).not.toBeInTheDocument()
    expect(screen.getByText('target.searchResultsCount')).toBeInTheDocument()
    expect(screen.getByText('#00214')).toBeInTheDocument()
    expect(screen.getByText('target.lastVisitWithMenu')).toBeInTheDocument()
    // PackPill's own label — next-intl is key-echoed in this suite.
    expect(screen.getByText('card.packLeft')).toBeInTheDocument()

    fireEvent.click(screen.getByText('原 奏恵'))
    expect(mockReplace).toHaveBeenCalledWith('/sessions?customerId=c%201')
  })

  it('a payload with no customerFacts still renders the rows (old-server shape)', () => {
    render(<RecordPageView {...dialogProps} customerFacts={undefined} />)
    fireEvent.click(screen.getByText('chooseCustomer'))

    // Rows survive; only the enrichment chips are absent.
    expect(screen.getByText('佐藤 美咲')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options.filter((o) => o.hasAttribute('aria-disabled'))).toHaveLength(1)
    expect(screen.queryByText('target.firstVisit')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })
    expect(screen.getByText('原 奏恵')).toBeInTheDocument()
    expect(screen.queryByText('#00214')).not.toBeInTheDocument()
    // C-7: absent facts are NOT a claim. An old payload knows nothing about
    // this customer's karute — printing カルテ未作成 (the key, in this
    // key-echoed suite) would state as fact something the server never said,
    // and staff would open a fresh chart for someone who already has one.
    expect(screen.queryByText('target.noKarute')).not.toBeInTheDocument()
  })
})
