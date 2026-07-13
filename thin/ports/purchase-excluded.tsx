// Import-level exclusion of purchase surfaces from the thin bundle (build #7,
// §1.5 payments canon). "Code that must never render in the shell should not
// SHIP in the bundle" — runtime WebOnly/isNativeShell gating is belt-and-braces,
// but the strongest guarantee is the App-Store-sensitive component code never
// entering the binary at all. The vite config aliases the purchase-surface
// modules (PlanComparisonGrid + the subscription purchase dialogs) to this file,
// so the bundler tree-shakes the real code out and only these null renders remain.
//
// A named `PlanComparisonGrid` covers the named import; the default covers any
// default import. Add a name here if a newly-aliased purchase module needs it.

const Excluded = (): null => null

export default Excluded
export const PlanComparisonGrid = Excluded
export const CancelConfirmDialog = Excluded
export const PaymentUpdateDialog = Excluded
export const AddStoreSubscriptionDialog = Excluded
export const PlanComparisonDialog = Excluded
