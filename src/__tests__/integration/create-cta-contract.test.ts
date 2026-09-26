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

/** All <Button ...> opening tags in a source string. The alternation
 *  steps over `=>` arrows inside prop values, so the capture runs to the
 *  tag's REAL closing bracket — a plain [^>]* stops at the arrow's `>`
 *  and everything after onClick escapes every check (final-lens P1 8/7). */
const buttonTags = (src: string) => src.match(/<Button\b(?:=>|[^>])*>/g) ?? []

/** A CTA Button may carry ONLY type/onClick/aria-label — anything else
 *  (className, size, variant, bare booleans like disabled, ...) changes
 *  the recipe and breaks the ruling. Spreads are banned outright (they
 *  would smuggle props past the scan); stripping expression/string
 *  bodies and tokenizing what remains catches value-less props too. */
const expectPlain = (tag: string | undefined) => {
  expect(tag).toBeDefined()
  // A JSX spread would smuggle props past the token scan below.
  expect(tag).not.toMatch(/\{\s*\.\.\./)
  let s = (tag as string).replace(/^<Button\b/, '').replace(/\/?>$/, '')
  while (/\{[^{}]*\}/.test(s)) s = s.replace(/\{[^{}]*\}/g, '')
  s = s.replace(/"[^"]*"/g, '')
  const props = s.match(/[\w-]+/g) ?? []
  expect(props.filter((p) => !['type', 'onClick', 'aria-label'].includes(p))).toEqual([])
}

/** Anchored row pin: the info+create row div followed directly by its
 *  truncating status <p> — matched together, so a class reorder, a
 *  decoy string elsewhere in the file, or a comment copy cannot
 *  satisfy it (verify-round exploits 8/7). */
const rowWithStatus = (src: string, rowClass: string) => {
  const m = src.match(new RegExp(`<div className="${rowClass}">\\s*<p className="([^"]*)"`))
  expect(m).toBeTruthy()
  expect(m?.[1]).toBe('min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground')
}

/** The CTA body: narrow-only per-page icon + wide-only label span —
 *  words on regular widths, icon below 380px, never both at once. */
const expectIconPlusLabel = (src: string, icon: string, labelExpr: string) => {
  expect(src).toContain(`<${icon} className="size-3.5 min-[380px]:hidden" aria-hidden />`)
  expect(src).toContain(`<span className="${RESPONSIVE_LABEL}">{${labelExpr}}</span>`)
  // aria-label VALUE pinned, not just presence: below 380px it IS the
  // accessible name (round-4 finding 8/7 — wrong key/empty slipped by).
  expect(src).toContain(`aria-label={${labelExpr}}`)
}

describe('create-CTA unification (案A 8/6 + responsive 8/7)', () => {
  // ⚖ Liam 9/26 「案C+ Looks good.」 supersedes the 8/6–8/7 recipe for the
  // カルテ list ONLY: the create action is a solid primary circle (＋) at the
  // end of the search row, the search field's own 36px — the header cannot
  // hold a third item beside its centred title (mock D32). Still the SHARED
  // Button with its default (primary) variant; the accessible name is the
  // same 「+ 新規カルテ」 key the words used to show.
  it('カルテ list CTA (案C+): shared Button, primary ＋ circle at the end of the search row', () => {
    const src = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    const tags = buttonTags(src)
    expect(tags).toHaveLength(1)
    const tag = tags[0] ?? ''
    expect(tag).not.toMatch(/\{\s*\.\.\./)
    expect(tag).toContain('size="icon-lg"')
    expect(tag).toContain('className="rounded-full"')
    expect(tag).toContain("aria-label={t('newKarute')}")
    // ONLY these props — no variant override (the default IS the app's
    // primary-action token), no disabled, nothing smuggled. Same token scan
    // as expectPlain, one allowance wider.
    let rest = tag.replace(/^<Button\b/, '').replace(/\/?>$/, '')
    while (/\{[^{}]*\}/.test(rest)) rest = rest.replace(/\{[^{}]*\}/g, '')
    rest = rest.replace(/"[^"]*"/g, '')
    const allowed = ['type', 'size', 'className', 'aria-label', 'onClick']
    expect((rest.match(/[\w-]+/g) ?? []).filter((p) => !allowed.includes(p))).toEqual([])
    expect(src).toContain('<Plus className="size-[18px]" aria-hidden />')
    // …and it sits INSIDE the search row, after the field.
    expect(src).toMatch(
      /<div className="flex items-center gap-2 md:mt-4">\s*<label className="flex min-w-0 flex-1 [^"]*">[\s\S]*?<\/label>\s*<Button\b/,
    )
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

  it('header structure contract: one shared top offset, natural-height centered rows, no wrap, 16px rhythm, the mock’s 予約 seam', () => {
    // The (app) layout's py-4/md:py-6 is the shared top offset all
    // three list pages sit under — pinned as the single source.
    const layout = read('src/app/[locale]/(app)/layout.tsx')
    expect(layout).toContain('py-4 md:py-6')
    const kokyaku = read('src/components/customers/redesign/list/CustomersListHeader.tsx')
    rowWithStatus(kokyaku, 'flex items-center justify-between gap-3')
    const kokyakuView = read('src/components/customers/redesign/list/CustomersListView.tsx')
    expect(kokyakuView).toMatch(/flex-col gap-4/)
    const karute = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    // No per-page top offset at any width (Liam 8/7 desktop-unify ruling):
    // the header zone wrapper is a bare <div> directly before the md h1.
    expect(karute).toMatch(/<div>\s*<h1 className="hidden/)
    // 案C+ (⚖ Liam 9/26): the status row and the staff row are folded away,
    // so the search row is the first row under the shared offset on phones
    // (md:mt-4 spaces it from the desktop-only h1).
    expect(karute).not.toContain('<div className="mt-4">')
    expect(karute).not.toContain('<div className="pt-4">')
    expect(karute).toContain('<div className="flex items-center gap-2 md:mt-4">')
    const yoyaku = read('src/components/appointments/AppointmentsView.tsx')
    const headerTag = yoyaku.match(/<ReservationPageHeader[\s\S]*?className="([^"]*)"/)?.[1] ?? ''
    expect(headerTag).toContain('mb-0')
    expect(yoyaku).toMatch(/relative space-y-4/)
    // THE 予約 SEAM — 9px above the 日/週/月 row, 11px below it: the approved
    // calendar mock's own two numbers, measured at 393 on the production build
    // (Liam 9/15, fix round 6). SUPERSEDES the 8/7 24px (pt-6), which predates
    // that mock. Anchored to the element it protects exactly as before: mb-0
    // zeroes space-y-4's margin on the header (same property, higher
    // specificity), so the wrapper directly around the staff filter owns the
    // seam above, and its own mb-[11px] outranks space-y-4's :where() rule
    // below (decoy-proofed — verify-round exploit 8/7).
    expect(yoyaku).toMatch(/<div className="pt-\[9px\] mb-\[11px\]">\s*<ReservationStaffFilter\b/)
    const filter = read('src/components/karute/spike-lifted/reservation/ReservationStaffFilter.tsx')
    expect(filter).toContain('gap-x-2 gap-y-3')
  })
})
