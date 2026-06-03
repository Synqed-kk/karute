import { inviteSchema, acceptInviteSchema, INVITE_ROLES } from '@/lib/validations/invite'

// Security-relevant invariants for the staff-invite flow. The heavier action
// paths (token rejection, server-side customer_id attach) are exercised against
// a live DB during Anthony's Phase-0 verification — the migration can't run in
// jest. These lock the pure rules that gate the flow.
describe('invite validation', () => {
  it('normalizes email (trim + lowercase) and accepts a valid role', () => {
    const r = inviteSchema.safeParse({ email: '  Staff@Example.COM ', role: 'STYLIST' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('staff@example.com')
  })

  it('rejects a malformed email', () => {
    expect(inviteSchema.safeParse({ email: 'not-an-email', role: 'STYLIST' }).success).toBe(false)
  })

  it('NEVER allows inviting an OWNER (no privilege escalation via invite)', () => {
    expect(INVITE_ROLES).not.toContain('OWNER')
    expect(inviteSchema.safeParse({ email: 'a@b.com', role: 'OWNER' }).success).toBe(false)
  })

  it('only allows the three non-owner roles', () => {
    expect([...INVITE_ROLES].sort()).toEqual(['ADMIN', 'ASSISTANT', 'STYLIST'])
  })

  it('requires an 8+ character password to accept an invite', () => {
    const tok = 'a'.repeat(32)
    expect(acceptInviteSchema.safeParse({ token: tok, password: 'short' }).success).toBe(false)
    expect(acceptInviteSchema.safeParse({ token: tok, password: 'longenough' }).success).toBe(true)
  })
})
