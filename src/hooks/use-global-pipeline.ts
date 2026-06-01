'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { globalPipeline, type PipelineContext } from '@/lib/global-pipeline'

/**
 * Subscribe to the background AI pipeline. Mirrors useGlobalRecorder — returns
 * a primitive (version) to useSyncExternalStore so it doesn't loop on object
 * identity, then reads the live fields off the singleton.
 */
export function useGlobalPipeline() {
  const subscribe = useCallback((fn: () => void) => globalPipeline.subscribe(fn), [])
  const getSnapshot = useCallback(() => globalPipeline.version, [])
  const getServerSnapshot = useCallback(() => 0, [])

  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    state: globalPipeline.state,
    step: globalPipeline.step,
    result: globalPipeline.result,
    error: globalPipeline.error,
    context: globalPipeline.context,
    start: (blob: Blob, ctx: PipelineContext) => globalPipeline.start(blob, ctx),
    retry: () => globalPipeline.retry(),
    reset: () => globalPipeline.reset(),
  }
}
