/**
 * Content-keyed AI caches (EDIT-LAYER-DESIGN §4 / wave1-recut PR-3): the
 * presession_brief, body_prediction, and insights caches used to key on
 * record ids + a TTL alone, so a staff edit or a regen was invisible on
 * these surfaces for up to a day. Each now hashes the exact content it
 * reads (entries + effectiveSummary) into its cacheInput — the pattern
 * ai-outreach.ts already used (`s: summary`, the full string, not an id).
 *
 * These tests prove the KEY material actually changes when the underlying
 * content changes, without ever calling OpenAI (buildContext/
 * predictionCacheSessions are pure — no network). @synqed-kk/client is
 * mocked purely so importing ai-brief.ts/ai-body-prediction.ts doesn't pull
 * in the real ESM package build (same technique as app-api-ai-compute.test.ts).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

import type { KaruteRecord } from '@synqed-kk/client'
import { buildContext } from '@/lib/karute/ai-brief'
import { predictionCacheSessions } from '@/lib/karute/ai-body-prediction'

function karuteRecord(overrides: Partial<KaruteRecord> = {}): KaruteRecord {
  return {
    id: 'r1',
    business_id: 'biz-1',
    customer_id: 'cust-1',
    store_id: null,
    staff_id: 'staff-1',
    appointment_id: null,
    recording_session_id: null,
    status: 'APPROVED',
    ai_summary: null,
    edited_summary: null,
    transcript: null,
    service: null,
    duration_minutes: null,
    session_date: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    entries: [],
    ...overrides,
  }
}

describe('ai-brief presession_brief cache — content-keyed', () => {
  it('an edited_summary overlay changes the built history block (the exact cache key material)', () => {
    const before = buildContext([karuteRecord({ ai_summary: 'Shoulder pain noted' })])
    const after = buildContext([
      karuteRecord({
        ai_summary: 'Shoulder pain noted',
        edited_summary: 'Corrected: knee pain, not shoulder',
      }),
    ])
    expect(before).not.toBe(after)
    expect(after).toContain('Corrected: knee pain')
    expect(before).not.toContain('Corrected')
  })

  it('cacheInput is keyed on that same history block, not bare record ids', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/karute/ai-brief.ts'), 'utf8')
    expect(src).toContain('history: historyBlock,')
    expect(src).not.toContain('ids: records.map((r) => r.id),')
    // The prompt's opening line reads both (fleet round 7/25) — a name fix or
    // a walk-in visit-count bump must bust the cached brief.
    expect(src).toContain('name: customerName,')
    expect(src).toContain('visits: visitCount,')
  })
})

describe('ai-body-prediction body_prediction cache — content-keyed', () => {
  it('an edited_summary overlay changes the per-session cache key', () => {
    const before = predictionCacheSessions([karuteRecord({ id: 's1', ai_summary: 'Improving' })])
    const after = predictionCacheSessions([
      karuteRecord({ id: 's1', ai_summary: 'Improving', edited_summary: 'Corrected: worsening' }),
    ])
    expect(before).not.toEqual(after)
    expect(after[0].s).toBe('Corrected: worsening')
  })

  it('cacheInput is keyed on sessions content, not just the latest id + count', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/karute/ai-body-prediction.ts'), 'utf8')
    expect(src).toContain('sessions: predictionCacheSessions(dated),')
    expect(src).not.toContain('latest: dated[0]?.id ?? null,')
  })
})

describe('insights route cache — content-keyed', () => {
  it('cacheInput is keyed on record content (summary + entries), not ids alone', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/ai/insights/route.ts'), 'utf8')
    expect(src).not.toContain('ids: records.map((r) => r.id),')
    expect(src).toContain('s: r.summary,')
    // Everything else the prompt reads (fleet round 7/25): per-row name +
    // date, and the persona's business_type — a vertical switch must not
    // serve yesterday's persona for a day.
    expect(src).toContain('n: r.customerName,')
    expect(src).toContain('d: r.createdAt,')
    expect(src).toContain("bt: orgSettings?.business_type ?? null,")
    // Greptile P1 on #613: a transient settings failure must degrade to an
    // UNCACHED generic-persona response — never pin bt:null insights for a day.
    expect(src).toContain('settingsFailed = true')
    expect(src).toContain('if (!settingsFailed) {')
  })
})
