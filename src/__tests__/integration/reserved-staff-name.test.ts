import { staffProfileSchema, RESERVED_STAFF_NAME } from '@/lib/validations/staff'
import { inviteSchema } from '@/lib/validations/invite'

// No person may be NAMED like a system row. The roster hides
// `full_name ILIKE '_system_%'` (case-insensitive) and the identity seam
// refuses `_system_removed_`, so a staff name carrying the prefix drops the
// person off the roster or locks them out. Both name writers refuse it: the
// staff edit/add schema and the invite schema (a fresh invite names the card).
const RESERVED = ['_system_x', '_SYSTEM_x', '_System_removed_北野', '  _system_x']
const staff = (name: string) => ({ name, position: '', email: '', phone: '' })
const invite = (name?: string) => ({ email: 'new@example.com', role: 'STYLIST', name })

describe('reserved staff names', () => {
  it.each(RESERVED)('the staff schema refuses %j', (name) => {
    expect(staffProfileSchema.safeParse(staff(name)).success).toBe(false)
  })

  it.each(RESERVED)('the invite schema refuses %j', (name) => {
    expect(inviteSchema.safeParse(invite(name)).success).toBe(false)
  })

  it('an ordinary name still passes both — including one that merely CONTAINS the word', () => {
    for (const name of ['北野 太郎', 'system_admin', 'Mika _system_']) {
      expect(staffProfileSchema.safeParse(staff(name)).success).toBe(true)
      expect(inviteSchema.safeParse(invite(name)).success).toBe(true)
    }
    // A re-invite carries no name at all.
    expect(inviteSchema.safeParse(invite(undefined)).success).toBe(true)
  })

  it('one home: the rule is the case-insensitive prefix', () => {
    expect(RESERVED_STAFF_NAME.flags).toContain('i')
    expect(RESERVED_STAFF_NAME.test('_SyStEm_')).toBe(true)
  })
})
