/**
 * @jest-environment jsdom
 *
 * Thin chrome (design-parity Gap A) — the REAL web BottomNav + MobileHeader
 * mounted in the thin tree, fed by the chrome DTO through the module store.
 * Replaces thin-bottom-nav.test.tsx (the minimal 4-tab bar it pinned is
 * retired). Pins: signed-out renders NO chrome (login stays chrome-free) ·
 * signed-in renders the web nav (3 primary tabs + center mic + メニュー) with
 * the mic label from the DTO's nextCustomer · the menu sheet lists the
 * secondary routes · the header shows the pathname title with NO back arrow
 * on a root tab (the unprefixed-roots fix) and the bell badge from the feed ·
 * the router lands known-but-unported web routes on the 準備中 placeholder,
 * never silently on the customer list.
 */
import type { Session } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { setDataPort } from '@/lib/ports/data-port'
import type { ChromeScreenDTOType } from '@/lib/app-api/chrome-dto'

// next-intl production-ESM vs CI node 20 (see pipeline-error-card.test.tsx) —
// mock the hook, feed it REAL ja.json. Chrome uses nested namespaces
// ('settings.stores'), so walk dotted paths.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, unknown>>(
      '../../../messages/ja.json',
    )
    const dig = (obj: unknown, path: string): unknown =>
      path
        .split('.')
        .reduce(
          (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
          obj,
        )
    const v = dig(messages, `${ns}.${key}`)
    if (typeof v === 'string') return v
    throw new Error(`missing message ${ns}.${key}`)
  },
  useLocale: () => 'ja',
}))

// The nav seams, mapped exactly as the vite build maps them: both web nav
// modules resolve to the thin nav port, so Link/usePathname/useRouter behave
// as they do in the bundle.
jest.mock('@/i18n/navigation', () =>
  jest.requireActual('../../../thin/ports/nav.vite'),
)
jest.mock('next/navigation', () =>
  jest.requireActual('../../../thin/ports/nav.vite'),
)

// Server-bound web modules the chrome drags in — stubbed at the same seams
// the thin bundle re-wires (actions port / take-store).
jest.mock('@/actions/stores', () => ({ setActiveStore: jest.fn() }))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  clearOwnTakes: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(async () => null),
}))

// Router isolation: the pending-route pin is about ROUTING, not the screens —
// each real screen pulls its whole data stack.
jest.mock('../../../thin/screens/CustomersScreen', () => ({
  CustomersScreen: () => <div data-testid="customers-screen" />,
}))
jest.mock('../../../thin/screens/SessionsScreen', () => ({
  SessionsScreen: () => <div data-testid="sessions-screen" />,
}))
jest.mock('../../../thin/screens/RecordScreen', () => ({
  RecordScreen: () => <div data-testid="record-screen" />,
}))
jest.mock('../../../thin/screens/AskAiScreen', () => ({
  AskAiScreen: () => <div data-testid="ask-ai-screen" />,
}))
jest.mock('../../../thin/screens/AppointmentsScreen', () => ({
  AppointmentsScreen: () => <div data-testid="appointments-screen" />,
}))
jest.mock('../../../thin/screens/CustomerProfileScreen', () => ({
  CustomerProfileScreen: () => <div data-testid="profile-screen" />,
}))
jest.mock('../../../thin/screens/KaruteDetailScreen', () => ({
  KaruteDetailScreen: () => <div data-testid="karute-detail-screen" />,
}))

const session = (token: string, userId = 'auth-user-1') =>
  ({ access_token: token, user: { id: userId } }) as Session

const CHROME_DTO: ChromeScreenDTOType = {
  staffId: 'auth-user-1',
  nextCustomer: {
    customerId: 'cust-1',
    customerName: '田中',
    startTime: new Date(Date.now() + 30 * 60_000).toISOString(),
    endTime: new Date(Date.now() + 90 * 60_000).toISOString(),
    reason: 'upcoming',
    minutesFromNow: 30,
  },
  notifications: [
    {
      id: 'n1',
      category: 'booking',
      titleJa: '新規予約',
      titleEn: 'New booking',
      bodyJa: '',
      bodyEn: '',
      createdAt: new Date().toISOString(),
      readAt: null,
      href: '/appointments',
    },
  ],
  stores: [],
  activeStoreId: null,
}

const apiFetch = jest.fn(
  async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
    ok: true,
    json: async () => ({ data: CHROME_DTO }),
  }),
)

import { ThinChromeContent, ThinChromeNav } from '../../../thin/chrome/Chrome'
import { ThinRouter } from '../../../thin/router'
import { subscribeRefresh } from '../../../thin/ports/nav.vite'
import { resyncChromeAfterHeal } from '../../../thin/chrome/chrome-store'
import {
  clearThinActiveStore,
  getThinActiveStore,
  setThinActiveStore,
} from '../../../thin/chrome/store-pref'

beforeEach(() => {
  apiFetch.mockClear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDataPort({ apiFetch } as any)
  window.localStorage.clear()
  history.replaceState({}, '', '/customers')
})

afterEach(() => {
  // Two-step on purpose (see thin-splash-gate.test.tsx). The signed-out flip
  // also resets the chrome store (its module subscription).
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('ThinChromeNav (the real web BottomNav in the shell slot)', () => {
  it('renders nothing signed-out — the login screen stays chrome-free', () => {
    setSessionState({ status: 'signed-out' })
    const { container } = render(<ThinChromeNav />)
    expect(container.innerHTML).toBe('')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('signed-in: primary tabs + center mic labeled with the DTO next customer + menu sheet routes', async () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    // Primary tabs (the web set — 予約 now exists as a destination).
    for (const label of ['予約', 'カルテ', '顧客', 'メニュー']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // Center mic label arrives with the DTO (honorific appended for ja).
    await waitFor(() => expect(screen.getByText('田中様')).toBeTruthy())
    // Menu sheet content is in the DOM (visibility toggles via classes).
    for (const label of ['ダッシュボード', 'コーチング', 'AI相談', '設定']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it("a chrome fetch resolving AFTER sign-out never writes the previous user's data", async () => {
    type FetchShape = { ok: boolean; json: () => Promise<unknown> }
    let resolveFetch: (v: FetchShape) => void = () => {}
    apiFetch.mockImplementationOnce(
      () =>
        new Promise<FetchShape>((r) => {
          resolveFetch = r
        }),
    )
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />) // kicks the fetch → loading
    act(() => setSessionState({ status: 'signed-out' })) // epoch bump + reset
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ data: CHROME_DTO }) })
    })
    // The stale resolve was dropped: a fresh sign-in must not see the dead
    // session's chrome (shared-device hygiene, packet-10 class).
    act(() => setSessionState({ status: 'signed-in', session: session('tok2') }))
    expect(screen.queryByText('田中様')).toBeNull()
  })

  it('stays mounted through an offline-resume spell (recovering w/ known session)', () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    setSessionState({ status: 'recovering' })
    render(<ThinChromeNav />)
    expect(screen.getAllByText('顧客').length).toBeGreaterThan(0)
  })
})

describe('fresh-install store lens seed (Gap B½)', () => {
  // Two stores so the seed has a real pick; primary listed SECOND to prove
  // it's the isPrimary flag, not array order, that wins.
  const LENS_DTO: ChromeScreenDTOType = {
    ...CHROME_DTO,
    stores: [
      { id: 's-branch', name: 'La Estro 渋谷', isPrimary: false, active: true },
      { id: 's-primary', name: 'La Estro 代官山', isPrimary: true, active: true },
    ],
  }
  const chromeReady = () => waitFor(() => expect(screen.getByText('田中様')).toBeTruthy())
  const lensDto = (dto: ChromeScreenDTOType) =>
    apiFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ data: dto }),
    }))

  const pin = (storeId: string, userId: string) => {
    const raw = window.localStorage.getItem('karute-active-store')
    window.localStorage.setItem(
      'karute-active-store',
      JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [userId]: storeId }),
    )
  }

  it('seeds the pref from the primary store and re-fetches mounted screens', async () => {
    const refreshed = jest.fn()
    const unsub = subscribeRefresh(refreshed)
    lensDto(LENS_DTO)
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    await waitFor(() =>
      expect(getThinActiveStore()).toBe('s-primary'), // isPrimary, not array order
    )
    // Screens fetched before the seed rendered unlensed — the refresh bus
    // must fire so they re-fetch through the new lens.
    expect(refreshed).toHaveBeenCalled()
    unsub()
  })

  it('never overrides a pinned lens — and without a seed, chrome fetches exactly once', async () => {
    const refreshed = jest.fn()
    const unsub = subscribeRefresh(refreshed)
    pin('s-branch', 'auth-user-1')
    lensDto(LENS_DTO)
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    await chromeReady()
    expect(getThinActiveStore()).toBe('s-branch')
    expect(refreshed).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('after seeding, chrome re-fetches ONCE through the new lens and stops', async () => {
    lensDto(LENS_DTO) // first response: unlensed → triggers the seed
    lensDto({
      ...LENS_DTO,
      activeStoreId: 's-primary',
      nextCustomer: {
        customerId: 'cust-2',
        customerName: '佐藤',
        startTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        endTime: new Date(Date.now() + 90 * 60_000).toISOString(),
        reason: 'upcoming',
        minutesFromNow: 30,
      },
    }) // second response: lensed — store-scoped feed/next-customer
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    // The lensed dto replaces the unlensed one (bell/mic no longer
    // business-wide for the rest of the session).
    await waitFor(() => expect(screen.getByText('佐藤様')).toBeTruthy())
    expect(getThinActiveStore()).toBe('s-primary')
    // Loop-safe: the lensed response cannot seed again (pref set → gate 1).
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('a failed lensed re-fetch keeps the rendered chrome — best-effort, no error frame', async () => {
    lensDto(LENS_DTO)
    apiFetch.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({}),
    }))
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    await chromeReady() // 田中様 from the unlensed dto
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(screen.getByText('田中様')).toBeTruthy()
    expect(getThinActiveStore()).toBe('s-primary')
  })

  it('never seeds a clamped staff (non-null activeStoreId) — the tenant primary could be outside their assignment', async () => {
    const refreshed = jest.fn()
    const unsub = subscribeRefresh(refreshed)
    lensDto({ ...LENS_DTO, activeStoreId: 's-branch' })
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    await chromeReady()
    expect(getThinActiveStore()).toBeNull()
    expect(refreshed).not.toHaveBeenCalled()
    unsub()
  })

  it("a pinned lens survives its OWN user's sign-out — the next session is lensed from its first request", () => {
    pin('s-branch', 'auth-user-1')
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'signed-in', session: session('tok2', 'auth-user-1') })
    expect(getThinActiveStore()).toBe('s-branch')
  })

  it("another user on the same device never inherits the lens (their clamp would fail closed)", () => {
    pin('s-branch', 'auth-user-1')
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'signed-in', session: session('tok2', 'auth-user-2') })
    expect(getThinActiveStore()).toBeNull()
  })

  it("a second user pinning does not evict the first — both return to their own lens", () => {
    pin('s-branch', 'auth-user-1')
    setSessionState({ status: 'signed-in', session: session('tok2', 'auth-user-2') })
    setThinActiveStore('s-primary')
    expect(getThinActiveStore()).toBe('s-primary')
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'signed-in', session: session('tok3', 'auth-user-1') })
    expect(getThinActiveStore()).toBe('s-branch')
  })

  it('a legacy unkeyed value is treated as absent — no owner proof to trust', () => {
    window.localStorage.setItem('karute-active-store', 's-branch')
    setSessionState({ status: 'signed-in', session: session('tok') })
    expect(getThinActiveStore()).toBeNull()
  })

  it('signed-out reads nothing and writes nothing — no lens without an owner', () => {
    setSessionState({ status: 'signed-out' })
    setThinActiveStore('s-branch')
    expect(window.localStorage.getItem('karute-active-store')).toBeNull()
    expect(getThinActiveStore()).toBeNull()
  })
})

describe('mid-session heal resync (fleet round 2)', () => {
  const LENS_DTO: ChromeScreenDTOType = {
    ...CHROME_DTO,
    stores: [
      { id: 's-branch', name: 'La Estro 渋谷', isPrimary: false, active: true },
      { id: 's-primary', name: 'La Estro 代官山', isPrimary: true, active: true },
    ],
  }
  const lensDto = (dto: ChromeScreenDTOType) =>
    apiFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ data: dto }),
    }))
  const chromeReady = () =>
    waitFor(() => expect(screen.getByText('田中様')).toBeTruthy())

  it('re-fetches a ready chrome and re-seeds after a heal cleared the pin — switcher truth + screens re-scope', async () => {
    const refreshed = jest.fn()
    const unsub = subscribeRefresh(refreshed)
    setSessionState({ status: 'signed-in', session: session('tok') })
    setThinActiveStore('s-dead') // deliberate pin → boot fetch is lensed, no seed
    lensDto(LENS_DTO)
    render(<ThinChromeNav />)
    await chromeReady()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    // The stranded-pin heal fires mid-session: pin cleared, then the nudge.
    clearThinActiveStore('s-dead')
    lensDto(LENS_DTO) // resync fetch — unlensed (activeStoreId null) → seeds
    lensDto({ ...LENS_DTO, activeStoreId: 's-primary' }) // seed's lensed re-fetch
    await act(async () => {
      resyncChromeAfterHeal()
    })
    await waitFor(() => expect(getThinActiveStore()).toBe('s-primary'))
    expect(refreshed).toHaveBeenCalled() // screens re-scope through the new lens
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    unsub()
  })

  it('is a no-op while chrome is still loading — boot heals converge through the in-flight fetch', () => {
    apiFetch.mockImplementationOnce(
      () => new Promise(() => {}), // boot fetch never resolves in this test
    )
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(<ThinChromeNav />)
    resyncChromeAfterHeal()
    expect(apiFetch).toHaveBeenCalledTimes(1) // no second fetch while loading
  })

  it('is single-flight — N concurrent heals nudge once', async () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    setThinActiveStore('s-dead')
    lensDto(LENS_DTO)
    render(<ThinChromeNav />)
    await chromeReady()
    let resolveResync: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {}
    apiFetch.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => {
          resolveResync = r
        }),
    )
    clearThinActiveStore('s-dead')
    resyncChromeAfterHeal()
    resyncChromeAfterHeal() // concurrent second heal
    expect(apiFetch).toHaveBeenCalledTimes(2) // boot + ONE resync, not two
    await act(async () => {
      resolveResync({ ok: true, json: async () => ({ data: CHROME_DTO }) })
    })
  })

  it('seed reports false when localStorage refuses the persist — no phantom refresh cascade', async () => {
    const refreshed = jest.fn()
    const unsub = subscribeRefresh(refreshed)
    setSessionState({ status: 'signed-in', session: session('tok') })
    lensDto(LENS_DTO) // fresh install: no pin → seed path
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    try {
      render(<ThinChromeNav />)
      await chromeReady()
      // Persist silently failed → NOT seeded: no refresh storm, no lensed
      // re-fetch for a lens that does not exist.
      expect(getThinActiveStore()).toBeNull()
      expect(refreshed).not.toHaveBeenCalled()
      expect(apiFetch).toHaveBeenCalledTimes(1)
    } finally {
      setItem.mockRestore()
      unsub()
    }
  })
})

describe('ThinChromeContent (MobileHeader + web content frame)', () => {
  it('shows the pathname title, no back arrow on a root tab, and the unread badge', async () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(
      <ThinChromeContent>
        <div data-testid="screen" />
      </ThinChromeContent>,
    )
    expect(screen.getByTestId('screen')).toBeTruthy()
    // Title for /customers (ja sidebar ns) — the unprefixed-roots fix keeps
    // the back arrow OFF here (it treated every thin path as a sub-route).
    expect(screen.getByRole('heading', { name: '顧客' })).toBeTruthy()
    expect(screen.queryByLabelText('戻る')).toBeNull()
    // One unread feed item → badge "1" on the bell.
    await waitFor(() => expect(screen.getByText('1')).toBeTruthy())
  })

  it('shows the back arrow on a sub-route', () => {
    history.replaceState({}, '', '/sessions')
    setSessionState({ status: 'signed-in', session: session('tok') })
    render(
      <ThinChromeContent>
        <div />
      </ThinChromeContent>,
    )
    expect(screen.getByLabelText('戻る')).toBeTruthy()
  })
})

describe('ThinRouter pending routes (no silent wrong screen)', () => {
  it.each(['/profile', '/dashboard', '/settings', '/coaching/data', '/appointments/deep'])(
    '%s lands on the 準備中 placeholder',
    (path) => {
      history.replaceState({}, '', path)
      act(() => {
        setSessionState({ status: 'signed-in', session: session('tok') })
      })
      render(<ThinRouter />)
      expect(screen.getByText('この画面は準備中です')).toBeTruthy()
    },
  )

  it('/appointments renders the real screen, not the placeholder (P-B)', () => {
    history.replaceState({}, '', '/appointments')
    act(() => {
      setSessionState({ status: 'signed-in', session: session('tok') })
    })
    render(<ThinRouter />)
    expect(screen.getByTestId('appointments-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })
})
