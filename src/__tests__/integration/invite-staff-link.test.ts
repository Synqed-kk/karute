import { chooseStaffToLink } from '@/lib/invites/link'

// The invite-duplicate bug: acceptInvite matched staff by EMAIL only and minted a
// brand-new staff row on no match — so re-inviting an existing person at a new
// email duplicated them and orphaned their history. The fix carries the existing
// staff id on the invite and LINKS that row. This helper is that decision.
describe('chooseStaffToLink', () => {
  const staff = [
    { id: 'staff-1', email: 'old@example.com' },
    { id: 'staff-2', email: null }, // one of the 6 staff with no email on file
    { id: 'staff-3', email: 'sato@example.com' },
  ]

  it('links the invited staff row by id even when the accept email differs', () => {
    expect(chooseStaffToLink('staff-1', 'brand-new@example.com', staff)).toBe('staff-1')
  })

  it('links a no-email staff row by id (the only safe path for emailless staff)', () => {
    expect(chooseStaffToLink('staff-2', 'whatever@example.com', staff)).toBe('staff-2')
  })

  it('falls back to email match when the invite carries no staff id', () => {
    expect(chooseStaffToLink(null, 'sato@example.com', staff)).toBe('staff-3')
  })

  it('is case-insensitive on the email fallback', () => {
    expect(chooseStaffToLink(null, 'SATO@Example.com', staff)).toBe('staff-3')
  })

  it('falls back to email match when the invited staff id is stale (row gone)', () => {
    expect(chooseStaffToLink('staff-deleted', 'sato@example.com', staff)).toBe('staff-3')
  })

  it('returns null (mint a new staff row) when nothing matches', () => {
    expect(chooseStaffToLink(null, 'nobody@example.com', staff)).toBeNull()
  })

  // The last edge case: re-inviting an ALREADY-LOGGED-IN person. The invite
  // dialog reads them off the roster under their PROFILE id (= their user_id),
  // not the synqed staff row id — so invited_staff_id is their user_id. Match
  // on user_id too or we fall through and mint a duplicate.
  describe('matching a signed-up teammate by user_id', () => {
    const linkedStaff = [
      { id: 'staff-1', user_id: 'user-aaa', email: 'old@example.com' },
      { id: 'staff-2', user_id: null, email: null }, // never signed up
      { id: 'staff-3', user_id: 'user-ccc', email: 'sato@example.com' },
    ]

    it('links by user_id when re-inviting a logged-in staff at a NEW email (no create)', () => {
      // invited_staff_id is the person's user_id; email is a fresh address.
      expect(chooseStaffToLink('user-aaa', 'brand-new@example.com', linkedStaff)).toBe('staff-1')
    })

    it('still links a no-login staff by row id (that path is unchanged)', () => {
      // No-login staff have user_id=null; invited_staff_id is the row id.
      expect(chooseStaffToLink('staff-2', 'whatever@example.com', linkedStaff)).toBe('staff-2')
    })

    it('never cross-links two different people: an unknown user_id falls through', () => {
      // A user_id belonging to nobody in this roster must not attach to another
      // person's row — it falls through to email (none) → null → mint fresh.
      expect(chooseStaffToLink('user-zzz', 'brand-new@example.com', linkedStaff)).toBeNull()
    })

    it('matches the right person when both a row id and a user_id are in play', () => {
      // 'user-ccc' is staff-3's login; must not resolve to staff-1.
      expect(chooseStaffToLink('user-ccc', 'brand-new@example.com', linkedStaff)).toBe('staff-3')
    })

    it('row id wins over user_id when one value could match both (deterministic precedence)', () => {
      // Pathological cross-space collision: one staff's row id equals another
      // staff's user_id. The row id (primary key) must win, and array order
      // must not decide. (Greptile, #377.)
      const colliding = [
        { id: 'staff-y', user_id: 'shared-id', email: null },
        { id: 'shared-id', user_id: 'user-x', email: null },
      ]
      expect(chooseStaffToLink('shared-id', 'new@example.com', colliding)).toBe('shared-id')
    })
  })
})
