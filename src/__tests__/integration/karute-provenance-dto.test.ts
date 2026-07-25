// Edit-layer Wave 2, PR-A: author/version/original_ai_content threaded through
// the read chain (mapSynqedKaruteRecord -> karuteEntriesToSessionEntries ->
// SessionEntrySchema). Back-compat is the point: a legacy/cached row or
// payload minted before these fields existed must still map/parse cleanly.
import { mapSynqedKaruteRecord } from '@/lib/supabase/karute'
import { karuteEntriesToSessionEntries } from '@/lib/adapters/karute-detail'
import { SessionEntrySchema } from '@/lib/app-api/karute-detail-screen-dto'

const RAW_ENTRY = {
  id: 'e1',
  category: 'SYMPTOM',
  content: '肩の張りが続いている（デスクワーク由来）',
  original_quote: null,
  confidence: 0.9,
  is_manual: true,
  created_at: '2026-07-17T03:05:00Z',
}

describe('mapSynqedKaruteRecord — entry provenance', () => {
  it('threads author, version, original_ai_content', () => {
    const rec = mapSynqedKaruteRecord(
      {
        id: 'kar-1',
        created_at: '2026-07-17T03:00:00Z',
        ai_summary: 'x',
        entries: [{ ...RAW_ENTRY, author: 'HUMAN_EDITED', version: 3, original_ai_content: '肩の張りが続いている' }],
      },
      null,
    )
    expect(rec.entries[0]).toMatchObject({
      author: 'HUMAN_EDITED',
      version: 3,
      original_ai_content: '肩の張りが続いている',
    })
  })

  it('maps a legacy SDK row without the fields (no throw, no chip data)', () => {
    const rec = mapSynqedKaruteRecord(
      { id: 'kar-1', created_at: '2026-07-17T03:00:00Z', ai_summary: 'x', entries: [RAW_ENTRY] },
      null,
    )
    expect(rec.entries[0].author).toBeUndefined()
    expect(rec.entries[0].version).toBeUndefined()
    expect(rec.entries[0].original_ai_content).toBeNull()
  })
})

describe('karuteEntriesToSessionEntries — provenance pass-through', () => {
  it('carries author/version/original_ai_content onto SessionEntry', () => {
    const rec = mapSynqedKaruteRecord(
      {
        id: 'kar-1',
        created_at: '2026-07-17T03:00:00Z',
        ai_summary: 'x',
        entries: [{ ...RAW_ENTRY, author: 'HUMAN_CREATED', version: 1, original_ai_content: null }],
      },
      null,
    )
    const [entry] = karuteEntriesToSessionEntries(rec)
    expect(entry.author).toBe('HUMAN_CREATED')
    expect(entry.version).toBe(1)
  })
})

describe('SessionEntrySchema — back-compat parse', () => {
  const base = { id: 'e1', category: 'concern' as const, time: '12:00', body: '肩の張り' }

  it('parses a fields-absent cached payload (legacy)', () => {
    expect(() => SessionEntrySchema.parse(base)).not.toThrow()
  })

  it('parses a payload carrying the provenance fields', () => {
    const parsed = SessionEntrySchema.parse({
      ...base,
      author: 'HUMAN_EDITED',
      version: 2,
      original_ai_content: '肩の張り（原文）',
    })
    expect(parsed.author).toBe('HUMAN_EDITED')
    expect(parsed.version).toBe(2)
  })
})
