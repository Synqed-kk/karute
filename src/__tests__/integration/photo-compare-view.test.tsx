/**
 * @jest-environment jsdom
 *
 * PhotoCompareView — restored spike feature (commit ecce3cdd), rewired onto
 * the current Photos tab. Locks the pick → compare flow: tapping two
 * pickable thumbnails (signedUrl present) reveals the side/overlay tab
 * strip, the overlay slider actually re-blends the opacity, and toggling
 * modes swaps the slider in and out. next-intl mocked against the REAL
 * ja.json (repo convention, see customer-card-rails.test.tsx) so a missing
 * i18n key fails the suite instead of silently rendering the raw key.
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

// PhotoCompareView pulls KNOWN_CATEGORIES/toneFor from PhotosTabContent, which
// module-level-imports the router hook + server action — stub both so the
// import doesn't reach into next/navigation or synqed-core.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ uploadCustomerPhoto: jest.fn() }))

import { PhotoCompareView } from '@/components/customers/redesign/profile/PhotoCompareView'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

// Two distinct, non-before/after categories — keeps the auto-preselect
// (exactly-one-before + exactly-one-after) out of the way so the test
// exercises the manual pick path. Third photo has no signedUrl and must
// never appear as a pickable thumbnail.
const photos: CustomerPhoto[] = [
  { id: 'p-ref', signedUrl: 'https://example.com/ref.jpg', category: 'reference', caption: null },
  { id: 'p-prog', signedUrl: 'https://example.com/prog.jpg', category: 'progress', caption: null },
  { id: 'p-nourl', signedUrl: null, category: 'before', caption: null },
]

describe('PhotoCompareView', () => {
  it('picking two photos enters compare (side-by-side by default)', () => {
    render(<PhotoCompareView photos={photos} />)

    expect(screen.getByText('比較する写真を2枚選んでください')).toBeInTheDocument()
    // The un-pickable photo (no signedUrl) never renders a thumbnail button.
    expect(screen.queryByLabelText(/ビフォー/)).toBeNull()

    fireEvent.click(screen.getByLabelText('参考 1'))
    fireEvent.click(screen.getByLabelText('経過 2'))

    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()
    expect(screen.getByText('並べて表示')).toBeInTheDocument()
    expect(screen.getByText('重ねて表示')).toBeInTheDocument()
    // Side mode has no blend slider.
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('overlay slider changes the blended opacity, and toggling back to side removes it', () => {
    render(<PhotoCompareView photos={photos} />)
    fireEvent.click(screen.getByLabelText('参考 1'))
    fireEvent.click(screen.getByLabelText('経過 2'))

    fireEvent.click(screen.getByText('重ねて表示'))
    const slider = screen.getByRole('slider')
    // Bounds are contract: a mutated max/step would silently break blending.
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveAttribute('step', '0.01')
    expect(screen.getByText('50%')).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '0.8' } })
    expect(screen.getByText('80%')).toBeInTheDocument()

    fireEvent.click(screen.getByText('並べて表示'))
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('auto-picks when an upload during compare completes the unique before/after pair', () => {
    // Mounts with one before and NO after → nothing to auto-pick.
    const before: CustomerPhoto = {
      id: 'p-b', signedUrl: 'https://example.com/b.jpg', category: 'before', caption: null,
    }
    const ref: CustomerPhoto = {
      id: 'p-r', signedUrl: 'https://example.com/r.jpg', category: 'reference', caption: null,
    }
    const { rerender } = render(<PhotoCompareView photos={[before, ref]} />)
    expect(screen.getByText('比較する写真を2枚選んでください')).toBeInTheDocument()

    // An upload refreshes the photos prop with the first after — the pair is
    // now unambiguous and must be picked without a remount (Greptile P2).
    const after: CustomerPhoto = {
      id: 'p-a', signedUrl: 'https://example.com/a.jpg', category: 'after', caption: null,
    }
    rerender(<PhotoCompareView photos={[before, ref, after]} />)
    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()

    // An explicit deselection is never overridden by an unrelated refresh.
    fireEvent.click(screen.getByLabelText(/^ビフォー/))
    fireEvent.click(screen.getByLabelText(/^アフター/))
    expect(screen.getByText('比較する写真を2枚選んでください')).toBeInTheDocument()
    rerender(<PhotoCompareView photos={[before, ref, after]} />)
    expect(screen.getByText('比較する写真を2枚選んでください')).toBeInTheDocument()
  })

  it('rolling pick: a third tap drops the OLDEST pick, keeps the newer one', () => {
    const three: CustomerPhoto[] = [
      { id: 'a', signedUrl: 'https://example.com/1.jpg', category: 'progress', caption: null },
      { id: 'b', signedUrl: 'https://example.com/2.jpg', category: 'progress', caption: null },
      { id: 'c', signedUrl: 'https://example.com/3.jpg', category: 'progress', caption: null },
    ]
    render(<PhotoCompareView photos={three} />)
    const first = screen.getByLabelText('経過 1')
    const second = screen.getByLabelText('経過 2')
    const third = screen.getByLabelText('経過 3')

    fireEvent.click(first)
    fireEvent.click(second)
    fireEvent.click(third)
    expect(first).toHaveAttribute('aria-pressed', 'false')
    expect(second).toHaveAttribute('aria-pressed', 'true')
    expect(third).toHaveAttribute('aria-pressed', 'true')
  })

  it('prunes a picked photo that a refresh removed (no stale selection)', () => {
    const a: CustomerPhoto = { id: 'a', signedUrl: 'https://example.com/1.jpg', category: 'progress', caption: null }
    const b: CustomerPhoto = { id: 'b', signedUrl: 'https://example.com/2.jpg', category: 'progress', caption: null }
    const c: CustomerPhoto = { id: 'c', signedUrl: 'https://example.com/3.jpg', category: 'progress', caption: null }
    const { rerender } = render(<PhotoCompareView photos={[a, b, c]} />)
    fireEvent.click(screen.getByLabelText('経過 1'))
    fireEvent.click(screen.getByLabelText('経過 2'))
    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()

    // Photo b vanishes (deleted from another session) — its pick must not
    // linger: picking c should complete a valid pair with a immediately.
    rerender(<PhotoCompareView photos={[a, c]} />)
    expect(screen.getByText('比較する写真を2枚選んでください')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('経過 2')) // c is now ordinal 2
    expect(screen.getByText('写真をタップすると選び直せます')).toBeInTheDocument()
  })
})
