// Import-level exclusion of the settings sections whose tabs are PENDING
// this slice (design-parity packet 12 §S1: 店舗/スタッフ/同期/監査ログ).
// SettingsShell.tsx imports all ten settings sections unconditionally — the
// pendingTabIds runtime intercept (renderSection) ensures these four never
// actually RENDER in the thin shell, but Rollup still has to bundle whatever
// they (and their children — StoreFormDialog, StaffForm/PinSetup/
// VoiceEnrollmentDialog, InviteStaffDialog) statically import if the vite
// config doesn't also cut them at the import graph. That extra ~190 KB
// pushed the thin bundle over its budget (1579.1 KB measured vs the 1500 KB
// ceiling) for code that can never run this slice — same "code that must
// never render in the shell should not SHIP in the bundle" principle as
// purchase-excluded.tsx, applied to a rollout gate instead of a payments
// gate. Each excluded file's own top-level docs stay intact on disk; only
// the THIN build substitutes this null-render stand-in.
//
// Remove a name here (and its vite.config.ts entry) the same PR its tab
// leaves pendingTabIds and goes live.

const Excluded = (): null => null

export default Excluded
export const StoresSection = Excluded
export const StaffSection = Excluded
export const SyncSection = Excluded
export const AuditLogSection = Excluded
