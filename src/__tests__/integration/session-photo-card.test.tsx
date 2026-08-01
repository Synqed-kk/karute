/**
 * @jest-environment jsdom
 *
 * SessionPhotoCard (build packet PR1 — セッション写真 card) contract:
 *  - take → upload wiring: uploading → done status transition
 *  - error → retry re-invokes the upload with the SAME file
 *  - the strip clears when the global recorder goes idle (discard/save handoff)
 *  - the hidden file input carries capture="environment" (pins the 8/2 finding
 *    that a plain file input falls back to the pick-only gallery on phones)
 *
 * next-intl is mocked to echo keys (repo convention). '@/actions/recordings'
 * is mocked the same way global-recorder-session-race.test.ts does — it's a
 * 'use server' module that pulls in @synqed-kk/client (ESM, breaks jest) and
 * global-recorder.ts imports it at module load.
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
jest.mock('@/actions/customers', () => ({
  uploadCustomerPhoto: (customerId: string, fd: FormData) =>
    mockUploadCustomerPhoto(customerId, fd),
}))

const mockToastWarning = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}))

import { SessionPhotoCard } from '@/components/karute/redesign/record/SessionPhotoCard'
import { globalRecorder } from '@/lib/global-recorder'

beforeAll(() => {
  // jsdom doesn't implement object URLs.
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

beforeEach(() => {
  jest.clearAllMocks()
  // Resets the recorder to idle, which also clears any leftover photo strip
  // from a prior test via the store's own idle subscription.
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
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)
    expect(fileInput(container)).toHaveAttribute('capture', 'environment')
    expect(fileInput(container)).toHaveAttribute('accept', 'image/*')
  })

  it('uploads on take and transitions uploading -> done', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)

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
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)

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
    const { container } = render(<SessionPhotoCard customerId="cust-2" />)
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
    expect(mockUploadCustomerPhoto).toHaveBeenCalledWith('cust-2', expect.any(FormData))
  })

  it('retry re-sends the SAME File object and shows the uploading dot while in flight', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)
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

  it('warns when the session ends with a failed-upload photo (honest loss)', async () => {
    mockUploadCustomerPhoto.mockResolvedValueOnce({ error: 'boom' })
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)
    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await screen.findByRole('button', { name: 'retry' })

    // Isolate from any toast the shared singleton fired during test cleanup.
    mockToastWarning.mockClear()
    globalRecorder.discard()

    await waitFor(() => expect(mockToastWarning).toHaveBeenCalledTimes(1))
    expect(String(mockToastWarning.mock.calls[0][0])).toContain('保存されていません')
  })

  it('clears the strip when the global recorder goes idle', async () => {
    mockUploadCustomerPhoto.mockResolvedValue({ photo: { id: 'p1' } })
    const { container } = render(<SessionPhotoCard customerId="cust-1" />)

    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } })
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1))

    // Both discard() and the save handoff route the recorder through 'idle'.
    globalRecorder.discard()

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0))
  })
})
