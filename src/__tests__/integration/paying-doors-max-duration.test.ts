/**
 * ⚖ S115 (N2 + N5) — EVERY PAYING DOOR PINS ITS maxDuration. The transcription lease's TTL
 * (TRANSCRIPT_LEASE_TTL_MS, 330 s) is sized against a 300 s function: a door left on a platform
 * default could outlive its lease while paying. A server action runs under its PAGE's limit, so the
 * web discard-transcript action is pinned on the one page that calls it (sessions → RecordPageView).
 * Read from the source, so a route's heavy imports never have to load here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

const DOORS: Array<[string, string]> = [
  ['web /api/ai/transcribe', 'src/app/api/ai/transcribe/route.ts'],
  ['phone /api/app/v1/ai/transcribe', 'src/app/api/app/v1/ai/transcribe/route.ts'],
  ['phone discard transcript', 'src/app/api/app/v1/recordings/discards/transcript/route.ts'],
  ['the worker /api/jobs/process', 'src/app/api/jobs/process/route.ts'],
  ['web discard-transcript server action (its page)', 'src/app/[locale]/(app)/sessions/page.tsx'],
]

describe('every paying door pins maxDuration below the lease TTL', () => {
  it.each(DOORS)('%s → export const maxDuration = 300', (_door, file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    const m = src.match(/^export const maxDuration = (\d+)\s*$/m)
    expect(m?.[1]).toBe('300')
    expect(Number(m![1]) * 1000).toBeLessThan(TRANSCRIPT_LEASE_TTL_MS)
  })

  it('the web discard action is called only from RecordPageView, rendered only by the sessions page', () => {
    const view = readFileSync(join(process.cwd(), 'src/components/karute/redesign/record/RecordPageView.tsx'), 'utf8')
    expect(view).toMatch(/from '@\/lib\/recording\/discard-transcript'/)
    expect(readFileSync(join(process.cwd(), 'src/app/[locale]/(app)/sessions/page.tsx'), 'utf8')).toMatch(/RecordPageView/)
  })
})
