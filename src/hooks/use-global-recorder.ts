'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { globalRecorder, type RecordingTarget } from '@/lib/global-recorder'

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
    /** Recording has run past the soft warning threshold (~2h). */
    overrun: globalRecorder.overrun,
    /** The hard cap auto-stopped + saved the recording (~2.5h). */
    autoStopped: globalRecorder.autoStopped,
    /** Customer/appointment the live recording is bound to (null when idle). */
    target: globalRecorder.target,
    startRecording: (opts?: { noiseSuppression?: boolean; target?: RecordingTarget | null }) =>
      globalRecorder.start(opts),
    stopRecording: () => globalRecorder.stop(),
    pauseRecording: () => globalRecorder.pause(),
    resumeRecording: () => globalRecorder.resume(),
    discardRecording: () => globalRecorder.discard(),
  }
}
