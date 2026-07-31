// Recording privacy (#4). The raw transcript / recording audio of a karute is
// PRIVATE to the staff member who recorded it; the AI summary + entries are
// shared with the whole salon. This is the single decision point for "may this
// viewer see the raw recording", so the rule can't drift between the detail
// page and any future audio-playback route.

/**
 * Whether `viewerStaffId` may see the raw transcript/recording of a karute owned
 * by `ownerStaffId`.
 *
 *   - the recording staff always sees their own,
 *   - a supervisory role (recordings.viewAll → owner/manager) sees everyone's,
 *   - a record with NO owner (legacy / manual karute with no staff_id) is shared
 *     — there's no one to protect, and hiding it would strand old transcripts.
 */
export function canViewTranscript(opts: {
  ownerStaffId: string | null
  viewerStaffId: string | null
  canViewAll: boolean
}): boolean {
  const { ownerStaffId, viewerStaffId, canViewAll } = opts
  if (!ownerStaffId) return true
  if (canViewAll) return true
  return viewerStaffId != null && viewerStaffId === ownerStaffId
}
