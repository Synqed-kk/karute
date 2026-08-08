/**
 * @jest-environment jsdom
 *
 * SessionPhotoCard (build packet PR1 — セッション写真 card; PR 9b adapted)
 * contract:
 *  - take → upload wiring: uploading → done status transition
 *  - error → retry re-invokes the upload with the SAME file
 *  - the strip clears when the global recorder goes idle (discard/save handoff)
 *  - the hidden file input carries capture="environment" (pins the 8/2 finding
 *    that a plain file input falls back to the pick-only gallery on phones)
 *  - PR 9b §①: recording_session_id stamped from the recorder's resolved
 *    mint / absent when unresolved, taken_with_consent stamped from the
 *    takenWithConsent prop (D2), serverId captured from the upload result
 *  - PR 9b §③: お客様に見せる passes PhotoPresentationOverlay the FULL
 *    customer aggregate (listCustomerPhotos), never this card's in-session
 *    list — the past-photos structure pin
 *
 * next-intl is mocked to echo keys (repo convention). '@/actions/recordings'
 * is mocked the same way global-recorder-session-race.test.ts does — it's a
 * 'use server' module that pulls in @synqed-kk/client (ESM, breaks jest) and
 * global-recorder.ts imports it at module load. PhotoPresentationOverlay is
 * stubbed (props-capture only) — packet 9b forbids touching its internals;
 * this file only pins what SessionPhotoCard PASSES it.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

jest.mock('@/actions/recordings', () => ({
  startRecordingSession: jest.fn(async () => null),
}))

const mockUploadCustomerPhoto = jest.fn()
const mockListCustomerPhotos = jest.fn()
jest.mock('@/actions/customers', () => ({
  uploadCustomerPhoto: (customerId: string, fd: FormData) =>
    mockUploadCustomerPhoto(customerId, fd),
  listCustomerPhotos: (customerId: string) => mockListCustomerPhotos(customerId),
}))

const mockToastWarning = jest.fn()
const mockToastError = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: jest.fn(),
    error: (...args: unknown[]) => mockToastError(...args),
    info: jest.fn(),
  },
}))

const mockPhotoPresentationOverlay = jest.fn()
jest.mock('@/components/customers/redesign/profile/PhotoPresentationOverlay', () => ({
  PhotoPresentationOverlay: (props: { photos: unknown[]; onClose: () => void }) => {
    mockPhotoPresentationOverlay(props)
    return null
  },
}))

import { SessionPhotoCard } from '@/components/karute/redesign/record/SessionPhotoCard'
import { sessionPhotoStore } from '@/lib/karute/session-photos'
import { globalRecorder } from '@/lib/global-recorder'
import { startRecordingSession } from '@/actions/recordings'

beforeAll(() => {
  // jsdom doesn't implement object URLs.
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

beforeEach(() => {
  jest.clearAllMocks()
  // Resets the recorder to idle, which also clears any leftover photo strip
  // from a prior test via the store's own idle subscription. discard() also
  // resets recordingSessionId/recordingSessionPromise to null — the default
  // "mint absent" state each test starts from.
  globalRecorder.discard()
})

function makeFile(name = 'photo.jpg') {
  return new File(['data'], name, { type: 'image/jpeg' })
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement
}

describe('SessionPhotoCard', () => {
  it('renders the hidden capture input with capture="environment"', () => {
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    expect(fileInput(container)).toHaveAttribute('capture', 'environment')
    expect(fileInput(container)).toHaveAttribute('accept', 'image/*')
  })

  it('uploads on take and transitions uploading -> done', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )

    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })

    await waitFor(() =>
      expect(container.querySelector('.bg-amber-500')).toBeInTheDocument(),
    )
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(container.querySelector('.bg-amber-500')).not.toBeInTheDocument(),
    )
    expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument()
    expect(mockUploadCustomerPhoto).toHaveBeenCalledWith('cust-1', expect.any(FormData))
  })

  it('retry re-invokes the upload with the same file after an error', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )

    fireEvent.change(fileInput(container), { target: { files: [makeFile('retry.jpg')] } })
    const retryButton = await screen.findByRole('button', { name: 'retry' })

    mockUploadCustomerPhoto.mockResolvedValueOnce({ photo: { id: 'p2' } })
    fireEvent.click(retryButton)

    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(2))
    const secondCallFormData = mockUploadCustomerPhoto.mock.calls[1][1] as FormData
    expect((secondCallFormData.get('file') as File).name).toBe('retry.jpg')
  })

  it('uploads to the customerId PROP, not a fixed id (armor: prop wiring)', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p9' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-2" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    expect(mockUploadCustomerPhoto).toHaveBeenCalledWith('cust-2', expect.any(FormData))
  })

  it('retry re-sends the SAME File object and shows the uploading dot while in flight', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    const original = makeFile('identity.jpg')
    fireEvent.change(fileInput(container), { target: { files: [original] } })
    const retryButton = await screen.findByRole('button', { name: 'retry' })

    // Controllable second attempt so the transient state is observable.
    let resolveUpload: (v: unknown) => void = () => {}
    mockUploadCustomerPhoto.mockImplementationOnce(
      () => new Promise((res) => { resolveUpload = res }),
    )
    fireEvent.click(retryButton)
    // Transient uploading dot during the retry (armor 4b).
    await waitFor(() =>
      expect(container.querySelector('.bg-amber-500')).toBeInTheDocument(),
    )
    // Double-tap while in flight must NOT fire a third upload (P2 guard) —
    // the thumbnail is no longer in 'error', so retry() no-ops.
    fireEvent.click(
      container.querySelector('button[aria-label="uploading"]') ?? retryButton,
    )
    expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(2)
    // Identity, not just name (armor 4a): the retried upload must carry the
    // exact original File — re-encoding would corrupt the capture.
    const secondCallFormData = mockUploadCustomerPhoto.mock.calls[1][1] as FormData
    // Object.is, not toBe: a failing toBe would deep-copy the File for the
    // diff, which crashes node 24's worker (native assert) — boolean compare
    // keeps the failure printable.
    expect(Object.is(secondCallFormData.get('file'), original)).toBe(true)
    resolveUpload({ photo: { id: 'p3' } })
    await waitFor(() =>
      expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument(),
    )
  })

  // §9 (blind round): the honest-loss toast moved OUT of the store into
  // RecordPageView (i18n'd, computed before discardRecording()/save handoff
  // — see record-discard-photos-dialog.test.tsx for the new coverage). This
  // pins the negative: clear() itself must never toast again, or the
  // customer would see it twice once RecordPageView's own toast is wired.
  it('does NOT toast on clear (moved to RecordPageView, i18n\'d — §9)', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await screen.findByRole('button', { name: 'retry' })

    mockToastWarning.mockClear()
    globalRecorder.discard()

    // Give a (no-longer-existing) toast a beat to fire if it somehow still did.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('clears the strip when the global recorder goes idle', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )

    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1))

    // Both discard() and the save handoff route the recorder through 'idle'.
    globalRecorder.discard()

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0))
  })

  // §16 (blind round) — the render-body filter (blind-round P3 defense)
  // must actually exclude a foreign customer's photo, not just the ones this
  // card ever added itself. Seeded directly (bypassing addPhoto, which would
  // try to upload) — a plausible shape if the invariant "store holds only
  // one session's photos" ever weakens.
  it("excludes another customer's photo from render (cross-customer filter)", () => {
    sessionPhotoStore.photos = [
      {
        id: 'foreign-1',
        objectUrl: 'blob:foreign',
        status: 'done',
        file: makeFile(),
        category: 'before',
        customerId: 'cust-OTHER',
        serverId: 'server-foreign',
        takenWithConsent: false,
      },
    ]
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('count:{"n":0}')).toBeInTheDocument()
  })

  // §18 tidy — the earlier serverId pin only covered the first-try path;
  // this proves the store also updates it on a retry's eventual success.
  it('captures serverId after a retry succeeds (not just first-try)', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    const retryButton = await screen.findByRole('button', { name: 'retry' })

    mockUploadCustomerPhoto.mockResolvedValueOnce({ photo: { id: 'p-retry-server' } })
    fireEvent.click(retryButton)

    await waitFor(() =>
      expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument(),
    )
    expect(sessionPhotoStore.photos[0].serverId).toBe('p-retry-server')
  })
})

// §14 (blind round) — mint-race coverage: the fast paths (mint already
// resolved / mint never started) were already pinned above; this exercises
// awaitRecordingSessionId's actual Promise.race branch — a mint that's still
// IN FLIGHT when the upload starts, settling (either way) while the upload
// awaits it. globalRecorder.start() sets up the real recordingSessionPromise
// synchronously (before its own getUserMedia await), so calling it — even
// though getUserMedia itself will fail in jsdom — is enough to seed a
// genuinely pending mint; @/actions/recordings is already mocked above.
describe('SessionPhotoCard — linkage stamping mint race (§14)', () => {
  function startWithPendingMint() {
    let resolveMint: (v: { id: string } | null) => void = () => {}
    ;(startRecordingSession as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { resolveMint = res }),
    )
    void globalRecorder.start({
      target: { customerId: 'cust-1', customerName: 'x', karuteNumber: null, appointmentId: null },
    })
    return (result: { id: string } | null) => resolveMint(result)
  }

  it('mint PENDING at upload time, then resolves → stamps recording_session_id', async () => {
    const resolveMint = startWithPendingMint()
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    // Settle the mint WHILE the upload's awaitRecordingSessionId is racing it.
    resolveMint({ id: 'sess-race-won' })

    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('recording_session_id')).toBe('sess-race-won')
  })

  it('mint PENDING at upload time, then resolves null → recording_session_id omitted', async () => {
    const resolveMint = startWithPendingMint()
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    resolveMint(null)

    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('recording_session_id')).toBeNull()
  })
})

// PR 9b §① — linkage stamping. globalRecorder.recordingSessionId is a public
// field (the SAME one awaitRecordingSessionId's fast path reads); seeding it
// directly exercises the real resolution method without needing a real
// getUserMedia/mint round-trip in jsdom.
describe('SessionPhotoCard — linkage stamping (PR 9b §①)', () => {
  it('stamps recording_session_id when the recorder mint has resolved', async () => {
    globalRecorder.recordingSessionId = 'sess-1'
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('recording_session_id')).toBe('sess-1')
  })

  it('mint absent/failed → recording_session_id is NOT in the FormData (fail-open)', async () => {
    // beforeEach's globalRecorder.discard() already leaves recordingSessionId
    // AND recordingSessionPromise null — the "mint never resolved" state.
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('recording_session_id')).toBeNull()
  })

  it('stamps taken_with_consent="true" from the takenWithConsent prop (D2)', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={true} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('taken_with_consent')).toBe('true')
  })

  it('stamps taken_with_consent="false" from the takenWithConsent prop (D2)', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
    expect(fd.get('taken_with_consent')).toBe('false')
  })

  it('captures serverId from the upload result on success', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p-server-1' } })
    const { container } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() =>
      expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument(),
    )
    expect(sessionPhotoStore.photos[0].serverId).toBe('p-server-1')
  })
})

// PR 9b §③ — お客様に見せる pulls the CUSTOMER AGGREGATE, never this card's
// in-session list. The past-photos structure pin: a different-session photo
// and a null-session photo must BOTH reach the overlay unfiltered.
describe('SessionPhotoCard — お客様に見せる (PR 9b §③)', () => {
  it('passes the FULL unfiltered aggregate to PhotoPresentationOverlay', async () => {
    mockListCustomerPhotos.mockResolvedValue({
      photos: [
        { id: 'p-this-session', signed_url: 'https://x/a', category: 'before', caption: null, recording_session_id: 'sess-current' },
        { id: 'p-other-session', signed_url: 'https://x/b', category: 'after', caption: null, recording_session_id: 'sess-old' },
        { id: 'p-no-session', signed_url: 'https://x/c', category: 'reference', caption: null, recording_session_id: null },
      ],
    })
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    fireEvent.click(screen.getByText('presentButton'))

    await waitFor(() => expect(mockPhotoPresentationOverlay).toHaveBeenCalled())
    const { photos } = mockPhotoPresentationOverlay.mock.calls[0][0] as {
      photos: Array<{ id: string }>
    }
    // Both the different-session AND the null-session photo reached the
    // overlay — proves this is the aggregate fetch (listCustomerPhotos), not
    // this card's session-scoped strip.
    expect(photos.map((p) => p.id)).toEqual([
      'p-this-session',
      'p-other-session',
      'p-no-session',
    ])
    expect(mockListCustomerPhotos).toHaveBeenCalledWith('cust-1')
  })

  it('fetch error → toast, overlay stays closed', async () => {
    mockListCustomerPhotos.mockRejectedValue(new Error('down'))
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    fireEvent.click(screen.getByText('presentButton'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))
    expect(mockPhotoPresentationOverlay).not.toHaveBeenCalled()
  })
})
