import { create } from 'zustand'

interface RecordingUIState {
  /** Signal to open the recording panel on dashboard */
  shouldOpenPanel: boolean
  requestOpenPanel: () => void
  clearOpenRequest: () => void
}

export const useRecordingUIStore = create<RecordingUIState>((set) => ({
  shouldOpenPanel: false,
  requestOpenPanel: () => set({ shouldOpenPanel: true }),
  clearOpenRequest: () => set({ shouldOpenPanel: false }),
}))
