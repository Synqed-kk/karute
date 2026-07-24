/** @jest-environment jsdom */
// SyncStatusCard (Liam ruling 7/24, packet 31): read-only 予約同期 status —
// health derives from lastRunStatus/lastRunAt against an injected `nowMs`
// (no fake-timer flakiness), pins the real ja copy (same real-message-
// resolving next-intl mock idiom as thin-settings-sync-webonly-mount.test.tsx
// — a call-site key typo fails HERE, not just the identity-echo mock tests),
// and pins that NOTHING inside the card is interactive (no controls, no
// credential paths — v2 is read-only by design).
import { act, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const messages = jest.requireActual('../../../messages/ja.json')
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      messages,
    )
  return {
    useTranslations: (ns?: string) => (key: string) => {
      const path = ns ? `${ns}.${key}` : key
      const value = resolve(path)
      if (typeof value !== 'string') throw new Error(`missing ja message for key: ${path}`)
      return value
    },
  }
})

import { SyncStatusCard } from '@/components/settings/redesign/sections/SyncStatusCard'
import type { SyncStatusDTO } from '@/lib/app-api/settings-screen-dto'

const NOW = new Date('2026-07-24T12:00:00.000Z').getTime()
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

const HEALTHY = '正常に同期中'
const DELAYED = '同期が遅れています'
const STOPPED = '同期が停止しています'
const FOOTER = '同期設定の変更・再ログインは Web 版の設定から行えます。'

function status(overrides: Partial<SyncStatusDTO>): SyncStatusDTO {
  return {
    enabled: true,
    lastRunAt: minutesAgo(5),
    lastRunStatus: 'OK',
    lastRunError: null,
    ...overrides,
  }
}

describe('SyncStatusCard — live clock (Greptile #599: mount-time snapshot froze health)', () => {
  it('a card left open re-judges health as thresholds pass — green at mount, yellow after the tick crosses 30 min', () => {
    jest.useFakeTimers()
    try {
      jest.setSystemTime(NOW)
      // No nowMs injected — the production ticking clock is the unit under test.
      render(<SyncStatusCard status={status({ lastRunAt: minutesAgo(29) })} />)
      expect(screen.getByText(HEALTHY)).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(2 * 60_000)
      })
      expect(screen.getByText(DELAYED)).toBeInTheDocument()
      expect(screen.queryByText(HEALTHY)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('SyncStatusCard — RUNNING is a crawl in flight, not a failure (Fable audit fix)', () => {
  it('RUNNING + fresh timestamp → GREEN + 実行中, never 停止/失敗 (anti-false-alarm pin: the crawler writes RUNNING every cycle)', () => {
    render(
      <SyncStatusCard
        status={status({ lastRunAt: minutesAgo(5), lastRunStatus: 'RUNNING' })}
        nowMs={NOW}
      />,
    )
    expect(screen.getByText(HEALTHY)).toBeInTheDocument()
    expect(screen.getByText('実行中')).toBeInTheDocument()
    expect(screen.queryByText(STOPPED)).toBeNull()
    expect(screen.queryByText('失敗')).toBeNull()
  })

  it('RUNNING + aged timestamp (90 min — crawler died mid-run) → RED via time', () => {
    render(
      <SyncStatusCard
        status={status({ lastRunAt: minutesAgo(90), lastRunStatus: 'RUNNING' })}
        nowMs={NOW}
      />,
    )
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
  })
})

describe('SyncStatusCard — health states (packet 31)', () => {
  it('< 30 min since a successful run → GREEN 正常に同期中', () => {
    render(<SyncStatusCard status={status({ lastRunAt: minutesAgo(5) })} nowMs={NOW} />)
    expect(screen.getByText(HEALTHY)).toBeInTheDocument()
    expect(screen.queryByText(DELAYED)).toBeNull()
    expect(screen.queryByText(STOPPED)).toBeNull()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('分前に同期')).toBeInTheDocument()
  })

  it('30–60 min since a successful run → YELLOW 同期が遅れています', () => {
    render(<SyncStatusCard status={status({ lastRunAt: minutesAgo(45) })} nowMs={NOW} />)
    expect(screen.getByText(DELAYED)).toBeInTheDocument()
    expect(screen.queryByText(HEALTHY)).toBeNull()
    expect(screen.queryByText(STOPPED)).toBeNull()
  })

  it('> 60 min since a successful run → RED 同期が停止しています, big number switches to hours', () => {
    render(<SyncStatusCard status={status({ lastRunAt: minutesAgo(90) })} nowMs={NOW} />)
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('時間前に同期')).toBeInTheDocument()
  })

  it('no lastRunAt at all → RED 同期が停止しています, no big-number row', () => {
    render(<SyncStatusCard status={status({ lastRunAt: null, lastRunStatus: null })} nowMs={NOW} />)
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
    expect(screen.queryByText('分前に同期')).toBeNull()
    expect(screen.queryByText('時間前に同期')).toBeNull()
  })

  it('a failure status beats a fresh timestamp — RED even 5 minutes after the run', () => {
    render(
      <SyncStatusCard
        status={status({ lastRunAt: minutesAgo(5), lastRunStatus: 'ERROR' })}
        nowMs={NOW}
      />,
    )
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
    expect(screen.queryByText(HEALTHY)).toBeNull()
  })
})

describe('SyncStatusCard — rows + footer (packet 31)', () => {
  it('renders the error text when lastRunError is set', () => {
    render(
      <SyncStatusCard
        status={status({ lastRunStatus: 'ERROR', lastRunError: 'ログイン切れ' })}
        nowMs={NOW}
      />,
    )
    expect(screen.getByText('ログイン切れ')).toBeInTheDocument()
    expect(screen.getByText('失敗')).toBeInTheDocument()
  })

  it('no error text when lastRunError is null', () => {
    render(<SyncStatusCard status={status({ lastRunError: null })} nowMs={NOW} />)
    expect(screen.queryByText('ログイン切れ')).toBeNull()
    expect(screen.getByText('成功')).toBeInTheDocument()
  })

  it('renders the exact footer copy + 接続先/自動同期 rows', () => {
    render(<SyncStatusCard status={status({ enabled: false })} nowMs={NOW} />)
    expect(screen.getByText(FOOTER)).toBeInTheDocument()
    expect(screen.getByText('接続先')).toBeInTheDocument()
    expect(screen.getByText('Quick Reserve')).toBeInTheDocument()
    expect(screen.getByText('自動同期')).toBeInTheDocument()
    expect(screen.getByText('無効')).toBeInTheDocument()
  })
})

describe('SyncStatusCard — read-only pin (packet 31)', () => {
  it('renders nothing interactive — no button/input/link/select/textarea', () => {
    const { container } = render(<SyncStatusCard status={status({})} nowMs={NOW} />)
    expect(container.querySelectorAll('button, input, a, select, textarea')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })
})
