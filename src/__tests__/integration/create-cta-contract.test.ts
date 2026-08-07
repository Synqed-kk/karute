/**
 * Create-CTA unification contract (Liam ruling 2026-08-06, 案A):
 * the three list-page create CTAs — 顧客「+ 新規顧客」, カルテ「+ 新規カルテ」,
 * 予約「+ 新規予約」— all render the SHARED <Button> (@/components/ui/button)
 * with its default recipe: no className, no size/variant props, no pictogram,
 * 「+ ラベル」wording in both locales. The 予約 one must stay a
 * `newBookingSlot` override: the @synqed-kk/ui package default is an
 * icon-only square on mobile, which the ruling killed.
 *
 * Source-pin (not render) contract: both views need heavy data/provider
 * scaffolding to mount, and what the ruling fixes is the authored recipe
 * itself. Structure is pinned, names are not — renaming handlers/state is
 * fine; adding props to a CTA Button or swapping its import source is not.
 * (Cannot catch cascade/layout issues — that is the visual pass's job.)
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const SHARED_IMPORT = "import { Button } from '@/components/ui/button'"

/** All <Button ...> opening tags in a source string. */
const buttonTags = (src: string) => src.match(/<Button\b[^>]*>/g) ?? []

/** A plain CTA Button may carry ONLY type/onClick — anything else
 *  (className, size, variant, ...) changes pixels and breaks 案A. */
const expectPlain = (tag: string | undefined) => {
  expect(tag).toBeDefined()
  const props = [...(tag as string).matchAll(/(\w+)=/g)].map((m) => m[1])
  expect(props.filter((p) => p !== 'type' && p !== 'onClick')).toEqual([])
}

describe('create-CTA unification (案A 2026-08-06)', () => {
  it('カルテ list CTA is the shared Button, plain, no icon', () => {
    const src = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    const tags = buttonTags(src)
    expect(tags).toHaveLength(1)
    expectPlain(tags[0])
    expect(src).not.toMatch(/FilePlus2/)
  })

  it('予約 header CTA overrides the package icon-square via newBookingSlot with the plain shared Button', () => {
    const src = read('src/components/appointments/AppointmentsView.tsx')
    expect(src).toContain(SHARED_IMPORT)
    // Bounded: the slot value must BE a single <Button>…</Button> — the
    // closing brace right after </Button> stops the match from walking
    // to some later Button in the file.
    const slot = src.match(/newBookingSlot=\{\s*<Button\b[^>]*>[\s\S]*?<\/Button>\s*\}/)?.[0]
    expect(slot).toBeDefined()
    expect(slot).toContain("tReservation('new')")
    expectPlain(buttonTags(slot as string)[0])
    // The slot's Button must be the only one in the file — a second
    // Button is a new CTA that needs its own adjudication here.
    expect(buttonTags(src)).toHaveLength(1)
  })

  it('顧客 baseline CTA stays the plain shared Button', () => {
    const src = read('src/components/customers/CustomerSheet.tsx')
    expect(src).toContain(SHARED_IMPORT)
    const trigger = src.match(/<Button\b[^>]*>\s*\{t\('newCustomer'\)\}/)?.[0]
    expect(trigger).toBeDefined()
    expectPlain(trigger?.match(/<Button\b[^>]*>/)?.[0])
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
})
