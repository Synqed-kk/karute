// Japanese fallback labels for raw staff authority codes (the legacy STYLIST
// enum family + the lowercase RBAC presets). A staff member's own 役職
// (profiles.position, business-type-aware picker) always wins over these —
// this map only covers staff whose title hasn't been set yet, so UI surfaces
// like the reservation grid never leak a raw code such as "STYLIST".
const ROLE_LABELS: Record<string, string> = {
  stylist: '施術者',
  assistant: 'アシスタント',
  owner: 'オーナー',
  admin: '管理者',
  manager: 'マネージャー',
  senior: 'シニアスタッフ',
  practitioner: '施術者',
  reception: '受付',
  frontdesk: '受付',
  staff: 'スタッフ',
}

/** Map a role code to its Japanese display label. Unknown latin identifiers
 *  return '' (hide, never leak a code); anything already human-readable
 *  (e.g. a custom Japanese title stored in the role field) passes through. */
export function staffRoleLabel(code?: string | null): string {
  if (!code) return ''
  const mapped = ROLE_LABELS[code.toLowerCase()]
  if (mapped) return mapped
  return /^[A-Za-z_ -]+$/.test(code) ? '' : code
}
