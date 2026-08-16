/** @jest-environment jsdom */
// 自動録音 block in RecordingSection (recording-integrity PR A4, spec §8.1
// discipline c / §8.5 / §8.8). Pins: ONE switch per store, checked from the
// server-truth id list · a flip calls the action with (storeId, enabled) ·
// every switch is disabled while a write is in flight (two taps would race two
// read-modify-writes on the same lock-free blob) · the resulting list comes
// back from the SERVER, never from an optimistic local flip · a failed flip
// leaves the switch where it was and toasts, never a false 保存しました · the
// §8.5 lock caveat renders · with no stores the block does not render at all.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${Object.values(v).join(',')}` : k,
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/actions/org-settings', () => ({ upsertOrgSettings: jest.fn() }))
jest.mock('@/actions/recording-autostart', () => ({ setRecordingAutostart: jest.fn() }))

import { toast } from 'sonner'
import { setRecordingAutostart } from '@/actions/recording-autostart'
import { RecordingSection } from '@/components/settings/redesign/sections/RecordingSection'
import type { StoreRow } from '@/actions/stores'
import type { OrgSettings } from '@/actions/org-settings'

const store = (id: string, name: string): StoreRow => ({
  id,
  name,
  address: null,
  phone: null,
  isPrimary: id === 'store-1',
  active: true,
  staffCount: 0,
  customerCount: 0,
  businessType: null,
})
const STORES = [store('store-1', '本店'), store('store-2', '青山店')]

const settings = (ids?: string[]) =>
  ({ recording_autostart_store_ids: ids } as unknown as OrgSettings)

const flip = (name: string) => screen.getByRole('switch', { name })

beforeEach(() => jest.clearAllMocks())

describe('RecordingSection — 自動録音 per-store switches', () => {
  it('renders ONE switch per store, checked from the server-truth id list', () => {
    render(<RecordingSection orgSettings={settings(['store-2'])} stores={STORES} />)
    expect(flip('本店')).toHaveAttribute('aria-checked', 'false')
    expect(flip('青山店')).toHaveAttribute('aria-checked', 'true')
  })

  it('defaults every store OFF when the key is absent (the ruled default)', () => {
    render(<RecordingSection orgSettings={settings(undefined)} stores={STORES} />)
    expect(flip('本店')).toHaveAttribute('aria-checked', 'false')
    expect(flip('青山店')).toHaveAttribute('aria-checked', 'false')
  })

  it('a single-store business gets one switch and no list chrome', () => {
    render(<RecordingSection orgSettings={settings([])} stores={[STORES[0]]} />)
    expect(screen.getAllByRole('switch', { name: /本店|青山店/ })).toHaveLength(1)
  })

  it('renders the §8.5 lock caveat and the battery line', () => {
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)
    expect(screen.getByText('autostartLockCaveat')).toBeInTheDocument()
    expect(screen.getByText('autostartBatteryNote')).toBeInTheDocument()
  })

  it('threads the business-type visit noun into the description, never a hard-coded 施術', () => {
    render(
      <RecordingSection orgSettings={settings([])} stores={STORES} serviceNoun="診療" />,
    )
    expect(screen.getByText('autostartDescription:診療')).toBeInTheDocument()
  })

  it('falls back to the neutral noun when the server did not resolve one', () => {
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)
    expect(
      screen.getByText('autostartDescription:autostartVisitFallback'),
    ).toBeInTheDocument()
  })

  it('no stores → the block does not render (no promise without a control)', () => {
    render(<RecordingSection orgSettings={settings([])} stores={[]} />)
    expect(screen.queryByText('autostartLockCaveat')).not.toBeInTheDocument()
  })

  it('a flip calls the action with (storeId, enabled) and re-renders from the SERVER list', async () => {
    ;(setRecordingAutostart as jest.Mock).mockResolvedValue({
      ok: true,
      storeIds: ['store-1'],
    })
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)

    fireEvent.click(flip('本店'))

    await waitFor(() =>
      expect(setRecordingAutostart).toHaveBeenCalledWith('store-1', true),
    )
    await waitFor(() => expect(flip('本店')).toHaveAttribute('aria-checked', 'true'))
    // The server's list is what renders — including for the store that was
    // NOT touched, so a concurrent flip lost to the blob race shows up here.
    expect(flip('青山店')).toHaveAttribute('aria-checked', 'false')
  })

  it('turning one OFF sends enabled: false', async () => {
    ;(setRecordingAutostart as jest.Mock).mockResolvedValue({ ok: true, storeIds: [] })
    render(<RecordingSection orgSettings={settings(['store-1'])} stores={STORES} />)

    fireEvent.click(flip('本店'))

    await waitFor(() =>
      expect(setRecordingAutostart).toHaveBeenCalledWith('store-1', false),
    )
  })

  it('every switch is disabled while a write is in flight', async () => {
    let settle: (v: unknown) => void = () => {}
    ;(setRecordingAutostart as jest.Mock).mockReturnValue(
      new Promise((res) => {
        settle = res
      }),
    )
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)

    fireEvent.click(flip('本店'))

    await waitFor(() => expect(flip('本店')).toBeDisabled())
    expect(flip('青山店')).toBeDisabled()

    settle({ ok: true, storeIds: ['store-1'] })
    await waitFor(() => expect(flip('本店')).not.toBeDisabled())
  })

  it('a failed flip toasts and leaves the switch where it was — no false success', async () => {
    ;(setRecordingAutostart as jest.Mock).mockResolvedValue({ ok: false, error: 'failed' })
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)

    fireEvent.click(flip('本店'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('autostartSaveFailed'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(flip('本店')).toHaveAttribute('aria-checked', 'false')
  })

  it('a permission denial gets its own message, not the generic failure', async () => {
    ;(setRecordingAutostart as jest.Mock).mockResolvedValue({ ok: false, error: 'forbidden' })
    render(<RecordingSection orgSettings={settings([])} stores={STORES} />)

    fireEvent.click(flip('本店'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('autostartForbidden'))
  })
})
