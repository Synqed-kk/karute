/**
 * Create-CTA unification contract (Liam rulings 2026-08-06 案A +
 * 2026-08-07 responsive form, superseded for the shape by ⚖ 案C+ 9/26 on
 * カルテ and ⚖ S44 9/27 on 顧客 (02:1x) and 予約 (02:5x)): the three list-page
 * create CTAs — 顧客/カルテ/予約 — all render the SHARED <Button>
 * (@/components/ui/button) as ONE circle family (size icon-lg, rounded-full,
 * default primary), a recognizable per-page icon (UserPlus / FilePlus2 /
 * CalendarPlus — never a bare plus glyph), and the「+ ラベル」key as the
 * accessible name. The 予約 one must stay a `newBookingSlot` override: the
 * @synqed-kk/ui package default is an accent square, not the app's circle.
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

/** ⚖ S44 (Liam 9/27, 顧客 02:1x · 予約 02:5x): ALL THREE create CTAs are now
 *  the カルテ circle's family — the SHARED Button, size="icon-lg" (36px, one
 *  control scale), className="rounded-full", the default primary variant,
 *  the page's own icon at 18px, and the 「+ ラベル」 key as its accessible
 *  name. ONLY these props: no variant override, nothing smuggled. */
const expectCircle = (tag: string | undefined, labelExpr: string) => {
  expect(tag).toBeDefined()
  expect(tag).not.toMatch(/\{\s*\.\.\./)
  expect(tag).toContain('size="icon-lg"')
  expect(tag).toContain('className="rounded-full"')
  expect(tag).toContain(`aria-label={${labelExpr}}`)
  let rest = (tag as string).replace(/^<Button\b/, '').replace(/\/?>$/, '')
  while (/\{[^{}]*\}/.test(rest)) rest = rest.replace(/\{[^{}]*\}/g, '')
  rest = rest.replace(/"[^"]*"/g, '')
  const allowed = ['type', 'size', 'className', 'aria-label', 'onClick']
  expect((rest.match(/[\w-]+/g) ?? []).filter((p) => !allowed.includes(p))).toEqual([])
}

describe('create-CTA unification (案A 8/6 + responsive 8/7)', () => {
  // ⚖ Liam 9/26 「案C+ Looks good.」 supersedes the 8/6–8/7 recipe for the
  // カルテ list ONLY: the create action is a solid primary circle (＋) at the
  // end of the search row, the search field's own 36px — the header cannot
  // hold a third item beside its centred title (mock D32). Still the SHARED
  // Button with its default (primary) variant; the accessible name is the
  // same 「+ 新規カルテ」 key the words used to show. The 8/6 icon rule
  // stands: the circle carries FilePlus2, never a bare plus glyph.
  it('カルテ list CTA (案C+): shared Button, primary FilePlus2 circle at the end of the search row', () => {
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
    expect(src).toContain('<FilePlus2 className="size-[18px]" aria-hidden />')
    // Never a bare plus glyph (8/6 案A) — no lucide Plus import at all.
    expect(src).not.toMatch(/import \{[^}]*\bPlus\b[^}]*\} from 'lucide-react'/)
    // …and it sits INSIDE the search row, after the field.
    expect(src).toMatch(
      /<div className="flex items-center gap-2 md:mt-4">\s*<label className="flex min-w-0 flex-1 [^"]*">[\s\S]*?<\/label>\s*<Button\b/,
    )
  })

  it('予約 header CTA (⚖ 02:5x): still the newBookingSlot override — now the blue CalendarPlus circle', () => {
    const src = read('src/components/appointments/AppointmentsView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    // Bounded: the slot value must BE a single <Button>…</Button>.
    const slot = src.match(/newBookingSlot=\{\s*<Button\b[\s\S]*?<\/Button>\s*\}/)?.[0]
    expect(slot).toBeDefined()
    expectCircle(buttonTags(slot as string)[0], "tReservation('new')")
    expect(slot).toContain('<CalendarPlus className="size-[18px]" aria-hidden />')
    // The words are gone from the slot (the circle is the whole CTA).
    expect(slot).not.toContain(RESPONSIVE_LABEL)
    expect(buttonTags(src)).toHaveLength(1)
  })

  it('顧客 CTA (⚖ 02:1x): shared Button, the blue UserPlus circle', () => {
    const src = read('src/components/customers/CustomerSheet.tsx')
    expect(src).toContain(SHARED_IMPORT)
    expect(buttonTags(src)).toHaveLength(1)
    expectCircle(buttonTags(src)[0], "t('newCustomer')")
    expect(src).toContain('<UserPlus className="size-[18px]" aria-hidden />')
    expect(src).not.toContain(RESPONSIVE_LABEL)
    // …and it sits at the END of the search row, after the field.
    const view = read('src/components/customers/redesign/list/CustomersListView.tsx')
    expect(view).toMatch(
      /<div className="flex items-center gap-2 md:mt-4">\s*<div className="min-w-0 flex-1">\s*<CustomerSearchInput\b[^>]*\/>\s*<\/div>\s*<CustomerSheet\b/,
    )
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

  it('header structure contract: one shared top offset, natural-height centered rows, no wrap, ONE spacing scale (⚖ S44)', () => {
    // The (app) layout's py-4/md:py-6 is the shared top offset all
    // three list pages sit under — pinned as the single source.
    const layout = read('src/app/[locale]/(app)/layout.tsx')
    expect(layout).toContain('py-4 md:py-6')
    // ⚖ 顧客 TAB LOCKED 02:1x: no status line under the desktop bar any more.
    const kokyaku = read('src/components/customers/redesign/list/CustomersListHeader.tsx')
    expect(kokyaku).not.toContain('statusLine')
    expect(kokyaku).not.toContain('CustomerSheet')
    // ⚖ SPACING 03:1x — the カルテ scale on 顧客: search → next row pt-3,
    // header rows gap-2, header → list mt-4 (was gap-4 between every row).
    const kokyakuView = read('src/components/customers/redesign/list/CustomersListView.tsx')
    expect(kokyakuView).not.toMatch(/flex-col gap-4 px-4/)
    expect(kokyakuView).toMatch(/<div className="flex flex-col gap-2 pt-3">\s*\{\/\*[\s\S]*?\*\/\}\s*<CustomersStaffFilter\b/)
    expect(kokyakuView).toContain('<div className="mt-4 flex flex-col gap-4">')
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
    // ⚖ SPACING 03:1x — the scale's source: pt-3 after search, gap-2 rows.
    expect(karute).toContain('<div className="flex flex-col gap-2 pt-3">')
    const yoyaku = read('src/components/appointments/AppointmentsView.tsx')
    const headerTag = yoyaku.match(/<ReservationPageHeader[\s\S]*?className="([^"]*)"/)?.[1] ?? ''
    expect(headerTag).toContain('mb-0')
    expect(yoyaku).toMatch(/relative space-y-4/)
    // THE 予約 SEAM — ⚖ SPACING 03:1x (S44) supersedes the 9/15 mock seam
    // (9px above the 日/週/月 row, 11px below): ONE scale on all three tabs —
    // 12px after the first row (pt-3), 8px between header rows (mb-2), 16px
    // header → list (the numbers line's own mb-4). Anchored to the element it
    // protects exactly as before: mb-0 zeroes space-y-4's margin on the
    // header, so the wrapper directly around the staff filter owns the seam
    // above, and its own mb-2 outranks space-y-4's :where() rule below
    // (decoy-proofed — verify-round exploit 8/7).
    expect(yoyaku).toMatch(/\{\/\*[^]*?\*\/\}\s*<div className="pt-3 mb-2">\s*<ReservationStaffFilter\b/)
    expect(yoyaku.match(/className="mb-4"/g)).toHaveLength(2)
    // The staff row: one row in ja at every width; English below 430 puts the
    // control on its own row under 日/週/月 — a defined width step, 8px apart.
    const filter = read('src/components/karute/spike-lifted/reservation/ReservationStaffFilter.tsx')
    expect(filter).toContain("'flex-col items-start min-[430px]:flex-row min-[430px]:items-center'")
    expect(filter).toContain("'flex-row flex-nowrap items-center'")
    expect(filter).not.toContain('flex-wrap items-center')
  })
})
