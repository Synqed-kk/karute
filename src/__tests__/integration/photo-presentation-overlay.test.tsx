/**
 * @jest-environment jsdom
 *
 * PhotoPresentationOverlay — restored spike feature (commit ecce3cdd, the
 * PhotoGallerySheet privacy contract), rebuilt on the app's Base UI Dialog
 * primitive (modal: inert background, focus trap, Escape) after the 8/1
 * fresh-eyes round, then extended for the compare-inside-presentation
 * redesign (8/8): hold-to-close ✕ (replaces instant tap), a swallowed
 * popstate (Back/edge-swipe no longer closes — it re-pushes the guard),
 * multi-photo fullscreen browsing (chevrons/dots/swipe), and a customer-
 * safe compare mode (selection → side-by-side/overlay for 2, 2×2 grid for
 * 3–4). Locks: photo-only content (captions never render, not even as
 * alt, in ANY state), signedUrl-less exclusion, and the derived filter (a
 * vanished category can never strand a fake-empty screen). next-intl
 * mocked against the REAL ja.json (repo convention, see
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

// Five displayable photos, spread across three categories — needed for the
// selection cap (max 4, 5th tap ignored) and renumbering assertions, which
// the two-photo `photos` fixture above can't exercise. Captions are set
// (not null) so this fixture also drives the 3–4 photo / compare-sourced
// fullscreen privacy coverage below.
const manyPhotos: CustomerPhoto[] = [
  { id: 'm1', signedUrl: 'https://example.com/1.jpg', category: 'before', caption: 'm1 caption' },
  { id: 'm2', signedUrl: 'https://example.com/2.jpg', category: 'before', caption: 'm2 caption' },
  { id: 'm3', signedUrl: 'https://example.com/3.jpg', category: 'after', caption: 'm3 caption' },
  { id: 'm4', signedUrl: 'https://example.com/4.jpg', category: 'after', caption: 'm4 caption' },
  { id: 'm5', signedUrl: 'https://example.com/5.jpg', category: 'progress', caption: 'm5 caption' },
]
const manyCaptions = manyPhotos.map((p) => p.caption as string)

// 12 photos, all one category — a customer with a real gallery can have
// hundreds; this is enough to push the fullscreen viewer past the dots'
// 9-photo cutoff into the counter fallback.
const lotsOfPhotos: CustomerPhoto[] = Array.from({ length: 12 }, (_, i) => ({
  id: `lot-${i + 1}`,
  signedUrl: `https://example.com/lot-${i + 1}.jpg`,
  category: 'progress',
  caption: null,
}))

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
    // Nothing from the surrounding tab's upload chrome, or the STAFF
    // PhotoCompareView (its own picker copy is a distinct string from this
    // component's own 比較 pill/selection flow), ever renders here — this
    // component doesn't import that chrome.
    expect(screen.queryByText('写真を追加')).toBeNull()
    expect(screen.queryByText('比較する写真を2枚選んでください')).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    // Captions are staff-internal — never rendered here, not even as img
    // alt (an expired signed URL would paint alt text on-screen).
    expect(screen.queryByText('before shot')).toBeNull()
    expect(document.querySelector('img[alt="before shot"]')).toBeNull()
  })

  it('tap enlarges a photo, tap again returns to the grid', () => {
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)

    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    const enlarged = screen.getByLabelText('グリッドに戻る')
    expect(enlarged).toBeInTheDocument()
    // Enlarged view: image only, caption stays off-screen and out of alt.
    expect(document.querySelector('img[alt="before shot"]')).toBeNull()
    // Grid thumbnails are gone while enlarged.
    expect(screen.queryByLabelText(/アフター/)).toBeNull()

    fireEvent.click(enlarged)
    expect(screen.getByLabelText('アフター 2')).toBeInTheDocument()
  })

  it('fullscreen pagination dots: active dot is muted neutral, inactive stays fainter muted — never the saturated accent (one-way accent law, decorative/non-pressable)', () => {
    // Whole-class matcher: 'bg-primary' must not silently pass via a longer
    // token like 'bg-primary/8' (see accent-tier-contract.test.tsx).
    const cls = (name: string) => new RegExp(`(^|\\s)${name.replace('/', '\\/')}(\\s|$)`)
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByLabelText('ビフォー 1'))

    // Dots row is aria-hidden (chevrons/swipe are the accessible nav) —
    // query by its container class, not role.
    const dotsRow = document.querySelector('[aria-hidden="true"].bottom-2')
    const dots = Array.from(dotsRow?.children ?? []) as HTMLElement[]
    expect(dots).toHaveLength(2)
    expect(dots[0]?.className).toMatch(cls('bg-muted-foreground'))
    expect(dots[0]?.className).not.toMatch(cls('bg-primary'))
    expect(dots[0]?.className).not.toMatch(cls('bg-foreground'))
    expect(dots[1]?.className).toMatch(cls('bg-muted-foreground/40'))
  })

  it('fullscreen with 12+ photos: shows a position counter instead of dots (dots strip does not scale to a full gallery)', () => {
    render(<PhotoPresentationOverlay photos={lotsOfPhotos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByLabelText('経過 1'))

    expect(screen.getByText('1 / 12')).toBeInTheDocument()
    // Same aria-hidden nav-twin row as the dots test above, but past the
    // 9-photo cutoff it must render zero dot spans.
    const dotsRow = document.querySelector('[aria-hidden="true"].bottom-2')
    expect(dotsRow?.querySelectorAll('.size-1\\.5')).toHaveLength(0)

    fireEvent.click(screen.getByLabelText('次の写真'))
    fireEvent.click(screen.getByLabelText('次の写真'))
    expect(screen.getByText('3 / 12')).toBeInTheDocument()

    // Neutral only — never the saturated accent (one-way accent law).
    const counter = screen.getByText('3 / 12')
    expect(counter.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
    expect(counter.className).not.toMatch(/(^|\s)text-primary(\s|$)/)
  })

  describe('hold-to-close ✕', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    })

    // 600ms per Liam's 8/8 field-test ruling (was 1200 — felt broken on-device).
    it('does not close before the 600ms hold completes, closes exactly at 600ms', () => {
      const onClose = jest.fn()
      render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)
      const closeBtn = screen.getByLabelText('閉じる（長押し）')

      fireEvent.pointerDown(closeBtn)
      jest.advanceTimersByTime(599)
      expect(onClose).not.toHaveBeenCalled()

      jest.advanceTimersByTime(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('releasing before 600ms cancels the hold — no close', () => {
      const onClose = jest.fn()
      render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)
      const closeBtn = screen.getByLabelText('閉じる（長押し）')

      fireEvent.pointerDown(closeBtn)
      jest.advanceTimersByTime(300)
      fireEvent.pointerUp(closeBtn)
      jest.advanceTimersByTime(1200)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('holding shows the big centered progress ring; releasing hides it', () => {
      render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)
      const closeBtn = screen.getByLabelText('閉じる（長押し）')
      // Always mounted (so the stroke transition can animate), visibility
      // toggled via opacity — the finger hides the button's own ring on
      // touch, this centered twin is the progress the user actually sees.
      const ring = () => screen.getByTestId('hold-progress-ring')
      expect(ring().className).toContain('opacity-0')
      expect(ring().className).toContain('pointer-events-none')

      fireEvent.pointerDown(closeBtn)
      expect(ring().className).toContain('opacity-100')

      fireEvent.pointerUp(closeBtn)
      expect(ring().className).toContain('opacity-0')
    })

    it('keyboard Enter on the ✕ closes immediately — no hold required', () => {
      const onClose = jest.fn()
      render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)
      fireEvent.keyDown(screen.getByLabelText('閉じる（長押し）'), { key: 'Enter' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('popstate while open re-pushes the guard entry instead of closing (gesture swallow)', () => {
    const pushSpy = jest.spyOn(window.history, 'pushState')
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {})
    const onClose = jest.fn()
    render(<PhotoPresentationOverlay photos={photos} onClose={onClose} />)
    expect(pushSpy).toHaveBeenCalledWith({ karutePhotoPresentation: true }, '')
    const pushesAfterMount = pushSpy.mock.calls.length

    // Native edge-swipe / browser Back surfaces as popstate — a customer
    // holding the device must never get bounced into staff UI by an
    // accidental swipe, so the overlay re-pushes the guard and stays open.
    fireEvent.popState(window)
    expect(onClose).not.toHaveBeenCalled()
    expect(pushSpy.mock.calls.length).toBeGreaterThan(pushesAfterMount)
    expect(pushSpy).toHaveBeenLastCalledWith({ karutePhotoPresentation: true }, '')

    pushSpy.mockRestore()
    backSpy.mockRestore()
  })

  it('closing consumes the pushed history entry (history.back on unmount)', () => {
    const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {})
    const { unmount } = render(
      <PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />,
    )
    // Back never closes anymore (swallowed above) — the only way this
    // component unmounts is a real close (hold-complete / Escape /
    // keyboard), so cleanup unconditionally consumes the guard entry now
    // (the old closedByPop bookkeeping is gone).
    unmount() // parent-driven: onClose fired, presentationOpen cleared
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

  describe('compare selection', () => {
    it('toggles up to 4, ignores a 5th tap, and re-tap deselects + renumbers', () => {
      render(<PhotoPresentationOverlay photos={manyPhotos} onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: '比較' }))
      expect(screen.getByText('2〜4枚を選んでください')).toBeInTheDocument()

      // Ordinal is the photo's position in the grid (not per-category), so
      // with manyPhotos' before/before/after/after/progress order the
      // labels count 1–5 straight across.
      const p1 = screen.getByRole('button', { name: 'ビフォー 1' })
      const p2 = screen.getByRole('button', { name: 'ビフォー 2' })
      const p3 = screen.getByRole('button', { name: 'アフター 3' })
      const p4 = screen.getByRole('button', { name: 'アフター 4' })
      const p5 = screen.getByRole('button', { name: '経過 5' })

      fireEvent.click(p1)
      fireEvent.click(p2)
      expect(screen.getByRole('button', { name: '2枚を比較する' })).not.toBeDisabled()

      fireEvent.click(p3)
      fireEvent.click(p4)
      expect(screen.getByRole('button', { name: '4枚を比較する' })).toBeInTheDocument()

      // 5th tap ignored — still 4 selected.
      fireEvent.click(p5)
      expect(screen.getByRole('button', { name: '4枚を比較する' })).toBeInTheDocument()

      // Re-tap the first pick deselects it and renumbers the rest down.
      fireEvent.click(p1)
      expect(screen.getByRole('button', { name: '3枚を比較する' })).toBeInTheDocument()
    })

    it('CTA stays disabled below 2 selections', () => {
      render(<PhotoPresentationOverlay photos={manyPhotos} onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: '比較' }))
      fireEvent.click(screen.getByRole('button', { name: 'ビフォー 1' }))
      expect(screen.getByRole('button', { name: '1枚を比較する' })).toBeDisabled()
    })
  })

  it('2-photo compare: side-by-side by default, tap toggles to the opacity overlay and back', () => {
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    fireEvent.click(screen.getByLabelText('アフター 2'))
    fireEvent.click(screen.getByRole('button', { name: '2枚を比較する' }))

    // Side-by-side: no slider yet, tapping the picture enters overlay mode.
    expect(screen.queryByRole('slider')).toBeNull()
    const toOverlay = screen.getByLabelText('重ねて表示')
    fireEvent.click(toOverlay)

    // Overlay: opacity slider present.
    expect(screen.getByRole('slider')).toBeInTheDocument()
    const toSide = screen.getByLabelText('並べて表示')
    fireEvent.click(toSide)

    // Back to side-by-side.
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByLabelText('重ねて表示')).toBeInTheDocument()
  })

  it('戻る exits compare back to the presentation grid', () => {
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    fireEvent.click(screen.getByLabelText('アフター 2'))
    fireEvent.click(screen.getByRole('button', { name: '2枚を比較する' }))
    expect(screen.getByLabelText('重ねて表示')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(screen.getByLabelText('ビフォー 1')).toBeInTheDocument()
    expect(screen.queryByLabelText('重ねて表示')).toBeNull()
  })

  it('3–4 photo compare renders the 2×2 grid and stays caption-free', () => {
    render(<PhotoPresentationOverlay photos={manyPhotos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    // Select 4 (global grid ordinals, all consecutive from the start).
    fireEvent.click(screen.getByRole('button', { name: 'ビフォー 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'ビフォー 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'アフター 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'アフター 4' }))
    fireEvent.click(screen.getByRole('button', { name: '4枚を比較する' }))

    // compareCount === 4 forces the 2×2 grid subview — no side-by-side/
    // overlay chrome, four tappable panes (pane ordinals are LOCAL to the
    // selected set, which happens to match the global ones here since all
    // four were picked from the front).
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByLabelText('重ねて表示')).toBeNull()
    expect(screen.getByRole('button', { name: 'ビフォー 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アフター 4' })).toBeInTheDocument()

    for (const caption of manyCaptions) {
      expect(screen.queryByText(caption)).toBeNull()
    }
  })

  it('compare-sourced fullscreen (from the 2×2) cycles only the selected set, never a non-selected photo, and stays caption-free', () => {
    render(<PhotoPresentationOverlay photos={manyPhotos} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    // Non-consecutive pick — 3 of 5 (m1, m3, m5) — so a wrap that ever
    // touched m2/m4 (the unselected photos) would be visible.
    fireEvent.click(screen.getByRole('button', { name: 'ビフォー 1' })) // m1
    fireEvent.click(screen.getByRole('button', { name: 'アフター 3' })) // m3
    fireEvent.click(screen.getByRole('button', { name: '経過 5' })) // m5
    fireEvent.click(screen.getByRole('button', { name: '3枚を比較する' }))

    // Tap the first pane (local ordinal 1 — same as global here, m1) to
    // enter fullscreen browsing over just the 3 selected.
    fireEvent.click(screen.getByRole('button', { name: 'ビフォー 1' }))
    const currentSrc = () =>
      screen.getByLabelText('グリッドに戻る').querySelector('img')?.getAttribute('src')
    expect(currentSrc()).toBe('https://example.com/1.jpg') // m1

    const next = () => fireEvent.click(screen.getByLabelText('次の写真'))
    next()
    expect(currentSrc()).toBe('https://example.com/3.jpg') // m3
    next()
    expect(currentSrc()).toBe('https://example.com/5.jpg') // m5
    // Wraps from the last selected photo straight back to the first —
    // m2/m4 (unselected) must never appear.
    next()
    expect(currentSrc()).toBe('https://example.com/1.jpg') // m1 again

    for (const caption of manyCaptions) {
      expect(screen.queryByText(caption)).toBeNull()
    }
  })

  it('PRIVACY PIN: captions never appear in the DOM in grid, selection, compare, or fullscreen', () => {
    render(<PhotoPresentationOverlay photos={photos} onClose={jest.fn()} />)
    const noCaptions = () => {
      expect(screen.queryByText('before shot')).toBeNull()
      expect(screen.queryByText('after shot')).toBeNull()
      expect(document.querySelector('img[alt="before shot"]')).toBeNull()
      expect(document.querySelector('img[alt="after shot"]')).toBeNull()
    }

    noCaptions() // grid

    fireEvent.click(screen.getByRole('button', { name: '比較' }))
    noCaptions() // selection

    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    fireEvent.click(screen.getByLabelText('アフター 2'))
    noCaptions() // selection, both picked

    fireEvent.click(screen.getByRole('button', { name: '2枚を比較する' }))
    noCaptions() // compare, side-by-side

    fireEvent.click(screen.getByLabelText('重ねて表示'))
    noCaptions() // compare, overlay

    fireEvent.click(screen.getByLabelText('並べて表示'))
    noCaptions() // back to side-by-side

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    fireEvent.click(screen.getByLabelText('ビフォー 1'))
    noCaptions() // fullscreen from the grid
  })
})
