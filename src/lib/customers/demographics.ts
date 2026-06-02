// Customer demographic helpers — derive display values from the deep-crawl
// fields (date_of_birth, gender) QuickReserve now provides via synqed-core.
//
// Design decisions (see PLAN-deep-data-integration.md):
//   • Age is ALWAYS derived from DOB at render time — never stored, never the
//     editable field. Only DOB is ever editable (write side still pending
//     Anthony's columns). This keeps age from going stale.
//   • gender arrives as 'male' | 'female' | null (QR code 0 → null), mapped to
//     JP labels for display. Render nothing when null (don't show a dash).

/** Age in whole years from an ISO date string ('YYYY-MM-DD'), or null. */
export function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const monthDelta = now.getMonth() - d.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d.getDate())) {
    age -= 1
  }
  // Guard against bad data (future DOB, parse garbage) so we never render a
  // negative or absurd age.
  return age >= 0 && age < 130 ? age : null
}

/** 'male' → '男性', 'female' → '女性', anything else → null (render nothing). */
export function jpGender(gender: string | null | undefined): string | null {
  if (gender === 'male') return '男性'
  if (gender === 'female') return '女性'
  return null
}

/** True when the customer's birthday falls in the current month — drives the
 *  🎂 誕生月 chip / birthday-campaign hook. */
export function isBirthdayMonth(dob: string | null | undefined): boolean {
  if (!dob) return false
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return false
  return d.getMonth() === new Date().getMonth()
}
