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
    /** Server-minted recording_sessions id for the live/last recording, once
     *  resolved (null until then, or forever on failure). */
    recordingSessionId: globalRecorder.recordingSessionId,
    startRecording: (opts?: { noiseSuppression?: boolean; target?: RecordingTarget | null }) =>
      globalRecorder.start(opts),
    stopRecording: () => globalRecorder.stop(),
    pauseRecording: () => globalRecorder.pause(),
    resumeRecording: () => globalRecorder.resume(),
    discardRecording: () => globalRecorder.discard(),
    /** Await the recording-session mint briefly at save time (bounded — never
     *  blocks the save indefinitely). See GlobalRecorder.awaitRecordingSessionId. */
    awaitRecordingSessionId: (timeoutMs?: number) =>
      globalRecorder.awaitRecordingSessionId(timeoutMs),
  }
}
