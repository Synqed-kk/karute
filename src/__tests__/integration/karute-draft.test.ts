/**
 * @jest-environment jsdom
 *
 * Recording crash-recovery draft lifecycle. The draft is the ONLY surviving copy
 * of a transcript once the audio is deleted, so the save→load round-trip and the
 * Entry⇄KaruteDraftEntry field mapping must be exact — a mis-mapped field would
 * silently corrupt a recovered karute.
 */
import { saveDraft, loadDraft, clearDraft, type KaruteDraft } from '@/lib/karute/draft'

const baseDraft: Omit<KaruteDraft, 'savedAt'> = {
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

beforeEach(() => sessionStorage.clear())

describe('karute draft lifecycle', () => {
  it('save → load returns every field intact (stamps savedAt)', () => {
    saveDraft(baseDraft)
    const got = loadDraft()
    expect(got).not.toBeNull()
    expect(got!.transcript).toBe(baseDraft.transcript)
    expect(got!.summary).toBe(baseDraft.summary)
    expect(got!.entries).toEqual(baseDraft.entries)
    expect(got!.duration).toBe(3600)
    expect(got!.appointmentId).toBe('appt-1')
    expect(got!.appointmentCustomerId).toBe('cust-1')
    expect(typeof got!.savedAt).toBe('number')
  })

  it('clearDraft removes it', () => {
    saveDraft(baseDraft)
    clearDraft()
    expect(loadDraft()).toBeNull()
  })

  it('discards a draft older than the 24h TTL', () => {
    saveDraft(baseDraft)
    const raw = JSON.parse(sessionStorage.getItem('karute_draft')!) as KaruteDraft
    raw.savedAt = Date.now() - 25 * 60 * 60 * 1000
    sessionStorage.setItem('karute_draft', JSON.stringify(raw))
    expect(loadDraft()).toBeNull()
  })

  it('Entry → draft → Entry round-trip preserves the four fields (the restore mapping)', () => {
    // Mirrors ReviewScreen (save) and RecordPageView (restore) exactly.
    const original = {
      category: 'complaint' as const,
      title: '肩こり',
      source_quote: 'ひどい',
      confidence_score: 0.9,
    }
    // save-side map (Entry → KaruteDraftEntry)
    const stored = {
      category: original.category,
      content: original.title,
      sourceQuote: original.source_quote,
      confidenceScore: original.confidence_score,
    }
    saveDraft({ ...baseDraft, entries: [stored] })
    const back = loadDraft()!.entries[0]
    // restore-side map (KaruteDraftEntry → Entry)
    const restored = {
      category: back.category,
      title: back.content,
      source_quote: back.sourceQuote ?? '',
      confidence_score: back.confidenceScore,
    }
    expect(restored).toEqual(original)
  })
})
