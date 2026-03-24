'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { globalRecorder } from '@/lib/global-recorder'

export function useGlobalRecorder() {
  const subscribe = useCallback(
    (fn: () => void) => globalRecorder.subscribe(fn),
    []
  )

  // Return a primitive (version number) so useSyncExternalStore
  // doesn't infinite-loop comparing new object references
  const getSnapshot = useCallback(() => globalRecorder.version, [])
  const getServerSnapshot = useCallback(() => 0, [])

  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    state: globalRecorder.state,
    result: globalRecorder.result,
    error: globalRecorder.error,
    stream: globalRecorder.stream,
    startedAt: globalRecorder.startedAt,
    startRecording: () => globalRecorder.start(),
    stopRecording: () => globalRecorder.stop(),
    pauseRecording: () => globalRecorder.pause(),
    resumeRecording: () => globalRecorder.resume(),
    discardRecording: () => globalRecorder.discard(),
  }
}
