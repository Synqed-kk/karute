// Import-level exclusion of the settings sections whose tabs must never
// render in the thin shell (design-parity packet 12 §S1/§B-3 S2, packet 17
// §S3, §S4b — 店舗 moved OUT at S2, 監査ログ at packet 17 §S3, スタッフ at
// packet 12 §B-3 S4b, all three tabs now live; 同期 stays permanently
// web-only per packet 20 §S5). SettingsShell.tsx imports all ten settings
// sections unconditionally — the webOnlyTabIds/pendingTabIds runtime
// intercepts (renderSection) ensure this one never actually RENDERS in the
// thin shell, but Rollup still has to bundle whatever it statically imports if
// the vite config doesn't also cut it at the import graph. That extra
// bundle weight pushed the thin bundle over its budget for code that can
// never run this slice — same "code that must never render in the shell
// should not SHIP in the bundle" principle as purchase-excluded.tsx,
// applied to a rollout gate instead of a payments gate. Each excluded
// file's own top-level docs stay intact on disk; only the THIN build
// substitutes this null-render stand-in.
//
// Remove a name here (and its vite.config.ts entry) the same PR its tab
// leaves pendingTabIds/webOnlyTabIds and goes live.

const Excluded = (): null => null

export default Excluded
export const SyncSection = Excluded
