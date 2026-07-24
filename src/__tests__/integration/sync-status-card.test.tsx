/** @jest-environment jsdom */
// SyncStatusCard (Liam ruling 7/24, packet 31): read-only 予約同期 status —
// health derives from lastRunStatus/lastRunAt against an injected `nowMs`
// (no fake-timer flakiness), pins the real ja copy (same real-message-
// resolving next-intl mock idiom as thin-settings-sync-webonly-mount.test.tsx
// — a call-site key typo fails HERE, not just the identity-echo mock tests),
// and pins that NOTHING inside the card is interactive (no controls, no
// credential paths — v2 is read-only by design).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

describe('SyncStatusCard — onRunNow ABSENT (packet 31 read-only branch, still web parity post-packet-32)', () => {
  it('renders nothing interactive — no button/input/link/select/textarea', () => {
    const { container } = render(<SyncStatusCard status={status({})} nowMs={NOW} />)
    expect(container.querySelectorAll('button, input, a, select, textarea')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })
})

describe('SyncStatusCard — 今すぐ同期 (packet 32, onRunNow PRESENT)', () => {
  it('a REJECTING onRunNow (contract violation) still re-enables the button + shows the failure line — never stuck at 同期中…', async () => {
    const onRunNow = jest.fn(async () => {
      throw new Error('boom')
    })
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
    expect(screen.getByText('同期に失敗しました')).toBeInTheDocument()
  })

  it('renders exactly ONE button when onRunNow is provided', () => {
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={async () => ({ ok: true })} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '今すぐ同期' })).toBeInTheDocument()
  })

  it('tap calls onRunNow exactly once and disables the button while pending', async () => {
    let resolveRun: (v: { ok: boolean; message?: string }) => void = () => {}
    const onRunNow = jest.fn(
      () => new Promise<{ ok: boolean; message?: string }>((res) => (resolveRun = res)),
    )
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    const button = screen.getByRole('button', { name: '今すぐ同期' })

    await act(async () => {
      fireEvent.click(button)
    })
    expect(onRunNow).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '同期中…' })).toBeDisabled()

    await act(async () => {
      resolveRun({ ok: true })
    })
    expect(screen.getByRole('button', { name: '今すぐ同期' })).not.toBeDisabled()

    // A second tap after settling still fires exactly one more call — no
    // double-submit residue from the first round.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    })
    expect(onRunNow).toHaveBeenCalledTimes(2)
  })

  it('a click while already pending does not re-invoke onRunNow (debounce-by-disabled)', async () => {
    let resolveRun: (v: { ok: boolean }) => void = () => {}
    const onRunNow = jest.fn(() => new Promise<{ ok: boolean }>((res) => (resolveRun = res)))
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    const button = screen.getByRole('button', { name: '今すぐ同期' })
    await act(async () => {
      fireEvent.click(button)
    })
    // The DOM button is now disabled; a stray click event handler call must
    // still be a no-op even if fired directly (handleRunNow's own pending guard).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '同期中…' }))
    })
    expect(onRunNow).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveRun({ ok: true })
    })
  })

  it('failure renders the message as small red error text', async () => {
    const onRunNow = jest.fn(async () => ({ ok: false, message: 'ログイン切れ' }))
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    })
    const msg = screen.getByText('ログイン切れ')
    expect(msg.className).toMatch(/text-red-600/)
  })

  it('an ok:false with no message falls back to the localized failure copy', async () => {
    const onRunNow = jest.fn(async () => ({ ok: false }))
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    })
    expect(screen.getByText('同期に失敗しました')).toBeInTheDocument()
  })

  it('a friendly not-configured message (ok:true + message) renders as muted text, not red', async () => {
    const onRunNow = jest.fn(async () => ({
      ok: true,
      message: 'QR sync not configured — save your Quick Reserve login first.',
    }))
    render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    })
    const msg = screen.getByText('QR sync not configured — save your Quick Reserve login first.')
    expect(msg.className).not.toMatch(/text-red-600/)
    expect(msg.className).toMatch(/text-muted-foreground/)
  })

  it('a plain ok:true (no message) shows no result line at all', async () => {
    const onRunNow = jest.fn(async () => ({ ok: true }))
    const { container } = render(<SyncStatusCard status={status({})} nowMs={NOW} onRunNow={onRunNow} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    })
    // Only the button's own text nodes below the rows/footer — no stray <p> result line.
    expect(container.querySelectorAll('button')).toHaveLength(1)
  })
})
