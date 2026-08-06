/**
 * Create-CTA unification contract (Liam ruling 2026-08-06, 案A):
 * the three list-page create CTAs — 顧客「+ 新規顧客」, カルテ「+ 新規カルテ」,
 * 予約「+ 新規予約」— all render the shared <Button> DEFAULT recipe
 * (h-8 pill, no className override, no pictogram icon). The 予約 one
 * must stay a `newBookingSlot` override: the @synqed-kk/ui package
 * default is an icon-only square on mobile, which the ruling killed.
 *
 * Source-pin (not render) contract: both views need heavy data/provider
 * scaffolding to mount, and what the ruling fixes is the authored recipe
 * itself — a className override or a dropped slot IS the regression.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('create-CTA unification (案A 2026-08-06)', () => {
  it('カルテ list CTA is a plain shared Button, no override, no icon', () => {
    const src = read('src/components/karute/spike-lifted/list/KaruteRecordListView.tsx')
    const cta = src.match(/<Button[^>]*onClick=\{\(\) => setNewKaruteOpen\(true\)\}[^>]*>/)?.[0]
    expect(cta).toBeDefined()
    expect(cta).not.toMatch(/className/)
    expect(src).not.toMatch(/FilePlus2/)
  })

  it('予約 header CTA overrides the package icon-square via newBookingSlot with a plain Button', () => {
    const src = read('src/components/appointments/AppointmentsView.tsx')
    const slot = src.match(/newBookingSlot=\{[\s\S]*?<\/Button>/)?.[0]
    expect(slot).toBeDefined()
    expect(slot).toContain("tReservation('new')")
    expect(slot).not.toMatch(/className/)
  })

  it('顧客 baseline CTA stays a plain shared Button', () => {
    const src = read('src/components/customers/CustomerSheet.tsx')
    const trigger = src.match(/<Button[^>]*>\s*\{t\('newCustomer'\)\}/)?.[0]
    expect(trigger).toBeDefined()
    expect(trigger).not.toMatch(/className/)
  })

  it('the「+ ラベル」wording is baked into all three labels, both locales', () => {
    const ja = JSON.parse(read('messages/ja.json'))
    expect(ja.customers.newCustomer).toBe('+ 新規顧客')
    expect(ja.karute.recordList.newKarute).toBe('+ 新規カルテ')
    expect(ja.reservation.new).toBe('+ 新規予約')
    const en = JSON.parse(read('messages/en.json'))
    expect(en.customers.newCustomer).toBe('+ New Customer')
    expect(en.karute.recordList.newKarute).toBe('+ New karute')
    expect(en.reservation.new).toBe('+ New booking')
  })
})
