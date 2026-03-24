'use client'

import { useSyncExternalStore, useCallback } from 'react'
import { globalRecorder } from '@/lib/global-recorder'

/**
 * React hook that subscribes to the global MediaRecorder singleton.
 * Recording persists across page navigations.
 */
export function useGlobalRecorder() {
  const subscribe = useCallback((fn: () => void) => globalRecorder.subscribe(fn), [])
  const getSnapshot = useCallback(() => ({
    state: globalRecorder.state,
    result: globalRecorder.result,
    error: globalRecorder.error,
    stream: globalRecorder.stream,
    startedAt: globalRecorder.startedAt,
  }), [])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    ...snapshot,
    startRecording: () => globalRecorder.start(),
    stopRecording: () => globalRecorder.stop(),
    pauseRecording: () => globalRecorder.pause(),
    resumeRecording: () => globalRecorder.resume(),
    discardRecording: () => globalRecorder.discard(),
  }
}
