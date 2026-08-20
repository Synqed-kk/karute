// F8 direct over-cap rejection for the NEW recording-flow schemas (packet 08
// §Build 3). Every schema carries .max() caps from birth; send an over-cap /
// malformed payload and assert the validation error. Pure — no network.
import {
  ConsentGrantSchema,
  SessionMintSchema,
  TranscribeSchema,
  AiComputeSchema,
  SuggestionsSchema,
  SaveKaruteSchema,
  RecordingJobEnqueueSchema,
  MAX_STORED_TRANSCRIPT_CHARS,
} from '@/lib/app-api/record-schemas'

const over = (n: number) => 'x'.repeat(n)

describe('record-flow F8 schemas — over-cap / strict rejection', () => {
  it('ConsentGrant: bad method → fail; extra key → fail (strict)', () => {
    expect(ConsentGrantSchema.safeParse({ method: 'SMOKE' }).success).toBe(false)
    expect(ConsentGrantSchema.safeParse({ method: 'VERBAL', policy_version: 'x' }).success).toBe(false)
    expect(ConsentGrantSchema.safeParse({ method: 'VERBAL' }).success).toBe(true)
  })
  it('SessionMint: over-cap id → fail; extra key → fail', () => {
    expect(SessionMintSchema.safeParse({ customerId: over(201) }).success).toBe(false)
    expect(SessionMintSchema.safeParse({ evil: 'x' }).success).toBe(false)
    expect(SessionMintSchema.safeParse({}).success).toBe(true)
  })
  it('Transcribe: over-cap path → fail; URL-shaped over-cap → fail', () => {
    expect(TranscribeSchema.safeParse({ path: over(301) }).success).toBe(false)
    expect(TranscribeSchema.safeParse({ path: 'app_business-1_x.webm', locale: 'ja' }).success).toBe(true)
  })
  it('AiCompute: over-cap transcript → fail', () => {
    expect(AiComputeSchema.safeParse({ transcript: over(MAX_STORED_TRANSCRIPT_CHARS + 1) }).success).toBe(false)
    expect(AiComputeSchema.safeParse({ transcript: 'ok', locale: 'ja' }).success).toBe(true)
  })
  it('Suggestions: over-cap transcript → fail', () => {
    expect(SuggestionsSchema.safeParse({ transcript: over(MAX_STORED_TRANSCRIPT_CHARS + 1) }).success).toBe(false)
    expect(SuggestionsSchema.safeParse({ summary: 'ok' }).success).toBe(true)
  })
  // PR-B2 — an auto-finishing recovery take enqueues with NO answer at all.
  // The wire body is JSON, so `outcome: undefined` disappears entirely; this
  // pins that the .strict() schema takes that shape, and still refuses EITHER
  // client-side-only marker if one ever leaked onto the body.
  it('RecordingJobEnqueue: an outcome-less body passes; a leaked client-only flag does not', () => {
    const wire = JSON.parse(
      JSON.stringify({
        recordingSessionId: 'sess-1',
        customerId: 'cust-1',
        audioPath: 'app_business-1_x.webm',
        appointmentId: undefined,
        locale: 'ja',
        durationSeconds: undefined,
        outcome: undefined,
      }),
    )
    expect(RecordingJobEnqueueSchema.safeParse(wire).success).toBe(true)
    for (const leaked of ['recoveryUnanswered', 'autoFinish']) {
      expect(
        RecordingJobEnqueueSchema.safeParse({ ...wire, [leaked]: true }).success,
      ).toBe(false)
    }
  })

  it('SaveKarute: over-cap transcript → fail; spoofed extra key → fail', () => {
    const base = { customerId: 'c1', transcript: 'ok', summary: 's', entries: [] }
    expect(SaveKaruteSchema.safeParse({ ...base, transcript: over(MAX_STORED_TRANSCRIPT_CHARS + 1) }).success).toBe(false)
    expect(SaveKaruteSchema.safeParse({ ...base, businessId: 'other-tenant' }).success).toBe(false)
    expect(SaveKaruteSchema.safeParse(base).success).toBe(true)
  })
})
