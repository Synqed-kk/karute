/**
 * Coverage for scopeKarutePhotos (src/lib/karute/scoped-photos.ts) — the
 * single source of truth for karute-scoped photo display, shared by
 * PhotoRecordsServer (web) and the screens/karute/[id] facade (device).
 */
import { scopeKarutePhotos } from '@/lib/karute/scoped-photos'

function photo(id: string, sessionId: string | null) {
  return { id, recording_session_id: sessionId }
}

describe('scopeKarutePhotos', () => {
  it('keeps only photos matching the recording session', () => {
    const result = scopeKarutePhotos(
      [photo('p1', 'sess-1'), photo('p2', 'sess-2')],
      'sess-1',
    )
    expect(result.map((p) => p.id)).toEqual(['p1'])
  })

  it('excludes a mismatched-session photo', () => {
    const result = scopeKarutePhotos([photo('p1', 'sess-other')], 'sess-1')
    expect(result).toEqual([])
  })

  it('recordingSessionId=null → empty, even when unstamped photos exist', () => {
    const result = scopeKarutePhotos(
      [photo('p1', null), photo('p2', 'sess-2')],
      null,
    )
    expect(result).toEqual([])
  })
})

export {}
