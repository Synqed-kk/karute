/** @jest-environment jsdom */
/**
 * KaruteRecordListView's status-line rendering contract (Greptile PR #775
 * round 2): the LIST is primary, the count is auxiliary — a failed count
 * must never render as a fake number.
 *   - total !== null, monthCount !== null → the full statusLine key.
 *   - total !== null, monthCount === null → statusLineNoMonth (今月 probe
 *     failed alone; never render a fake 「今月 0件」).
 *   - total === null → NO status line at all (the main read itself failed;
 *     the empty/degraded list below already tells the honest story).
 *
 * next-intl is mocked to return the bare KEY, not the interpolated copy —
 * these pin WHICH key fires, never the exact wording (that's
 * karute-statusline-copy.test.ts's job).
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
// Heavy dialog, irrelevant to the status line — same narrow-stub convention
// management-flag-wiring.test.tsx already uses for this exact component.
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
// KaruteRecordListView imports revealNoKaruteCustomer directly — the real
// 'use server' module pulls in next/cache's unstable_cache, which needs a
// DOM API (TextEncoder) this jsdom suite doesn't polyfill.
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
}))

import { render, screen } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

describe('KaruteRecordListView status line (Greptile PR #775 round 2)', () => {
  it('data OK + probe OK: renders the full statusLine key, never statusLineNoMonth', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        total={312}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.getByText('statusLine')).toBeInTheDocument()
    expect(screen.queryByText('statusLineNoMonth')).not.toBeInTheDocument()
  })

  it('data OK + probe null: omits 今月 — renders statusLineNoMonth, never statusLine', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={null}
        total={312}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.getByText('statusLineNoMonth')).toBeInTheDocument()
    expect(screen.queryByText('statusLine')).not.toBeInTheDocument()
  })

  it('data null (main read failed): renders NO status line at all, regardless of monthCount', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        total={null}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.queryByText('statusLine')).not.toBeInTheDocument()
    expect(screen.queryByText('statusLineNoMonth')).not.toBeInTheDocument()
  })

  it('total omitted (prop default) behaves the same as data null — no status line', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={26}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    expect(screen.queryByText('statusLine')).not.toBeInTheDocument()
    expect(screen.queryByText('statusLineNoMonth')).not.toBeInTheDocument()
  })
})
