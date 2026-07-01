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
})
