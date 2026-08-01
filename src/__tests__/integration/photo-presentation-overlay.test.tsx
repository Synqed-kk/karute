/**
 * @jest-environment jsdom
 *
 * PhotoPresentationOverlay — restored spike feature (commit ecce3cdd, the
 * PhotoGallerySheet privacy contract), rebuilt on the app's Base UI Dialog
 * primitive (modal: inert background, focus trap, Escape) after the 8/1
 * fresh-eyes round. Locks: photo-only content (captions never render, not
 * even as alt), enlarge → back and exit flows, the history guard (Back /
 * native edge-swipe closes the overlay, never navigates the app under it),
 * signedUrl-less exclusion, and the derived filter (a vanished category
 * can never strand a fake-empty screen). next-intl mocked against the REAL
 * ja.json (repo convention, see customer-card-rails.test.tsx).
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
  it('opens fullscreen with only photo content — no captions, no chrome, no url-less photos', () => {
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)

    // Base UI portals to document.body — query the document, not container.
    expect(document.querySelector('.fixed.inset-0')).not.toBeNull()
    // Photo-safe content only: the two signedUrl photos render as tappable
    // thumbnails (ordinal aria-labels); the one without a signedUrl never
    // appears in the customer view.
    expect(screen.getByLabelText('ビフォー 1')).toBeInTheDocument()
    expect(screen.getByLabelText('アフター 2')).toBeInTheDocument()
    expect(screen.queryByLabelText(/参考/)).toBeNull()
    // Nothing from the surrounding tab (upload, compare) ever renders here —
    // this component doesn't import that chrome, so these must be absent.
    expect(screen.queryByText('写真を追加')).toBeNull()
    expect(screen.queryByText('比較')).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    // Captions are staff-internal — never rendered here, not even as img
    // alt (an expired signed URL would paint alt text on-screen).
    expect(screen.queryByText('before shot')).toBeNull()
    expect(document.querySelector('img[alt="before shot"]')).toBeNull()
  })

  it('tap enlarges a photo, tap again returns to the grid, X calls onClose', () => {
    const onClose = jest.fn()
    render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    const enlarged = screen.getByLabelText('グリッドに戻る')
    expect(enlarged).toBeInTheDocument()
    // Enlarged view: image only, caption stays off-screen and out of alt.
    expect(document.querySelector('img[alt="before shot"]')).toBeNull()
    // Grid thumbnails are gone while enlarged.
    expect(screen.queryByLabelText(/アフター/)).toBeNull()

    fireEvent.click(enlarged)
    expect(screen.getByLabelText('アフター 2')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('閉じる'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pushes a history entry; Back (popstate) closes instead of navigating', () => {
    const pushSpy = jest.spyOn(window.history, 'pushState')
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {})
    const onClose = jest.fn()
    const { unmount } = render(
      <PhotoPresentationOverlay photos={photos} onClose={onClose} />,
    )
    expect(pushSpy).toHaveBeenCalledWith({ karutePhotoPresentation: true }, '')

    // Native edge-swipe / browser Back surfaces as popstate → overlay closes.
    fireEvent.popState(window)
    expect(onClose).toHaveBeenCalledTimes(1)
    // Closed by Back: our entry is already consumed — no extra back() call.
    unmount()
    expect(backSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
    backSpy.mockRestore()
  })

  it('closing via X consumes the pushed history entry (history.back on unmount)', () => {
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {})
    const { unmount } = render(
      <PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />,
    )
    unmount() // the X path: parent clears presentationOpen, component unmounts
    expect(backSpy).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('a vanished filtered category falls back to all — never a fake-empty screen', () => {
    const { rerender } = render(
      <PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ビフォー' }))
    expect(screen.queryByLabelText(/アフター/)).toBeNull()

    // The before photo vanishes (external deletion): one category remains,
    // chips hide — the derived filter must fall back to showing the rest.
    rerender(
      <PhotoPresentationOverlay photos={[photos[1]!, photos[2]!]} onClose={jest.fn()} />,
    )
    expect(screen.getByLabelText('アフター 1')).toBeInTheDocument()
    expect(screen.queryByText('写真はまだありません')).toBeNull()
  })

  it('filter chips render only when more than one category is in use', () => {
    render(<PhotoPresentationOverlay photos={[photos[0]!]} onClose={jest.fn()} />)
    expect(screen.queryByText('すべて')).toBeNull()
  })
})
