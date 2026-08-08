// Karute-scoped photo display (packet PR 9a/9b, Liam's ruling): a karute
// detail screen shows ONLY the photos taken in ITS recording session — never
// the customer's whole gallery (that aggregate view is the customer page /
// customer screen, untouched). Single source of truth for both the web page
// (PhotoRecordsServer) and the device screen facade
// (app/api/app/v1/screens/karute/[id]/route.ts).

/** Filters a customer's photo list down to one karute's recording session.
 *  ponytail: a karute with no recording_session_id (legacy record, or the
 *  link hasn't been stamped yet — camera-row PR 9b does that) shows ZERO
 *  photos, never the unscoped list — the null rule lives here, once. */
export function scopeKarutePhotos<T extends { recording_session_id: string | null }>(
  photos: T[],
  recordingSessionId: string | null,
): T[] {
  if (recordingSessionId === null) return []
  return photos.filter((p) => p.recording_session_id === recordingSessionId)
}
