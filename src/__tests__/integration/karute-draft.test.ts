/**
 * @jest-environment jsdom
 *
 * Recording crash-recovery draft lifecycle. The draft is the ONLY surviving copy
 * of a transcript once the audio is deleted, so the save→load round-trip and the
 * Entry⇄KaruteDraftEntry field mapping must be exact — a mis-mapped field would
 * silently corrupt a recovered karute.
 *
 * ALSO pins the shared-device privacy gate: a draft is stamped with the auth
 * user who saved it and is only ever returned to that same user; a mismatch or a
 * signed-out reader gets null.
 */

// Mutable mocked signed-in user — drives the ownership gate in draft.ts.
let mockUserId: string | null = 'staff-A'
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: mockUserId ? { user: { id: mockUserId } } : null },
      }),
    },
  }),
}))

import { saveDraft, loadDraft, clearDraft, type KaruteDraft } from '@/lib/karute/draft'

const baseDraft: Omit<KaruteDraft, 'savedAt' | 'savedByStaffId'> = {
  transcript: '肩こりがひどいとのこと。',
  summary: '肩こり主訴、6回券2回目。',
  entries: [
    { category: 'complaint', content: '肩こり', sourceQuote: 'ひどい', confidenceScore: 0.9 },
    { category: 'plan', content: '次回もみほぐし', confidenceScore: 0.7 },
  ],
  duration: 3600,
  appointmentId: 'appt-1',
  appointmentCustomerId: 'cust-1',
}

beforeEach(() => {
  localStorage.clear()
  mockUserId = 'staff-A'
})

describe('karute draft lifecycle', () => {
  it('save → load (same user) returns every field intact (stamps savedAt + owner)', async () => {
    await saveDraft(baseDraft)
    const got = await loadDraft()
    expect(got).not.toBeNull()
    expect(got!.transcript).toBe(baseDraft.transcript)
    expect(got!.summary).toBe(baseDraft.summary)
    expect(got!.entries).toEqual(baseDraft.entries)
    expect(got!.duration).toBe(3600)
    expect(got!.appointmentId).toBe('appt-1')
    expect(got!.appointmentCustomerId).toBe('cust-1')
    expect(typeof got!.savedAt).toBe('number')
    expect(got!.savedByStaffId).toBe('staff-A')
  })

  it('clearDraft removes it', async () => {
    await saveDraft(baseDraft)
    clearDraft()
    expect(await loadDraft()).toBeNull()
  })

  it('discards a draft older than the 24h TTL', async () => {
    await saveDraft(baseDraft)
    const raw = JSON.parse(localStorage.getItem('karute_draft')!) as KaruteDraft
    raw.savedAt = Date.now() - 25 * 60 * 60 * 1000
    localStorage.setItem('karute_draft', JSON.stringify(raw))
    expect(await loadDraft()).toBeNull()
  })

  it('round-trips recordingSessionId — required for a crash-recovered draft to still dedupe on save', async () => {
    await saveDraft({ ...baseDraft, recordingSessionId: 'rs-1' })
    const got = await loadDraft()
    expect(got!.recordingSessionId).toBe('rs-1')
  })

  it('leaves recordingSessionId undefined when the take never got one (mint failed/timed out)', async () => {
    await saveDraft(baseDraft)
    const got = await loadDraft()
    expect(got!.recordingSessionId).toBeUndefined()
  })

  it('Entry → draft → Entry round-trip preserves the four fields (the restore mapping)', async () => {
    // Mirrors ReviewScreen (save) and RecordPageView (restore) exactly.
    const original = {
      category: 'complaint' as const,
      title: '肩こり',
      source_quote: 'ひどい',
      confidence_score: 0.9,
    }
    const stored = {
      category: original.category,
      content: original.title,
      sourceQuote: original.source_quote,
      confidenceScore: original.confidence_score,
    }
    await saveDraft({ ...baseDraft, entries: [stored] })
    const back = (await loadDraft())!.entries[0]
    const restored = {
      category: back.category,
      title: back.content,
      source_quote: back.sourceQuote ?? '',
      confidence_score: back.confidenceScore,
    }
    expect(restored).toEqual(original)
  })
})

describe('shared-device privacy gate', () => {
  it('a DIFFERENT staff member does not receive the draft', async () => {
    await saveDraft(baseDraft) // saved as staff-A
    mockUserId = 'staff-B' // staff-B now signed in on the same device
    expect(await loadDraft()).toBeNull()
  })

  it('does NOT delete the draft on a foreign read — the owner can still recover it', async () => {
    await saveDraft(baseDraft) // staff-A
    mockUserId = 'staff-B'
    expect(await loadDraft()).toBeNull() // hidden from B
    mockUserId = 'staff-A' // owner returns (e.g. B logs out, A logs back in)
    const got = await loadDraft()
    expect(got).not.toBeNull()
    expect(got!.transcript).toBe(baseDraft.transcript)
  })

  it('a signed-out reader receives nothing', async () => {
    await saveDraft(baseDraft) // staff-A
    mockUserId = null // signed out
    expect(await loadDraft()).toBeNull()
  })

  it('an un-owned legacy draft (no savedByStaffId) is never restored', async () => {
    // Simulate a pre-binding draft written by an older build.
    const legacy = { ...baseDraft, savedAt: Date.now() }
    localStorage.setItem('karute_draft', JSON.stringify(legacy))
    expect(await loadDraft()).toBeNull()
  })

  it('a draft saved while signed out has no owner and is not restorable', async () => {
    mockUserId = null
    await saveDraft(baseDraft) // no user → savedByStaffId undefined
    mockUserId = 'staff-A'
    expect(await loadDraft()).toBeNull()
  })
})
