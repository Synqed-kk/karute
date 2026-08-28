/**
 * @jest-environment jsdom
 *
 * RecordPageView — D3 discard-with-photos dialog (packet 2026-08-09 PR 9b
 * §②, blind-round fix §7/§9/§10/§15). Liam canon: discarding a recording
 * that has session photos ASKS EACH TIME (写真も削除 / 顧客ページに残す) —
 * never silently drops or silently keeps them. Fires for ANY 'uploading' OR
 * 'done' photo (§7 — an in-flight upload counts, not just a landed one),
 * showing the combined count. 写真も削除 deletes 'done' photos now AND marks
 * any still-'uploading' photo for delete-after-settle (the store itself
 * fires the delete the moment that upload resolves — see the settle-then-
 * delete test). 顧客ページに残す deletes nothing. An explicit キャンセル aborts
 * entirely (§10, mirrors the No-booking prompt's cancel). §9: the
 * honest-loss toast for photos that failed to upload is now i18n'd and
 * lives HERE (computed before discardRecording()/the save handoff), not in
 * the store. §15: the SAVE path (handleUseRecording), even driven to full
 * completion with a non-null result, never shows this dialog — a
 * structurally separate function that never references the dialog state.
 *
 * Module walls mirror session-photo-mount-guard.test.tsx (the documented
 * mock set for mounting RecordPageView under jsdom). @/lib/global-pipeline
 * is ALSO mocked here (unlike that file) — the save-completion test drives
 * handleUseRecording far enough to call globalPipeline.start(), which must
 * not touch the real AI pipeline in jsdom.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recorded'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null
// §15: controllable per-test so the save path can be driven to actual
// completion (handleUseRecording's very first line is `if (!result) return`).
let mockResult: { blob: Blob; mimeType: string; durationMs: number } | null = null
const mockDiscardRecording = jest.fn()

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({
  discardRecordingWithReason: jest.fn(async () => ({
    ok: true,
    receiptId: 'row-1',
    duplicate: false,
  })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
const mockUploadCustomerPhoto = jest.fn(
  async (_customerId: string, _fd: FormData): Promise<{ photo?: { id: string }; error?: string }> => ({
    photo: { id: 'p1' },
  }),
)
const mockDeleteCustomerPhoto = jest.fn(
  async (_customerId: string, _photoId: string): Promise<{ success: boolean; error?: string }> => ({
    success: true,
  }),
)
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  uploadCustomerPhoto: (customerId: string, fd: FormData) => mockUploadCustomerPhoto(customerId, fd),
  listCustomerPhotos: jest.fn(async () => ({ photos: [] })),
  deleteCustomerPhoto: (customerId: string, photoId: string) =>
    mockDeleteCustomerPhoto(customerId, photoId),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
const mockToastWarning = jest.fn()
const mockToastError = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    warning: (...a: unknown[]) => mockToastWarning(...a),
    success: jest.fn(),
    error: (...a: unknown[]) => mockToastError(...a),
    info: jest.fn(),
  },
}))
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: mockResult,
    error: null,
    stream: null,
    startedAt: mockRecState === 'idle' ? null : Date.now(),
    overrun: false,
    autoStopped: false,
    target: mockTarget,
    takeId: null,
    recordingSessionId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    discardRecording: mockDiscardRecording,
    // P5-A: the written-reason gate bounded-awaits the mint and fails closed
    // on null, so every discard test below needs a real id here.
    awaitRecordingSessionId: jest.fn(async () => 'sess-live'),
  }),
}))
// §15: the save path calls globalPipeline.start() — stub the whole module
// (both RecordPageView's direct import and useGlobalPipeline's read resolve
// to this same mock) so a completion test never touches the real AI pipeline.
const mockPipelineStart = jest.fn()
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    state: 'idle',
    step: null,
    result: null,
    error: null,
    context: null,
    subscribe: () => () => {},
    start: (...a: unknown[]) => mockPipelineStart(...a),
    reset: jest.fn(),
    retry: jest.fn(),
  },
}))

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'
import { sessionPhotoStore, type SessionPhoto } from '@/lib/karute/session-photos'

beforeAll(() => {
  // jsdom doesn't implement object URLs — the settle-then-delete test drives
  // a REAL sessionPhotoStore.addPhoto() (needed so a real setStatus() runs
  // when the upload resolves — a directly-seeded 'uploading' entry has no
  // in-flight promise behind it to settle).
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

const baseProps = {
  customers: [],
  locale: 'ja',
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  nextAppointment: null,
}

function donePhoto(overrides: Partial<SessionPhoto> = {}): SessionPhoto {
  return {
    id: 'sp1',
    objectUrl: 'blob:mock',
    status: 'done',
    file: new File(['x'], 'a.jpg'),
    category: 'before',
    customerId: 'cust-A',
    serverId: 'server-1',
    takenWithConsent: true,
    ...overrides,
  }
}

/** P5-A: the written-reason gate is the LAST step of every deliberate
 *  discard — it opens AFTER the photos confirm (or straight away when there
 *  are no photos to ask about), and nothing is discarded until it is
 *  confirmed. `next-intl` is key-echoing here, so labels are their keys. */
function confirmDiscardReason() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '録り直します' } })
  fireEvent.click(screen.getByText('discardReason.confirm'))
}
const reasonGateShown = () => screen.queryByText('discardReason.title') !== null
const photosDialogShown = () => screen.queryByText(/^sessionPhotos.discardPhotos/) !== null

beforeEach(() => {
  jest.clearAllMocks()
  mockUploadCustomerPhoto.mockImplementation(async () => ({ photo: { id: 'p1' } }))
  mockDeleteCustomerPhoto.mockImplementation(async () => ({ success: true }))
  mockRecState = 'recorded'
  mockResult = null
  mockTarget = {
    customerId: 'cust-A',
    customerName: 'テスト花子',
    karuteNumber: null,
    appointmentId: null,
  }
  sessionPhotoStore.photos = []
})

describe('RecordPageView discard — D3 discard-with-photos dialog', () => {
  it('discard with NO session photos → no photos dialog, straight to the reason gate', async () => {
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(photosDialogShown()).toBe(false)
    // P5-A: nothing is discarded on the tap alone any more.
    expect(reasonGateShown()).toBe(true)
    expect(mockDiscardRecording).not.toHaveBeenCalled()

    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
  })

  it('discard WITH a done photo → shows the dialog and does NOT discard yet', () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
  })

  // §7: an in-flight 'uploading' photo ALONE (no done photos yet) must also
  // trigger the dialog — silently losing track of it would be the same bug
  // class the dialog exists to prevent.
  it("discard WITH an 'uploading' (in-flight) photo alone → also shows the dialog", () => {
    sessionPhotoStore.photos = [donePhoto({ status: 'uploading', serverId: null })]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
  })

  it('an ERROR-status (unfinished) photo alone does NOT trigger the dialog — only uploading/done count', async () => {
    sessionPhotoStore.photos = [donePhoto({ status: 'error', serverId: null })]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(photosDialogShown()).toBe(false)

    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
  })

  // §7: the dialog description shows the COMBINED count (uploading + done).
  it('the dialog description shows the combined uploading+done count', () => {
    sessionPhotoStore.photos = [
      donePhoto({ id: 'a', status: 'done' }),
      donePhoto({ id: 'b', status: 'uploading', serverId: null }),
      donePhoto({ id: 'c', status: 'uploading', serverId: null }),
    ]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(
      screen.getByText('sessionPhotos.discardPhotosDescription:{"n":3}'),
    ).toBeInTheDocument()
  })

  it('写真も削除 records the decision, and the photos die only PAST the reason gate', async () => {
    sessionPhotoStore.photos = [
      donePhoto({ id: 'a', serverId: 's-a' }),
      donePhoto({ id: 'b', serverId: 's-b' }),
    ]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    // The photos confirm resolves first, THEN the reason gate opens (A-2's
    // ordering contract).
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    // Fix round 1: answering the photos dialog decides NOTHING irreversible.
    // The gate that follows is the commitment step, so while it is open the
    // customer's photos must still be on the server, untouched.
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()

    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledTimes(2)
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledWith('cust-A', 's-a')
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledWith('cust-A', 's-b')
  })

  // THE fix-round-1 case, and the one that made the old order indefensible:
  // cancelling the gate used to leave the take sitting there with the
  // customer's photos already destroyed server-side — strictly worse than
  // never having tapped 破棄 at all.
  it('cancelling the reason gate after 写真も削除 leaves every photo intact', async () => {
    sessionPhotoStore.photos = [
      donePhoto({ id: 'a', serverId: 's-a' }),
      donePhoto({ id: 'b', serverId: 's-b' }),
    ]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))

    fireEvent.click(screen.getByText('cancel'))

    await waitFor(() => expect(reasonGateShown()).toBe(false))
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(sessionPhotoStore.photos).toHaveLength(2)
  })

  // …and the armed decision must not survive the cancel either: re-opening the
  // gate and choosing 顧客ページに残す has to mean KEEP, not "delete anyway".
  it('a cancelled 写真も削除 does not carry over into the next discard', async () => {
    sessionPhotoStore.photos = [donePhoto({ id: 'a', serverId: 's-a' })]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    fireEvent.click(screen.getByText('cancel'))
    await waitFor(() => expect(reasonGateShown()).toBe(false))

    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosKeep'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()

    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  // §7 — the settle-then-delete path (mutation red-run anchor: removing the
  // markDeleteAfterSettle call in handleDiscardDeletePhotos must turn this
  // red). Drives a REAL sessionPhotoStore.addPhoto() so there's an actual
  // in-flight upload() promise to mark and later settle.
  it('写真も削除 on an UPLOADING photo marks delete-after-settle; the store fires the delete once it lands', async () => {
    let resolveUpload: (v: { photo: { id: string } }) => void = () => {}
    mockUploadCustomerPhoto.mockImplementationOnce(
      () => new Promise((res) => { resolveUpload = res }),
    )
    sessionPhotoStore.addPhoto(new File(['x'], 'a.jpg'), 'before', 'cust-A', {
      takenWithConsent: true,
    })
    expect(sessionPhotoStore.photos[0].status).toBe('uploading')

    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    // Not yet — the upload hasn't settled, nothing to delete.
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()

    resolveUpload({ photo: { id: 'settled-server-id' } })
    await waitFor(() =>
      expect(mockDeleteCustomerPhoto).toHaveBeenCalledWith('cust-A', 'settled-server-id'),
    )
  })

  // The settle-path delete can FAIL exactly like its done-photos twin —
  // deleteCustomerPhoto never throws, it resolves { success: false }, so
  // without the onFail callback the failure was invisible (blind round).
  // Mutation anchor: dropping the onFail wiring turns this red.
  it('a settle-path delete FAILURE raises the same toast as the done-photos path', async () => {
    let resolveUpload: (v: { photo: { id: string } }) => void = () => {}
    mockUploadCustomerPhoto.mockImplementationOnce(
      () => new Promise((res) => { resolveUpload = res }),
    )
    mockDeleteCustomerPhoto.mockResolvedValue({ success: false, error: 'boom' })
    sessionPhotoStore.addPhoto(new File(['x'], 'a.jpg'), 'before', 'cust-A', {
      takenWithConsent: true,
    })

    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    // No done photos in this session — the ONLY possible toast is the
    // settle-path one, so nothing else can satisfy the assertion below.
    expect(mockToastError).not.toHaveBeenCalled()

    resolveUpload({ photo: { id: 'settled-server-id' } })
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('sessionPhotos.discardDeleteFailed:{"n":1}'),
    )
  })

  it('顧客ページに残す deletes nothing, still discards', async () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosKeep'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  it('a delete failure still proceeds with the discard (best-effort, one toast)', async () => {
    sessionPhotoStore.photos = [donePhoto()]
    mockDeleteCustomerPhoto.mockResolvedValue({ success: false, error: 'boom' })
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
  })

  // §10: an explicit キャンセル aborts entirely — recording stays, nothing
  // proceeds. Mirrors the No-booking prompt's tc('cancel').
  it('キャンセル aborts entirely — no discard, no delete, recording untouched', () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  // §10: button-variant pairing follows CustomerMemoryCard's delete-confirm
  // convention — the irreversible action is destructive, never accent/default.
  it('写真も削除 is the destructive variant; 顧客ページに残す and キャンセル are outline', () => {
    sessionPhotoStore.photos = [donePhoto()]
    const { container } = render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    const deleteBtn = screen.getByText('sessionPhotos.discardPhotosDelete').closest('[variant]')
    const keepBtn = screen.getByText('sessionPhotos.discardPhotosKeep').closest('[variant]')
    const cancelBtns = container.querySelectorAll('[variant="outline"]')
    expect(deleteBtn).toHaveAttribute('variant', 'destructive')
    expect(keepBtn).toHaveAttribute('variant', 'outline')
    // At least the dialog's own cancel button is outline (other outline
    // buttons may exist elsewhere on the page, e.g. the 破棄 button itself).
    expect(cancelBtns.length).toBeGreaterThan(0)
  })

  // Liam ruling 8/9: photo delete is the records.delete tier. Staff without it
  // never see the destructive affordance — the dialog becomes keep-only (the
  // stock description asks "delete them too?", the wrong question here).
  it('staffCanDeletePhotos=false → no 写真も削除 button, keep-only description, keep still works', async () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} staffCanDeletePhotos={false} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('sessionPhotos.discardPhotosDelete')).toBeNull()
    expect(
      screen.getByText('sessionPhotos.discardPhotosKeepOnlyDescription:{"n":1}'),
    ).toBeInTheDocument()
    // R13: with the destructive button gone, 残す IS the dialog's commit
    // action — the solid-accent `default` variant, never a second outline
    // twin of キャンセル (two identical buttons, one aborting and one
    // discarding the take, is the bug this pins).
    const keepBtn = screen.getByText('sessionPhotos.discardPhotosKeep').closest('[variant]')
    const cancelBtn = screen.getByText('cancel').closest('[variant]')
    expect(keepBtn).toHaveAttribute('variant', 'default')
    expect(cancelBtn).toHaveAttribute('variant', 'outline')
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosKeep'))
    await waitFor(() => expect(reasonGateShown()).toBe(true))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  it('staffCanDeletePhotos=false → キャンセル still aborts entirely', () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} staffCanDeletePhotos={false} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  // §9: the honest-loss toast for 'error' photos now lives here, i18n'd —
  // fires on the explicit-discard path even when there's no D3 dialog
  // (an error-only session skips the dialog but must not skip the toast).
  it('§9: discard with an error-status photo → i18n toast fires before discardRecording', async () => {
    sessionPhotoStore.photos = [donePhoto({ status: 'error', serverId: null })]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockToastWarning).toHaveBeenCalledWith('sessionPhotos.uploadsDropped:{"n":1}')
  })

  it('§9: no error photos → no drop toast', async () => {
    sessionPhotoStore.photos = []
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    confirmDiscardReason()
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  // §15: driven to actual COMPLETION (non-null result, real
  // globalPipeline.start() call via the mocked module) — the dialog must
  // still never appear, and the §9 drop-toast fires on this path too.
  it('§15: SAVE COMPLETION (non-null result) with error+done photos present → D3 dialog never appears', async () => {
    sessionPhotoStore.photos = [
      donePhoto({ id: 'ok', status: 'done' }),
      donePhoto({ id: 'lost', status: 'error', serverId: null }),
    ]
    mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 5000 }
    render(<RecordPageView {...baseProps} ticketsEnabled={false} />)
    fireEvent.click(screen.getByText('useRecording'))

    await waitFor(() => expect(mockPipelineStart).toHaveBeenCalledTimes(1))
    expect(mockDiscardRecording).toHaveBeenCalledWith({ keepTake: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith('sessionPhotos.uploadsDropped:{"n":1}')
  })

  it('SAVE path with result:null (not yet stopped) never shows the discard-photos dialog', () => {
    sessionPhotoStore.photos = [donePhoto()]
    // ticketsEnabled=false routes useRecording straight to handleUseRecording
    // (skips the outcome dialog); result stays null (default), so it returns
    // immediately (`if (!result) return`) — handleUseRecording never
    // references showDiscardPhotosDialog/sessionPhotosForDiscardDialog/
    // deleteCustomerPhoto anywhere in its body, structurally distinct from
    // handleDiscard.
    render(<RecordPageView {...baseProps} ticketsEnabled={false} />)
    fireEvent.click(screen.getByText('useRecording'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })
})
