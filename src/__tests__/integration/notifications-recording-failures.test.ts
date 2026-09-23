/**
 * Recording hole PR-3 — the bell's 6th source (カルテ未作成の録音).
 *
 * Pins: the 監査ログ flag gates the source entirely (never read, never shown
 * without it); one item per recording, newest row wins; rows outside the
 * 録音履歴 window (INBOX_WINDOW_MS) are dropped; the item id is stable across
 * builds. Fake audit list only — ids and codes, no customer data.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

type FakeEvent = {
  action: string
  target_id: string | null
  at: string
  detail: unknown
}
let events: FakeEvent[] = []
const auditList = jest.fn(async () => ({ events, total: events.length, page: 1, page_size: 200 }))
const recordingsGet = jest.fn(async (id: string) => ({ id, created_at: '2026-09-22T07:02:00.000Z' }))

jest.mock('@synqed-kk/client', () => {
  class SynqedClient {
    appointments = { list: jest.fn(async () => ({ appointments: [] })) }
    karuteRecords = { list: jest.fn(async () => ({ karute_records: [] })) }
    audit = { list: auditList }
    recordings = { get: recordingsGet }
  }
  return { SynqedClient }
})

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
  getCachedCustomerListFor: jest.fn(async () => []),
}))

jest.mock('@/lib/customers/list-enrich', () => ({
  effectiveLastVisitIso: jest.fn(() => null),
  enrichCustomers: jest.fn(async () => new Map()),
}))

import { buildNotificationFeed } from '@/lib/notifications/derive'
import { INBOX_WINDOW_MS } from '@/lib/recordings/inbox'

const BIZ = 'biz-1'
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

beforeAll(() => {
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

beforeEach(() => {
  jest.clearAllMocks()
  events = []
})

const recordingItems = (feed: { id: string }[]) =>
  feed.filter((n) => n.id.startsWith('recording-failure:'))

describe('notification feed — recording failures (owner view)', () => {
  it('(1) flag false → zero recording items even with rows present, and no audit read', async () => {
    events = [
      { action: 'recording.transcribe_failed', target_id: 'rec-a', at: hoursAgo(1), detail: { reason: 'ai_failed' } },
    ]
    const off = await buildNotificationFeed(BIZ, 'ja', null)
    const explicitOff = await buildNotificationFeed(BIZ, 'ja', null, { viewerCanViewAudit: false })
    expect(recordingItems(off)).toHaveLength(0)
    expect(recordingItems(explicitOff)).toHaveLength(0)
    expect(auditList).not.toHaveBeenCalled()
  })

  it('(2) flag true → one item per recording, newest reason wins', async () => {
    events = [
      { action: 'recording.karute_missing', target_id: 'rec-a', at: hoursAgo(1), detail: { reason: 'saveFailed' } },
      { action: 'recording.transcribe_failed', target_id: 'rec-a', at: hoursAgo(3), detail: { reason: 'transcription_failed' } },
      { action: 'recording.transcribe_failed', target_id: 'rec-b', at: hoursAgo(2), detail: { reason: 'ai_failed' } },
      // Not one of the two actions — never an item.
      { action: 'recording.transcribe', target_id: 'rec-c', at: hoursAgo(1), detail: {} },
    ]
    const feed = await buildNotificationFeed(BIZ, 'ja', null, { viewerCanViewAudit: true })
    const items = recordingItems(feed)
    expect(items.map((i) => i.id).sort()).toEqual(['recording-failure:rec-a', 'recording-failure:rec-b'])
    const a = feed.find((n) => n.id === 'recording-failure:rec-a')!
    expect(a.category).toBe('system')
    expect(a.href).toBe('/ja/settings?tab=audit')
    expect(a.titleJa).toBe('カルテ未作成の録音')
    // 07:02Z = 16:02 JST; the newest row's reason (karute save), not the older one.
    expect(a.bodyJa).toBe('9/22 16:02の録音・カルテ保存エラー')
    expect(a.bodyEn).toBe('Recorded 9/22 16:02 · Karute save error')
    expect(a.createdAt).toBe(events[0].at)
    expect(auditList).toHaveBeenCalledWith(expect.objectContaining({ category: 'recording' }))
  })

  it('(3) rows older than the 録音履歴 window are excluded', async () => {
    const tooOld = new Date(Date.now() - INBOX_WINDOW_MS - 3_600_000).toISOString()
    events = [
      { action: 'recording.transcribe_failed', target_id: 'rec-old', at: tooOld, detail: { reason: 'other' } },
      { action: 'recording.transcribe_failed', target_id: 'rec-new', at: hoursAgo(1), detail: { reason: 'other' } },
    ]
    const items = recordingItems(await buildNotificationFeed(BIZ, 'ja', null, { viewerCanViewAudit: true }))
    expect(items.map((i) => i.id)).toEqual(['recording-failure:rec-new'])
  })

  it('(4) the item id is stable across two builds', async () => {
    events = [
      { action: 'recording.transcribe_failed', target_id: 'rec-a', at: hoursAgo(1), detail: { reason: 'empty_transcript' } },
    ]
    const first = recordingItems(await buildNotificationFeed(BIZ, 'en', null, { viewerCanViewAudit: true }))
    const second = recordingItems(await buildNotificationFeed(BIZ, 'en', null, { viewerCanViewAudit: true }))
    expect(first.map((i) => i.id)).toEqual(['recording-failure:rec-a'])
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id))
  })
})
