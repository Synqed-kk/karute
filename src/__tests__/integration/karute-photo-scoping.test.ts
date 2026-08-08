/**
 * Coverage for karute-scoped photo display (packet 2026-08-09 PR 9a, Liam's
 * ruling): each karute detail page shows ONLY the photos taken in ITS
 * recording session — never the customer's whole photo gallery (that
 * aggregate view stays on the customer page, untouched by this packet).
 *
 *  1. mapSynqedKaruteRecord threads recording_session_id (absent → null).
 *  2. PhotoRecordsServer filters the customer's photo list down to the
 *     karute's own session, and shows ZERO photos (never the unscoped list)
 *     when the karute has no recording_session_id.
 */
const mockListCustomerPhotos = jest.fn()
jest.mock('@/actions/customers', () => ({
  listCustomerPhotos: (...a: unknown[]) => mockListCustomerPhotos(...a),
}))
// PhotoRecordsServer statically imports the 'use client' PhotoRecordsCard,
// which pulls in next-intl's react-client entry at module-load time (never
// actually rendered here — React.createElement doesn't invoke the component
// function, so the hook itself never runs). Stub it so the import resolves.
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import type { ReactElement } from 'react'
import { mapSynqedKaruteRecord } from '@/lib/supabase/karute'
import { PhotoRecordsServer } from '@/components/karute/redesign/detail/PhotoRecordsServer'
import type { PhotoRecord } from '@/components/karute/redesign/detail/PhotoRecordsCard'

// PhotoRecordsServer returns <PhotoRecordsCard photos={...} /> — typing the
// awaited result as its element shape (instead of `any`) lets these tests
// read .props.photos without a lint-triggering disable comment.
type PhotoRecordsCardElement = ReactElement<{ photos: PhotoRecord[] }>

describe('mapSynqedKaruteRecord — recording_session_id', () => {
  it('threads recording_session_id through from the synqed record', () => {
    const rec = mapSynqedKaruteRecord(
      {
        id: 'k1',
        created_at: '2026-08-09T00:00:00Z',
        ai_summary: 'x',
        recording_session_id: 'sess-1',
      },
      null,
    )
    expect(rec.recording_session_id).toBe('sess-1')
  })

  it('absent recording_session_id maps to null', () => {
    const rec = mapSynqedKaruteRecord(
      { id: 'k1', created_at: '2026-08-09T00:00:00Z', ai_summary: 'x' },
      null,
    )
    expect(rec.recording_session_id).toBeNull()
  })

  // packet 2026-08-09 PR 9a §C — '' is not a session; normalize it like
  // absent so a mis-stamped empty-string field doesn't fake a real link.
  it("empty-string recording_session_id ('') maps to null, not ''", () => {
    const rec = mapSynqedKaruteRecord(
      { id: 'k1', created_at: '2026-08-09T00:00:00Z', ai_summary: 'x', recording_session_id: '' },
      null,
    )
    expect(rec.recording_session_id).toBeNull()
  })
})

function photo(id: string, sessionId: string | null) {
  return {
    id,
    signed_url: null,
    category: 'before',
    caption: null,
    recording_session_id: sessionId,
  }
}

describe('PhotoRecordsServer — recording-session scoping', () => {
  beforeEach(() => mockListCustomerPhotos.mockReset())

  it('renders only photos matching the karute recording session', async () => {
    mockListCustomerPhotos.mockResolvedValue({
      photos: [photo('p1', 'sess-1'), photo('p2', 'sess-2')],
    })
    const el = (await PhotoRecordsServer({
      customerId: 'c1',
      recordingSessionId: 'sess-1',
    })) as PhotoRecordsCardElement
    expect(el.props.photos.map((p) => p.id)).toEqual(['p1'])
  })

  it('recordingSessionId=null → zero photos, even when unstamped photos exist', async () => {
    mockListCustomerPhotos.mockResolvedValue({
      photos: [photo('p1', null), photo('p2', 'sess-2')],
    })
    const el = (await PhotoRecordsServer({
      customerId: 'c1',
      recordingSessionId: null,
    })) as PhotoRecordsCardElement
    expect(el.props.photos).toEqual([])
  })

  it('excludes photos from a different recording session', async () => {
    mockListCustomerPhotos.mockResolvedValue({
      photos: [photo('p1', 'sess-other')],
    })
    const el = (await PhotoRecordsServer({
      customerId: 'c1',
      recordingSessionId: 'sess-1',
    })) as PhotoRecordsCardElement
    expect(el.props.photos).toEqual([])
  })
})

export {}
