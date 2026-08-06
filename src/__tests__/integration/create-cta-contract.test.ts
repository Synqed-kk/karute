/**
 * Create-CTA unification contract (Liam rulings 2026-08-06 案A +
 * 2026-08-07 responsive form): the three list-page create CTAs —
 * 顧客/カルテ/予約 — all render the SHARED <Button>
 * (@/components/ui/button) with its default recipe (no className, no
 * size/variant), a recognizable per-page icon (UserPlus / FilePlus2 /
 * CalendarPlus — never a bare plus glyph), and the「+ ラベル」wording
 * that collapses away below 380px while aria-label preserves the
 * accessible name. The 予約 one must stay a `newBookingSlot` override:
 * the @synqed-kk/ui package default is an icon-only square on mobile,
 * which the 案A ruling killed.
 *
 * Source-pin (not render) contract: both views need heavy data/provider
 * scaffolding to mount, and what the rulings fix is the authored recipe
 * itself. Structure is pinned, names are not — and the pins are exact
 * strings on purpose: consolidating the triplicated CTA body into a
 * shared component, or reordering pinned class strings, must come
 * through this contract deliberately rather than slide past it.
 * (Cannot catch cascade/layout issues — that is the visual pass's job.)
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const SHARED_IMPORT = "import { Button } from '@/components/ui/button'"
const RESPONSIVE_LABEL = 'hidden min-[380px]:inline'

/** All <Button ...> opening tags in a source string. */
const buttonTags = (src: string) => src.match(/<Button\b[^>]*>/g) ?? []

/** A CTA Button may carry ONLY type/onClick/aria-label — anything else
 *  (className, size, variant, ...) changes pixels and breaks the ruling. */
const expectPlain = (tag: string | undefined) => {
  expect(tag).toBeDefined()
  // A JSX spread would smuggle props past the name scan below.
  expect(tag).not.toMatch(/\{\s*\.\.\./)
  const props = [...(tag as string).matchAll(/([\w-]+)=/g)].map((m) => m[1])
  expect(props.filter((p) => !['type', 'onClick', 'aria-label'].includes(p))).toEqual([])
}

/** The CTA body: narrow-only per-page icon + wide-only label span —
 *  words on regular widths, icon below 380px, never both at once. */
const expectIconPlusLabel = (src: string, icon: string, labelExpr: string) => {
  expect(src).toContain(`<${icon} className="size-3.5 min-[380px]:hidden" aria-hidden />`)
  expect(src).toContain(`<span className="${RESPONSIVE_LABEL}">{${labelExpr}}</span>`)
}

describe('create-CTA unification (案A 8/6 + responsive 8/7)', () => {
  it('カルテ list CTA: shared Button, FilePlus2 icon, responsive label', () => {
    const src = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    const tags = buttonTags(src)
    expect(tags).toHaveLength(1)
    expectPlain(tags[0])
    expectIconPlusLabel(src, 'FilePlus2', "t('newKarute')")
  })

  it('予約 header CTA: newBookingSlot override with shared Button, CalendarPlus icon, responsive label', () => {
    const src = read('src/components/appointments/AppointmentsView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    // Bounded: the slot value must BE a single <Button>…</Button>.
    const slot = src.match(/newBookingSlot=\{\s*<Button\b[\s\S]*?<\/Button>\s*\}/)?.[0]
    expect(slot).toBeDefined()
    expectPlain(buttonTags(slot as string)[0])
    expectIconPlusLabel(slot as string, 'CalendarPlus', "tReservation('new')")
    expect(buttonTags(src)).toHaveLength(1)
  })

  it('顧客 CTA: shared Button, UserPlus icon, responsive label', () => {
    const src = read('src/components/customers/CustomerSheet.tsx')
    expect(src).toContain(SHARED_IMPORT)
    expectPlain(buttonTags(src)[0])
    expectIconPlusLabel(src, 'UserPlus', "t('newCustomer')")
  })

  it('the「+ ラベル」wording is baked into all three labels, both locales', () => {
    const ja = JSON.parse(read('messages/ja.json'))
    expect(ja.customers.newCustomer).toBe('+ 新規顧客')
    expect(ja.karute.recordList.newKarute).toBe('+ 新規カルテ')
    expect(ja.reservation.new).toBe('+ 新規予約')
    const en = JSON.parse(read('messages/en.json'))
    expect(en.customers.newCustomer).toBe('+ New customer')
    expect(en.karute.recordList.newKarute).toBe('+ New karute')
    expect(en.reservation.new).toBe('+ New booking')
  })

  it('header structure contract: one shared top offset, natural-height centered rows, no wrap, 16px rhythm, 24px 予約 seam', () => {
    // Exact-string row pins: appending flex-wrap/items-start (any position)
    // or reordering breaks the match — order-proof, unlike an ordered regex.
    const kokyaku = read('src/components/customers/redesign/list/CustomersListHeader.tsx')
    expect(kokyaku).toContain('<div className="flex items-center justify-between gap-3">')
    expect(kokyaku).toContain('min-w-0 flex-1 truncate')
    const kokyakuView = read('src/components/customers/redesign/list/CustomersListView.tsx')
    expect(kokyakuView).toMatch(/flex-col gap-4/)
    const karute = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    expect(karute).toContain('<div className="md:mt-5">')
    expect(karute).toContain('<div className="flex items-center justify-between gap-3 md:mt-1">')
    expect(karute).toContain('min-w-0 flex-1 truncate')
    expect(karute).toContain('<div className="mt-4">')
    expect(karute).toContain('<div className="pt-4">')
    const yoyaku = read('src/components/appointments/AppointmentsView.tsx')
    const headerTag = yoyaku.match(/<ReservationPageHeader[\s\S]*?className="([^"]*)"/)?.[1] ?? ''
    expect(headerTag).toContain('mb-0')
    expect(yoyaku).toMatch(/relative space-y-4/)
    // 24px seam: mb-0 zeroes space-y-4's margin on the header (same
    // property, higher specificity), so the pt-6 wrapper owns the seam.
    expect(yoyaku).toContain('<div className="pt-6">')
    const filter = read('src/components/karute/spike-lifted/reservation/ReservationStaffFilter.tsx')
    expect(filter).toContain('gap-x-2 gap-y-3')
  })
})
