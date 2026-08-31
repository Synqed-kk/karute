// Import-level exclusion of the settings sections whose tabs must never
// render in the thin shell (design-parity packet 12 §S1/§B-3 S2, packet 17
// §S3, §S4b — 店舗 moved OUT at S2, 監査ログ at packet 17 §S3, スタッフ at
// packet 12 §B-3 S4b, 破棄の記録 at the phone-facade packet — 店舗, 監査ログ,
// スタッフ and 破棄の記録 are all live now; 同期 stays permanently web-only per
// packet 20 §S5, as does メニュー. Named rather than counted: the sibling
// comments in thin/vite.config.ts and thin/screens/SettingsScreen.tsx track
// DIFFERENT lists, and three running totals drift apart on the first commit
// that moves one of them.) SettingsShell.tsx imports all ten settings sections
// unconditionally — the webOnlyTabIds/pendingTabIds runtime
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
//
// MenusSection (menu-catalog lane PR-2): permanently web-only for fork A —
// menu editing lives on the computer (plan §8); the phone gets the booking
// picker in PR-4b, never this section.

const Excluded = (): null => null

export default Excluded
export const SyncSection = Excluded
export const MenusSection = Excluded
