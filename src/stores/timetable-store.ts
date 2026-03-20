import { create } from 'zustand'

export type BarType = 'booking' | 'blocked' | 'open' | 'completed' | 'recording' | 'processing'

export interface TimelineBar {
  id: string
  rowId: string
  startMinute: number
  durationMinute: number
  title: string
  subtitle?: string
  type: BarType
}

interface TimetableState {
  bars: TimelineBar[]
  recordingBarId: string | null
  recordingStartMinute: number | null
  /** The temp ID of the most recently stopped recording bar (for pipeline/save flow) */
  lastRecordingBarId: string | null
  startRecordingBar: (staffId: string) => void
  stopRecordingBar: () => string | null
  tickRecordingBar: () => void
  setBars: (bars: TimelineBar[]) => void
  /** Change a bar's type (e.g. recording → processing) */
  setBarType: (barId: string, type: BarType, title?: string) => void
  /** Replace a temp bar ID with a real karute record ID and set to booking */
  finalizeBar: (tempId: string, realId: string) => void
  /** Remove a bar by ID (e.g. on discard) */
  removeBar: (barId: string) => void
}

function nowMinute() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function formatTime(minute: number) {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

export const useTimetableStore = create<TimetableState>((set, get) => ({
  bars: [],
  recordingBarId: null,
  recordingStartMinute: null,
  lastRecordingBarId: null,

  startRecordingBar: (staffId: string) => {
    const start = nowMinute()
    const tempId = `rec_${Date.now()}`
    const bar: TimelineBar = {
      id: tempId,
      rowId: staffId,
      startMinute: start,
      durationMinute: 1,
      title: 'Recording...',
      type: 'recording',
    }
    set((state) => ({
      bars: [...state.bars, bar],
      recordingBarId: tempId,
      recordingStartMinute: start,
      lastRecordingBarId: null,
    }))
  },

  stopRecordingBar: () => {
    const { recordingBarId, recordingStartMinute } = get()
    if (!recordingBarId || recordingStartMinute === null) return null

    const end = nowMinute()
    const duration = Math.max(1, end - recordingStartMinute)
    const startLabel = formatTime(recordingStartMinute)
    const endLabel = formatTime(end)

    set((state) => ({
      bars: state.bars.map((b) =>
        b.id === recordingBarId
          ? {
              ...b,
              durationMinute: duration,
              title: `${startLabel}-${endLabel}`,
              subtitle: 'Stopped',
              type: 'recording' as const,
            }
          : b
      ),
      recordingBarId: null,
      recordingStartMinute: null,
      lastRecordingBarId: recordingBarId,
    }))

    return recordingBarId
  },

  tickRecordingBar: () => {
    const { recordingBarId, recordingStartMinute } = get()
    if (!recordingBarId || recordingStartMinute === null) return

    const now = nowMinute()
    const duration = Math.max(1, now - recordingStartMinute)

    set((state) => ({
      bars: state.bars.map((b) =>
        b.id === recordingBarId
          ? { ...b, durationMinute: duration }
          : b
      ),
    }))
  },

  setBarType: (barId: string, type: BarType, title?: string) => {
    set((state) => ({
      bars: state.bars.map((b) =>
        b.id === barId
          ? { ...b, type, ...(title !== undefined ? { title } : {}) }
          : b
      ),
    }))
  },

  finalizeBar: (tempId: string, realId: string) => {
    set((state) => ({
      bars: state.bars.map((b) =>
        b.id === tempId
          ? { ...b, id: realId, type: 'booking' as const }
          : b
      ),
      lastRecordingBarId: state.lastRecordingBarId === tempId ? realId : state.lastRecordingBarId,
    }))
  },

  removeBar: (barId: string) => {
    set((state) => ({
      bars: state.bars.filter((b) => b.id !== barId),
      lastRecordingBarId: state.lastRecordingBarId === barId ? null : state.lastRecordingBarId,
    }))
  },

  setBars: (bars) => set({ bars }),
}))
