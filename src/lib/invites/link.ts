/**
 * Decide which existing staff row an accepted invite should attach to (the
 * caller then sets that row's user_id), or null to mint a new one.
 *
 * Order:
 *  1. The staff the invite was launched from, matched by the synqed staff row
 *     id OR that person's user_id (the fix — works even when the account email
 *     differs or the staff has no email on file).
 *  2. Email match (legacy email-only invites for brand-new people).
 *  3. null → no existing row, create one.
 *
 * Why match user_id too: the roster the invite dialog reads lists an
 * already-signed-up teammate under their PROFILE id (= their auth user_id),
 * not the synqed staff row id — so `invited_staff_id` carries the user_id for
 * them. Matching row id alone would miss it, fall through, and mint a
 * duplicate when re-inviting a logged-in person at a new email. user_id is the
 * auth user id — unique per person — so it can never mis-link two people.
 *
 * Resolving by id/user_id first is what stops re-inviting an existing person
 * from minting a duplicate and orphaning their history.
 */
export function chooseStaffToLink(
  invitedStaffId: string | null | undefined,
  email: string,
  staff: { id: string; user_id?: string | null; email?: string | null }[],
): string | null {
  if (invitedStaffId) {
    const byIdentity = staff.find(
      (s) => s.id === invitedStaffId || s.user_id === invitedStaffId,
    )
    if (byIdentity) return byIdentity.id
  }
  const target = email.toLowerCase()
  const byEmail = staff.find((s) => s.email && s.email.toLowerCase() === target)
  return byEmail ? byEmail.id : null
}
