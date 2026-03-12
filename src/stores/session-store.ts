import { create } from 'zustand'
import type { TranscriptSegment, KaruteEntryData } from '@/components/karute'

// ============================================================================
// TYPES
// ============================================================================

export type SessionStep =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'classifying'
  | 'review'
  | 'exported'

export interface SessionState {
  step: SessionStep
  audioBlob: Blob | null
  segments: TranscriptSegment[]
  entries: KaruteEntryData[]
  aiSummary: string | null
  customerName: string
  staffName: string
  date: string
  error: string | null
}

export interface SessionActions {
  setAudioBlob: (blob: Blob) => void
  setTranscription: (segments: TranscriptSegment[]) => void
  setClassification: (entries: KaruteEntryData[], summary: string) => void
  updateEntry: (id: string, content: string) => void
  deleteEntry: (id: string) => void
  addEntry: (entry: KaruteEntryData) => void
  setCustomerName: (name: string) => void
  setStaffName: (name: string) => void
  setExported: () => void
  setError: (msg: string) => void
  reset: () => void
}

// ============================================================================
// HELPERS
// ============================================================================

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const initialState: SessionState = {
  step: 'idle',
  audioBlob: null,
  segments: [],
  entries: [],
  aiSummary: null,
  customerName: '',
  staffName: '',
  date: todayISO(),
  error: null,
}

// ============================================================================
// STORE
// ============================================================================

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  ...initialState,

  setAudioBlob: (blob) =>
    set({ audioBlob: blob, step: 'transcribing', error: null }),

  setTranscription: (segments) =>
    set({ segments, step: 'classifying', error: null }),

  setClassification: (entries, summary) =>
    set({ entries, aiSummary: summary, step: 'review', error: null }),

  updateEntry: (id, content) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, content } : e
      ),
    })),

  deleteEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    })),

  addEntry: (entry) =>
    set((state) => ({
      entries: [...state.entries, entry],
    })),

  setCustomerName: (name) => set({ customerName: name }),

  setStaffName: (name) => set({ staffName: name }),

  setExported: () => set({ step: 'exported' }),

  setError: (msg) => set({ error: msg }),

  reset: () => set({ ...initialState, date: todayISO() }),
}))
