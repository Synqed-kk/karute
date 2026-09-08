/**
 * @jest-environment jsdom
 *
 * ⚠ THE HOP NOBODY WAS WATCHING (blind round 1, L2 F1 — fix round 2 F12).
 *
 * The blind tests lens deleted all three lines that hand `recording` down to
 * the card — the web page's, the view's, and the thin screen's — and the FULL
 * suite stayed green at 551 suites / 9,706 tests with a clean type-check. The
 * player would simply never appear on either door and nothing in the repo would
 * notice. Both props are optional, so tsc is silent too.
 *
 * Everything on either SIDE of that hop was heavily pinned: the builder decides
 * `recording` (52 cases), the DTO carries it, the card renders it (30+). This
 * file pins the hop itself, on both doors, in the only way that fails when the
 * wire is cut: it renders the real components and looks for the real control.
 */
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? ''))
      },
  }
})
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({ mintPlaybackUrl: jest.fn() }),
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: 'idle' }),
  recorderIsLive: () => false,
}))
// Every sibling card is out of scope — the same isolation the summary-placement
// suite uses. The transcript card stays REAL: it is the destination.
jest.mock('@/components/karute/redesign/detail/CustomerHeaderCard', () => ({ CustomerHeaderCard: () => null }))
jest.mock('@/components/karute/redesign/detail/DetailBreadcrumb', () => ({ DetailBreadcrumb: () => null }))
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({ CurrentSessionCard: () => null }))
jest.mock('@/components/karute/redesign/detail/RegenerateEntriesButton', () => ({ RegenerateEntriesButton: () => null }))
jest.mock('@/components/karute/redesign/detail/CustomerMemoryCard', () => ({ CustomerMemoryCard: () => null }))
jest.mock('@/components/karute/redesign/detail/AISummaryCard', () => ({ AISummaryCard: () => null }))
jest.mock('@/components/karute/redesign/detail/OutcomeCard', () => ({ OutcomeCard: () => null }))
// ReassignCustomerAction → '@/actions/karute' → next/cache → TextEncoder, which
// CI's jsdom lacks (the summary-placement suite mocks the same seam).
jest.mock('@/components/karute/redesign/detail/ReassignCustomerAction', () => ({ ReassignCustomerAction: () => null }))
jest.mock('@/components/karute/redesign/detail/PhotoRecordsCard', () => ({ PhotoRecordsCard: () => null }))
jest.mock('@/components/coaching/redesign/KaruteCoachingPanel', () => ({ KaruteCoachingPanel: () => null }))
jest.mock('@/components/karute/redesign/detail/AIBodyPredictionCard', () => ({ AIBodyPredictionCard: () => null }))
jest.mock('@/components/karute/redesign/detail/AISuggestedMessageCard', () => ({ AISuggestedMessageCard: () => null }))
jest.mock('@/components/customers/redesign/profile/UpcomingAiFeatures', () => ({
  AIBodyPredictionPreview: () => null,
  AIOutreachPreview: () => null,
}))
jest.mock('@/lib/karute/use-ai-slot', () => ({ useAiSlot: () => null }))

import { render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { KaruteDetailScreen } from '../../../thin/screens/KaruteDetailScreen'

const RECORDING = { audioPresent: true, durationSeconds: 742, status: 'COMPLETED' }

/** The 再生 control, found by its ja aria-label — the thing a staffer taps. */
const playButton = () => screen.queryByRole('button', { name: '再生' })

// ── HOP 3 · view → card ─────────────────────────────────────────────────────
describe('KaruteDetailView hands `recording` (and karuteId) to the card', () => {
  const view = (recording: typeof RECORDING | null) =>
    render(
      <KaruteDetailView
        karuteId="k-1"
        customerId="c-1"
        header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
        sessionDateLong="2026年9月6日"
        entries={[]}
        summaryBullets={[]}
        transcript="肩こりの話をしました"
        consentOnFile
        transcriptDurationLabel={null}
        recording={recording}
        photosSlot={null}
        memory={null}
        bodyPredictionSlot={null}
        suggestedMessageSlot={null}
        outcome={null}
        staffCanReassignRecords={false}
      />,
    )

  it('a present recording reaches the card — the player renders', () => {
    view(RECORDING)
    expect(playButton()).toBeTruthy()
  })

  it('a null recording renders today’s card, with no player', () => {
    view(null)
    expect(playButton()).toBeNull()
  })
})

// ── HOP 2 · the THIN door: DTO → screen → view → card ───────────────────────
describe('the thin screen hands the DTO’s `recording` down', () => {
  const PATH = '/api/app/v1/screens/karute/k-1?locale=ja'
  const dto = (recording: typeof RECORDING | null | undefined) => ({
    karuteId: 'k-1',
    customerId: 'c-1',
    outcome: null,
    header: {
      customerName: '廣瀬浩子', initials: 'HK', karuteNumber: '#00007', service: null,
      sessionDateLong: '2026年9月6日', staffName: '田中', phone: null, email: null,
      age: null, gender: null, visitNumber: 3, lastVisitDate: null,
    },
    sessionDateLong: '2026年9月6日',
    sessionDateIso: null,
    entries: [],
    summaryBullets: [],
    transcript: '肩こりの話をしました',
    consentOnFile: false,
    transcriptDurationLabel: null,
    transcriptRestricted: false,
    ...(recording === undefined ? {} : { recording }),
    photos: [],
    viewerRole: 'practitioner',
  })

  const mount = (recording: typeof RECORDING | null | undefined) => {
    dtoCache.clear()
    dtoCache.set(PATH, dto(recording))
    setDataPort({
      apiFetch: jest.fn(() => new Promise<Response>(() => {})),
    } as unknown as Parameters<typeof setDataPort>[0])
    return render(<KaruteDetailScreen id="k-1" />)
  }

  afterEach(() => dtoCache.clear())

  it('audioPresent in the DTO puts the play button on the phone', () => {
    mount(RECORDING)
    expect(playButton()).toBeTruthy()
  })

  it('a null recording shows today’s card — no player', () => {
    mount(null)
    expect(playButton()).toBeNull()
  })

  // The forward-compat rule: a payload minted by a server that predates the
  // field parses, and simply shows no player (never a broken screen).
  it('an ABSENT recording field is the same as null', () => {
    mount(undefined)
    expect(playButton()).toBeNull()
  })
})
