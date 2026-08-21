/**
 * @jest-environment jsdom
 *
 * 要対応 badges (Build F1, approved mock §2) — the mic FAB and the desktop
 * sidebar 録音 row.
 *
 * A count badge earns its place only if it can reach ZERO. Both surfaces read
 * the SAME store the record page's inbox reads, so the number a staffer sees
 * from any screen is the number of rows waiting for them — and the badge is
 * absent, not "0", the moment nothing is.
 */
let mockPathname = '/dashboard'
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: unknown }) => (
    <a href={typeof href === 'string' ? href : undefined} {...rest}>
      {children}
    </a>
  ),
}))
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: 'idle',
    startedAt: null,
    stopRecording: jest.fn(),
    target: null,
  }),
}))
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { takeId: null, state: 'idle', subscribe: () => () => {} },
}))
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: { state: 'idle', context: null, subscribe: () => () => {} },
}))
jest.mock('@/lib/karute/take-store', () => ({
  listOwnTakes: jest.fn(async () => []),
}))
jest.mock('@/lib/sidebar-style/hooks', () => ({ useSidebarStyle: () => 'light' }))
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({ activeStaff: { name: '原', displayRole: 'owner' }, orgName: 'Salon' }),
}))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: jest.fn() } }) }))
jest.mock('@/lib/karute/logout-wipe', () => ({ wipeSessionVault: jest.fn() }))

type ServerSession = {
  recordingSessionId: string
  customerId: string | null
  createdAt: string
  durationSeconds: number | null
  karuteRecordId: string | null
  jobStatus: string | null
  jobProbeFailed: boolean
  jobLastError: string | null
}
let serverSessions: ServerSession[] = []
jest.mock('@/actions/recordings-inbox', () => ({
  listRecordingsInbox: jest.fn(async () => serverSessions),
}))

import { act, cleanup, render, screen } from '@testing-library/react'
import { BottomNav } from '@/components/layout/bottom-nav'
import { Sidebar } from '@/components/layout/sidebar'
import { resetInbox } from '@/lib/recordings/inbox-store'

const NOW = Date.parse('2026-08-25T04:00:00.000Z')

function session(over: Partial<ServerSession> & { recordingSessionId: string }): ServerSession {
  return {
    customerId: 'cust-1',
    createdAt: new Date(NOW - 60 * 60_000).toISOString(),
    durationSeconds: 900,
    karuteRecordId: null,
    jobStatus: null,
    jobProbeFailed: false,
    jobLastError: null,
    ...over,
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] })
  resetInbox()
  serverSessions = []
  mockPathname = '/dashboard'
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
  jest.clearAllMocks()
})

describe('要対応 badge — mic FAB', () => {
  it('counts 失敗 + 復元可能 + 確認待ち, from any screen', async () => {
    serverSessions = [
      session({ recordingSessionId: 'f1', jobStatus: 'FAILED', jobLastError: 'x' }),
      session({ recordingSessionId: 'f2', jobStatus: 'FAILED', jobLastError: 'y' }),
      session({ recordingSessionId: 'ok', karuteRecordId: 'rec-1' }),
      session({ recordingSessionId: 'run', jobStatus: 'RUNNING' }),
    ]
    render(<BottomNav />)
    await flush()
    expect(screen.getByTestId('mic-needs-attention')).toHaveTextContent('2')
  })

  it('is ABSENT — not a zero — when nothing is waiting', async () => {
    serverSessions = [session({ recordingSessionId: 'ok', karuteRecordId: 'rec-1' })]
    render(<BottomNav />)
    await flush()
    expect(screen.queryByTestId('mic-needs-attention')).toBeNull()
  })
})

describe('要対応 badge — desktop sidebar', () => {
  it('rides the 録音 row and shows the same number', async () => {
    serverSessions = [
      session({ recordingSessionId: 'f1', jobStatus: 'FAILED', jobLastError: 'x' }),
    ]
    render(<Sidebar />)
    await flush()
    const badge = screen.getByTestId('sidebar-needs-attention')
    expect(badge).toHaveTextContent('1')
    // …on the 録音 row itself, not floating somewhere else in the nav.
    expect(badge.closest('a')?.getAttribute('href')).toBe('/sessions')
  })

  it('disappears once the list is clean (the badge can reach zero)', async () => {
    render(<Sidebar />)
    await flush()
    expect(screen.queryByTestId('sidebar-needs-attention')).toBeNull()
  })
})

describe('要対応 badge — it has to be ANNOUNCED, not just drawn (FX-5)', () => {
  it('the mic FAB carries the count in its own aria-label', async () => {
    // An aria-label REPLACES the element's descendant text, so the badge span
    // inside the Link is invisible to a screen reader unless the label says it.
    serverSessions = [
      session({ recordingSessionId: 'f1', jobStatus: 'FAILED', jobLastError: 'x' }),
      session({ recordingSessionId: 'f2', jobStatus: 'FAILED', jobLastError: 'y' }),
    ]
    render(<BottomNav />)
    await flush()
    const link = screen.getByTestId('mic-needs-attention').closest('a')!
    expect(link.getAttribute('aria-label')).toContain('needsAttentionAria')
  })

  it('with nothing waiting the FAB label is unchanged', async () => {
    render(<BottomNav />)
    await flush()
    const links = screen.getAllByRole('link')
    for (const l of links) {
      expect(l.getAttribute('aria-label') ?? '').not.toContain('needsAttentionAria')
    }
  })

  it('the sidebar count reaches the accessible name of the 録音 link', async () => {
    // NOT an attribute read: a bare <span> is role=generic, where aria-label is
    // NAME-PROHIBITED — Chrome drops it, so the attribute can be present and the
    // count still never announced. Resolve the real accessible name instead.
    serverSessions = [session({ recordingSessionId: 'f1', jobStatus: 'FAILED', jobLastError: 'x' })]
    render(<Sidebar />)
    await flush()
    const badge = screen.getByTestId('sidebar-needs-attention')
    const link = badge.closest('a')!
    // jsdom's accname implementation HONOURS aria-label on a generic; Chrome
    // does not. So the attribute check is the real discriminator: the name has
    // to come from text in the DOM, not from a name-prohibited attribute.
    expect(badge).not.toHaveAttribute('aria-label')
    expect(link.textContent).toContain('needsAttention')
    expect(link).toHaveAccessibleName(/needsAttention/)
  })
})
