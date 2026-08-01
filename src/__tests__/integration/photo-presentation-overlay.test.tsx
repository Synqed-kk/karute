/**
 * @jest-environment jsdom
 *
 * PhotoPresentationOverlay — restored spike feature (commit ecce3cdd, the
 * PhotoGallerySheet privacy contract), rewired onto the current Photos tab
 * as a standalone fullscreen "hand the device to the customer" view. Locks
 * the privacy contract structurally: rendered standalone it can only ever
 * contain photo grid / enlarge / exit chrome — never the surrounding tab's
 * upload or compare controls — plus the enlarge → back and exit flows.
 * next-intl mocked against the REAL ja.json (repo convention, see
 * customer-card-rails.test.tsx).
 */
import { render, screen, fireEvent } from '@testing-library/react'

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

// Same transitive-import stubs as PhotosTabContent.tsx needs (see
// photo-compare-view.test.tsx) — this component also pulls the shared
// KNOWN_CATEGORIES/toneFor helpers from that module.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ uploadCustomerPhoto: jest.fn() }))

import { PhotoPresentationOverlay } from '@/components/customers/redesign/profile/PhotoPresentationOverlay'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

const photos: CustomerPhoto[] = [
  { id: 'p-before', signedUrl: 'https://example.com/before.jpg', category: 'before', caption: 'before shot' },
  { id: 'p-after', signedUrl: 'https://example.com/after.jpg', category: 'after', caption: 'after shot' },
  { id: 'p-nourl', signedUrl: null, category: 'reference', caption: null },
]

describe('PhotoPresentationOverlay', () => {
  it('opens fullscreen with only photo content — no surrounding-tab chrome', () => {
    const { container } = render(
      <PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />,
    )

    expect(container.querySelector('.fixed.inset-0')).not.toBeNull()
    // Photo-safe content only: the two signedUrl photos render as tappable
    // thumbnails; the one without a signedUrl never appears.
    expect(screen.getByLabelText('ビフォー')).toBeInTheDocument()
    expect(screen.getByLabelText('アフター')).toBeInTheDocument()
    // Nothing from the surrounding tab (upload, compare) ever renders here —
    // this component doesn't import that chrome, so these must be absent.
    expect(screen.queryByText('写真を追加')).toBeNull()
    expect(screen.queryByText('比較')).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    // Captions are staff-internal — never rendered here, not even as img
    // alt (an expired signed URL would paint alt text on-screen).
    expect(screen.queryByText('before shot')).toBeNull()
    expect(container.querySelector('img[alt="before shot"]')).toBeNull()
  })

  it('tap enlarges a photo, tap again returns to the grid, X calls onClose', () => {
    const onClose = jest.fn()
    render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('ビフォー'))
    const enlarged = screen.getByLabelText('グリッドに戻る')
    expect(enlarged).toBeInTheDocument()
    // Enlarged view: image only, caption stays off-screen and out of alt.
    expect(document.querySelector('img[alt="before shot"]')).toBeNull()
    // Grid thumbnails are gone while enlarged.
    expect(screen.queryByLabelText('アフター')).toBeNull()

    fireEvent.click(enlarged)
    expect(screen.getByLabelText('アフター')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('閉じる'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
