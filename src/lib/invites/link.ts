/**
 * Decide which existing staff row an accepted invite should attach to (the
 * caller then sets that row's user_id), or null to mint a new one.
 *
 * Order:
 *  1. The staff id the invite was launched from (the fix — works even when the
 *     account email differs or the staff has no email on file).
 *  2. Email match (legacy email-only invites for brand-new people).
 *  3. null → no existing row, create one.
 *
 * Resolving by id first is what stops re-inviting an existing person from
 * minting a duplicate and orphaning their history.
 */
export function chooseStaffToLink(
  invitedStaffId: string | null | undefined,
  email: string,
  staff: { id: string; email?: string | null }[],
): string | null {
  if (invitedStaffId) {
    const byId = staff.find((s) => s.id === invitedStaffId)
    if (byId) return byId.id
  }
  const target = email.toLowerCase()
  const byEmail = staff.find((s) => s.email && s.email.toLowerCase() === target)
  return byEmail ? byEmail.id : null
}
