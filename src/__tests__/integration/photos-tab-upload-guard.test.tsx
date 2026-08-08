/**
 * @jest-environment jsdom
 *
 * PhotosTabContent — final client-side size guard before upload.
 *
 * The guard blocks only what the server would certainly reject: the
 * probe-proven ~950KB (PHOTO_UPLOAD_REJECT_BYTES) 503 floor, NOT the
 * shrink ladder's 900KB (PHOTO_UPLOAD_TARGET_BYTES) safety margin. Files
 * in the 900-950KB dead zone are a legitimate pass-through (e.g.
 * undecodable desktop-browser HEIC returned untouched by
 * shrinkPhotoForUpload) that reaches the server successfully — an earlier
 * version of this guard mistakenly threw at >900KB, permanently blocking
 * that window with "try again" copy that could never come true.
 *
 * Contracts under test:
 *  - shrinkPhotoForUpload resolving at/above PHOTO_UPLOAD_REJECT_BYTES →
 *    uploadCustomerPhoto is NEVER called and the deterministic
 *    photoTooLarge copy is shown (no "try again" — this can never
 *    succeed on retry).
 *  - shrinkPhotoForUpload resolving inside the 900-950KB dead zone →
 *    uploadCustomerPhoto IS called. Regression pin: this must fail if
 *    anyone re-tightens the guard back to the 900KB target.
 *  - shrinkPhotoForUpload resolving at/under PHOTO_UPLOAD_TARGET_BYTES →
 *    uploadCustomerPhoto IS called (happy path).
 *  - shrinkPhotoForUpload resolving one byte under the reject floor
 *    (boundary partner for the >= reject-floor test) → uploaded.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ uploadCustomerPhoto: jest.fn() }))
jest.mock('@/lib/photo-shrink', () => ({
  ...jest.requireActual('@/lib/photo-shrink'),
  shrinkPhotoForUpload: jest.fn(),
}))

import '@testing-library/jest-dom'
import { uploadCustomerPhoto } from '@/actions/customers'
import {
  shrinkPhotoForUpload,
  PHOTO_UPLOAD_TARGET_BYTES,
  PHOTO_UPLOAD_REJECT_BYTES,
} from '@/lib/photo-shrink'
import { PhotosTabContent } from '@/components/customers/redesign/profile/PhotosTabContent'

const mockShrink = shrinkPhotoForUpload as jest.Mock
const mockUpload = uploadCustomerPhoto as jest.Mock

const UPLOAD_ERROR_TEXT = 'アップロードに失敗しました。もう一度お試しください。'
const PHOTO_TOO_LARGE_TEXT = '写真のサイズが大きすぎるためアップロードできません。'

function fileOfSize(bytes: number): File {
  // File.size is a real getter off byte length — pad content, don't fake it.
  return new File([new Uint8Array(bytes)], 'shrunk.jpg', { type: 'image/jpeg' })
}

async function selectFile(shrunkSize: number) {
  mockShrink.mockResolvedValue(fileOfSize(shrunkSize))
  const { container } = render(<PhotosTabContent customerId="c-1" photos={[]} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const picked = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [picked] } })
}

beforeEach(() => {
  mockShrink.mockReset()
  mockUpload.mockReset()
})

describe('PhotosTabContent upload size guard', () => {
  it('blocks a shrunk photo at the reject floor and shows the deterministic too-large copy', async () => {
    await selectFile(PHOTO_UPLOAD_REJECT_BYTES)

    await waitFor(() => expect(screen.getByText(PHOTO_TOO_LARGE_TEXT)).toBeInTheDocument())
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('DEAD-ZONE REGRESSION PIN: uploads a shrunk photo between the target and the reject floor', async () => {
    mockUpload.mockResolvedValue({ id: 'photo-1' })
    await selectFile(920_000)

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(PHOTO_TOO_LARGE_TEXT)).toBeNull()
    expect(screen.queryByText(UPLOAD_ERROR_TEXT)).toBeNull()
  })

  it('uploads when the shrunk photo is at or under the shrink target', async () => {
    mockUpload.mockResolvedValue({ id: 'photo-1' })
    await selectFile(PHOTO_UPLOAD_TARGET_BYTES)

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(UPLOAD_ERROR_TEXT)).toBeNull()
  })

  it('uploads a shrunk photo one byte under the reject floor (boundary partner)', async () => {
    mockUpload.mockResolvedValue({ id: 'photo-1' })
    await selectFile(PHOTO_UPLOAD_REJECT_BYTES - 1)

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(UPLOAD_ERROR_TEXT)).toBeNull()
  })
})
