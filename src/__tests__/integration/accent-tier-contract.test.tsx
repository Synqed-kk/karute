/**
 * @jest-environment jsdom
 *
 * One-way accent law contract (Liam ruling 2026-08-06, CLAUDE.md design law):
 * saturated accent is reserved for pressables. Pins the two sites the
 * accent-tier sweep re-tiered — the landing hero badge (decorative label:
 * wash stays, text goes neutral) and the ProcessingModal step spinner
 * (non-pressable status indicator) — and the nearest pressable in each file,
 * which must KEEP accent (the law is one-way, not anti-blue).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import LandingPage from '@/app/[locale]/page'
import { ProcessingModal } from '@/components/review/ProcessingModal'
import { ImportStepper } from '@/components/data-import/ImportStepper'
import { PageHeader } from '@/components/export/redesign/sections/PageHeader'
import { MenuFormDialog } from '@/components/settings/redesign/sections/menus/MenuFormDialog'
import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'
import type { Menu } from '@synqed-kk/client'
import type { CachedMenuOption } from '@/lib/menus/cached'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: async () => ({}),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key
    return t
  },
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: () => {} }),
}))
jest.mock('@/i18n/client-messages', () => ({
  PAGE_PICKS: { landing: [] },
  pickMessages: () => ({}),
}))
jest.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/layout/locale-toggle', () => ({ LocaleToggle: () => null }))
// Menus editor deps — the dialog never writes here, this suite only reads classes.
jest.mock('@/actions/menus', () => ({ createMenu: jest.fn(), updateMenu: jest.fn() }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
// 予約 dialog deps — server actions pull next/cache in, unloadable under jsdom.
jest.mock('@/actions/appointments', () => ({ createAppointment: jest.fn() }))
jest.mock('@/actions/customers', () => ({ createQuickCustomer: jest.fn() }))

// Whole-class matcher: 'bg-primary' must not silently pass via
// 'bg-primary/8' or 'hover:bg-primary-hover'.
const cls = (name: string) => new RegExp(`(^|\\s)${name.replace('/', '\\/')}(\\s|$)`)

describe('landing hero badge (decoration)', () => {
  it('badge text is neutral, wash stays, CTA keeps solid accent', async () => {
    render(
      await LandingPage({ params: Promise.resolve({ locale: 'ja' }) }),
    )

    const badge = screen.getByText('hero.badge')
    expect(badge.className).toMatch(cls('bg-primary/8'))
    expect(badge.className).toMatch(cls('text-foreground'))
    expect(badge.className).not.toMatch(cls('text-primary'))

    // One-way: the pressable signup CTA keeps the solid accent fill.
    const cta = screen.getByText('hero.ctaPrimary')
    expect(cta.className).toMatch(cls('bg-primary'))
  })
})

describe('phase 2 — literal blues (non-pressable decoration)', () => {
  it('import stepper current step is wash+border, never solid blue-600', () => {
    const { container } = render(<ImportStepper activeStep={1} />)
    expect(container.querySelector('[class*="bg-blue-600"]')).toBeNull()
    const chips = container.querySelectorAll('.size-7')
    const active = chips[1]?.className ?? ''
    expect(active).toMatch(cls('bg-blue-100'))
    expect(active).toMatch(cls('border-blue-300'))
    expect(chips[0]?.className ?? '').toMatch(cls('bg-blue-50'))
  })

  it('export page eyebrow and heading icon are muted, never accent blue', () => {
    const { container } = render(<PageHeader />)
    const eyebrow = screen.getByText('eyebrow')
    expect(eyebrow.className).toMatch(cls('text-muted-foreground'))
    expect(eyebrow.className).not.toMatch(cls('text-blue-500'))
    const icon = container.querySelector('h1 svg')
    const iconClass = icon?.getAttribute('class') ?? ''
    expect(iconClass).toMatch(cls('text-muted-foreground'))
    expect(iconClass).not.toMatch(cls('text-blue-500'))
  })
})

describe('ProcessingModal step spinner (status indicator)', () => {
  it('spinner is neutral like its sibling labels', () => {
    const { container } = render(
      <ProcessingModal currentStep="transcribing" onRetry={() => {}} />,
    )
    const spinner = container.querySelector('svg.animate-spin')
    expect(spinner).not.toBeNull()
    const spinnerClass = spinner?.getAttribute('class') ?? ''
    expect(spinnerClass).toMatch(cls('text-foreground'))
    expect(spinnerClass).not.toMatch(cls('text-primary'))
  })

  it('retry commit button keeps solid accent', () => {
    render(<ProcessingModal currentStep="transcribing" error="x" onRetry={() => {}} />)
    expect(screen.getByText('retry').className).toMatch(cls('bg-primary'))
  })
})

// menu-catalog PR-3. The signed mock names the treatment for THIS state
// (p4-mocks/settings-mocks.html:51-52 — "pristine-save (PR-3): inert gray —
// never an accent wash, never a dark fill", #e5e7eb / #9ca3af). The shared
// Button renders disabled as the accent at 50% opacity, and no automated gate
// sees disabled states (check-dark-interactive greps fills, not :disabled), so
// the adjudicated treatment is pinned here.
describe('menus editor — pristine 保存 (inert gray)', () => {
  const menu: Menu = {
    id: '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7',
    business_id: '6f1d0b26-3f5e-4a1e-9c62-8b0a4f21d7c3',
    store_id: null,
    name: 'リタッチカラー',
    description: null,
    category: 'カラー',
    category_display_order: 0,
    display_order: 30,
    duration_minutes: 90,
    price_list_amount: 8800,
    price_min_amount: 6600,
    currency: 'JPY',
    tax_included: true,
    required_room_class: null,
    required_qualification_id: null,
    nomination_allowed: true,
    online_visible: true,
    active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }

  it('a pristine 保存 is gray at full opacity, never a faded accent fill', () => {
    render(
      <MenuFormDialog
        mode={{ kind: 'edit', menu }}
        catalog={[menu]}
        stores={[]}
        onClose={() => {}}
        canViewAllStores
      />,
    )

    // Untouched EDIT form → the button is genuinely in the pinned state.
    const save = screen.getByRole('button', { name: 'save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(save.className).toMatch(cls('disabled:bg-gray-200'))
    expect(save.className).toMatch(cls('disabled:text-gray-400'))
    expect(save.className).toMatch(cls('disabled:opacity-100'))
  })
})

// menu-catalog PR-4b. Three new accent sites arrived with the booking picker;
// all three are legal (a soft wash chip and two pressables), so what needs
// locking is the adjudication itself — that the chip stays wash-tier and the
// two pressables keep their accent, per the one-way law.
describe('予約 menu picker — accent tier', () => {
  const RETOUCH: CachedMenuOption = {
    id: '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7',
    name: 'リタッチカラー',
    category: 'カラー',
    category_display_order: 0,
    display_order: 0,
    duration_minutes: 90,
    price_list_amount: 8800,
    price_min_amount: 6600,
    store_id: null,
    storeName: null,
  }

  it('chip wash stays wash-tier; the × and the standard-duration link keep accent', () => {
    render(
      <NewBookingDialog
        open
        onOpenChange={() => {}}
        customers={[]}
        staff={[]}
        menus={[RETOUCH]}
      />,
    )
    const input = screen.getByPlaceholderText('newBookingDialog.servicePlaceholder')
    fireEvent.click(input)
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getAllByRole('option')[0])

    // 1. The × — a pressable, so accent text is exactly right.
    const unlink = screen.getByRole('button', { name: 'newBookingDialog.menuUnlink' })
    expect(unlink.className).toMatch(cls('text-primary'))

    // 2. Its chip — a non-pressable label, so it may carry the /8 wash and the
    //    accent text that rides it, but never a solid bg-primary fill.
    const chip = unlink.parentElement!
    expect(chip.className).toMatch(cls('bg-primary/8'))
    expect(chip.className).toMatch(cls('text-primary'))
    expect(chip.className).not.toMatch(cls('bg-primary'))

    // 3. The メニュー標準 hint — a button styled as a link.
    const standard = screen.getByRole('button', {
      name: 'newBookingDialog.menuStandard',
    })
    expect(standard.className).toMatch(cls('text-primary'))
  })
})

// PR-B1 fix round 1, T-8 — the recovery banner's 変更 link and the repoint
// picker's pinned row. Both are PRESSABLE, so accent is exactly right on them;
// what the law forbids here is the pinned row's SELECTED state becoming a solid
// fill instead of the /8 wash (R13), and the 変更 link going neutral (it is a
// real action, not a label).
describe('recovery banner + repoint picker (PR-B1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecoveryBanner } = require('@/components/karute/redesign/record/RecoveryBanner') as
    typeof import('@/components/karute/redesign/record/RecoveryBanner')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecordCustomerPickerDialog } = require(
    '@/components/karute/redesign/record/RecordCustomerPickerDialog',
  ) as typeof import('@/components/karute/redesign/record/RecordCustomerPickerDialog')

  it('変更 keeps accent (a pressable), 保存する keeps the solid commit fill', () => {
    render(
      <RecoveryBanner
        bound
        customerName="佐藤 美咲"
        recordedAt="8月18日(月) 14:22"
        dayLabel="8月18日(月)"
        lengthLabel="23分"
        recordedBy="原"
        ticketState="none"
        onRepoint={() => {}}
        onSave={() => {}}
      />,
    )
    expect(screen.getByText('recoverRepoint').className).toMatch(cls('text-primary'))
    const save = screen.getByText('recoverSaveAction').closest('button')!
    expect(save.className).toMatch(cls('bg-primary'))
    expect(save.className).toMatch(cls('hover:bg-primary-hover'))
    // Never an opacity hover on the fill (drops white text below AA).
    expect(save.className).not.toMatch(cls('hover:bg-primary/90'))
  })

  it('the pinned row marks 現在の保存先 with the /8 wash, never a solid fill', () => {
    render(
      <RecordCustomerPickerDialog
        variant="repoint"
        customers={[]}
        bookings={[]}
        pinned={{ customerId: 'c1', name: '佐藤 美咲', karuteNumber: '#00058' }}
        pinnedIsCurrent
        dayLabel="8月18日(月)"
        cancelLabel="cancel"
        onSelectBooking={() => {}}
        onSelectCustomer={() => {}}
        onClose={() => {}}
      />,
    )
    const row = screen.getByText('target.repointCurrent').closest('button')!
    expect(row.className).toMatch(cls('bg-primary/8'))
    expect(row.className).not.toMatch(cls('bg-primary'))
  })

  it('a pinned row that is NOT current carries no wash and no badge', () => {
    render(
      <RecordCustomerPickerDialog
        variant="repoint"
        customers={[]}
        bookings={[]}
        pinned={{ customerId: 'c1', name: '佐藤 美咲' }}
        pinnedIsCurrent={false}
        dayLabel="8月18日(月)"
        cancelLabel="cancel"
        onSelectBooking={() => {}}
        onSelectCustomer={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText('target.repointCurrent')).toBeNull()
    const row = screen.getByText('佐藤 美咲').closest('button')!
    expect(row.className).not.toMatch(cls('bg-primary/8'))
  })
})


// Build F1 — 録音履歴 rows. Three accent tiers live in one card, and the law is
// what keeps them apart: the state CHIPS are non-pressable status (wash + dark
// text, never a solid fill), 確認する is the R13 selected-state recipe, and only
// 保存する — the commit — carries the solid accent.
describe('録音履歴 inbox rows (Build F1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecordingsInboxCard } = require(
    '@/components/karute/redesign/record/RecordingsInboxCard',
  ) as typeof import('@/components/karute/redesign/record/RecordingsInboxCard')

  type Row = Parameters<typeof RecordingsInboxCard>[0]['rows'][number]
  const baseRow: Row = {
    key: 'session:s1',
    state: 'recoverable',
    reason: 'localAudio',
    recordingSessionId: 's1',
    takeId: 't1',
    karuteRecordId: null,
    customerId: 'c1',
    customerName: '佐藤 美咲',
    startedAt: Date.parse('2026-08-25T01:00:00.000Z'),
    durationSeconds: 540,
    canRetry: false,
  }

  function renderRows(rows: Row[]) {
    return render(
      <RecordingsInboxCard
        rows={rows}
        needsAttention={rows.length}
        serverFailed={false}
        now={Date.parse('2026-08-25T04:00:00.000Z')}
        locale="ja"
        customerNameById={new Map()}
        onOpenRecord={() => {}}
        onSaveTake={() => {}}
      />,
    )
  }

  it('保存する is the ONLY solid accent fill, with the darkening hover', () => {
    renderRows([baseRow])
    const save = screen.getByText('action.save').closest('button')!
    expect(save.className).toMatch(cls('bg-primary'))
    expect(save.className).toMatch(cls('hover:bg-primary-hover'))
    expect(save.className).not.toMatch(cls('hover:bg-primary/90'))
  })

  it('確認する uses the R13 wash recipe, never a solid fill', () => {
    renderRows([
      { ...baseRow, state: 'awaiting-check', reason: 'autoSaved', karuteRecordId: 'rec-1' },
    ])
    const check = screen.getByText('action.check').closest('button')!
    expect(check.className).toMatch(cls('bg-primary/8'))
    expect(check.className).toMatch(cls('text-primary'))
    expect(check.className).toMatch(cls('border-primary'))
    expect(check.className).not.toMatch(cls('bg-primary'))
  })

  it('開く / 再試行 stay quiet links — accent text, no fill', () => {
    renderRows([
      { ...baseRow, key: 'a', state: 'saved', reason: null, karuteRecordId: 'rec-1' },
      { ...baseRow, key: 'b', state: 'failed', reason: 'genericFailure', canRetry: true },
    ])
    for (const label of ['action.open', 'action.retry']) {
      const link = screen.getByText(label).closest('button')!
      expect(link.className).toMatch(cls('text-primary'))
      expect(link.className).not.toMatch(cls('bg-primary'))
    }
  })

  it('every state CHIP is a wash — no chip ever carries a solid accent fill', () => {
    const states: Array<Row['state']> = [
      'saved',
      'awaiting-check',
      'processing',
      'failed',
      'recoverable',
    ]
    renderRows(states.map((state, i) => ({ ...baseRow, key: `k${i}`, state, karuteRecordId: 'rec-1' })))
    for (const state of states) {
      const chip = screen.getByText(`state.${state === 'awaiting-check' ? 'awaitingCheck' : state}`)
      expect(chip.className).not.toMatch(cls('bg-primary'))
      expect(chip.className).toMatch(/bg-(green|amber|blue|red)-50/)
    }
  })
})
