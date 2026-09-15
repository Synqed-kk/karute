import type { AuditEvent } from '@synqed-kk/client'

/** Layer A's memory (PACKET-MIC-SILENCE-LAYER-A-2026-09-11.md subject 2):
 *  true only when a PRIOR round already proved THIS exact audio object
 *  silent — a different retake, a different failure reason, or a
 *  pre-Layer-A row (no audio_path yet) never match. */
export function hasRememberedEmptyTranscript(events: AuditEvent[], audioPath: string): boolean {
  if (!audioPath) return false
  return events.some((e) => {
    const d = e.detail as { reason?: unknown; audio_path?: unknown } | null | undefined
    return (
      e.action === 'recording.transcribe_failed' &&
      d?.reason === 'empty_transcript' &&
      d?.audio_path === audioPath
    )
  })
}
