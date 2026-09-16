/**
 * Post-#945 follow-up: RecordPageView's repoint-to-searched-customer handler
 * built its `customerName` inline from `name || customers.find(...)?.name ||
 * unknownLabel`, with zero direct test coverage (RecordPageView is too big
 * to render in a test — blind-read finding 2, fix/picker-remote-selected).
 * Lifted here as a pure function so the exact fallback order — an explicit
 * `name` from the picker row wins, THEN a local-list lookup, THEN the
 * unknown label — is pinned independently of the screen around it.
 *
 * `||`, not `??`: `name` is a plain `string | undefined` with no guarantee
 * against `''`, and an empty string must fall through to the next tier
 * rather than winning and rendering a blank customer name (the branch's own
 * `??` → `||` revert commit).
 */
export function pickedCustomerName(
  name: string | undefined,
  customers: readonly { id: string; name: string }[],
  id: string,
  unknownLabel: string,
): string {
  return name || customers.find((c) => c.id === id)?.name || unknownLabel
}
