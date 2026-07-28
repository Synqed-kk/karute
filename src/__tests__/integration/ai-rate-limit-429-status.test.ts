// 監査ログ Wave W1 fix round #2, test hardening #6 — pins enforceAiRateLimit's
// ONLY truthy return to a literal status 429. The four legacy /api/ai/*
// routes' rewrap comment (extract/summarize/suggestions/transcribe route.ts)
// says "status is always 429 here" and depends on that being a LITERAL for
// CP7's audit-writer walker (helpers/audit-emission.ts's
// hasStatusProperty4xx5xx exemption matches a numeric literal in the return
// expression's subtree, not a traced variable) — this is the tripwire: if
// enforceAiRateLimit ever grows a second truthy status (e.g. a distinct code
// for a daily-cost cap vs an hourly cap), the routes' shared assumption
// breaks silently unless something pins the CURRENT single-status contract.
//
// Imports the REAL enforceAiRateLimit (no module mock on '@/lib/ai-rate-limit'
// itself) — only its internal boundary ('@/lib/synqed/client'`s
// getSynqedClient, which owns the actual consume() check) is stubbed so the
// test never touches a real synqed-core call.
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    aiRateLimit: {
      consume: jest.fn(async () => ({
        allowed: false,
        reason: 'hourly',
        cap: 100,
        costCap: 500,
        costUsed: 500,
        resetAt: '2026-07-29T00:00:00.000Z',
      })),
    },
  })),
}))

import { enforceAiRateLimit } from '@/lib/ai-rate-limit'

describe('enforceAiRateLimit — 429 status pin', () => {
  it("returns a NextResponse with status 429 on its only truthy branch (the four routes' rewrap hardcodes this literal)", async () => {
    const res = await enforceAiRateLimit('extract')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
  })
})
