/** @jest-environment jsdom */
// WebOnly payments-canon regression (packet-02 build #7, §1.5). Purchase surfaces
// must NEVER render inside the native shell — not even for one frame. This locks
// the runtime guarantee: window.Capacitor present (native) → children never
// appear; absent (open web) → children render after hydration.

import { render, screen, waitFor } from '@testing-library/react'
import { WebOnly } from '@/components/shell/WebOnly'

function PurchaseSurface() {
  return <div>PLAN_UPGRADE_CTA</div>
}

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('WebOnly gate (purchase surface)', () => {
  it('NEVER renders children inside the native shell', async () => {
    ;(window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
    }
    render(
      <WebOnly>
        <PurchaseSurface />
      </WebOnly>,
    )
    // Give the effect a chance to (not) flip the gate open.
    await waitFor(() => {})
    expect(screen.queryByText('PLAN_UPGRADE_CTA')).toBeNull()
  })

  it('renders children on the open web', async () => {
    render(
      <WebOnly>
        <PurchaseSurface />
      </WebOnly>,
    )
    expect(await screen.findByText('PLAN_UPGRADE_CTA')).toBeTruthy()
  })
})
