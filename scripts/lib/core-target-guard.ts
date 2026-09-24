// The guard in front of the TEST seeder (seed-booking-data.ts) and its e2e
// entry (e2e/global-setup.ts).
// Deliberately NOT guarded: scripts/import/final-reconcile.mjs, final-pass.mjs (manual real-core imports).
//
// seed-booking-data.ts deletes every appointment + customer of the dev
// business it resolves. Pointed at the shared core it wiped the Dev Salon test
// world (9/15–9/20). This refuses any core URL whose host is not a local,
// non-shared instance — before any client is built, before any fetch.
//
// The list is code on purpose: no env escape hatch, no --force, no file.
// An allowlist a wiper can edit at run time is not a guard; widening it is a
// reviewed code change like this one. Exact hostname match only.
export const LOCAL_CORE_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]', // URL.hostname keeps the brackets for IPv6 literals
  'host.docker.internal',
] as const

export function assertLocalCoreTarget(url: string | undefined): void {
  const allowed = LOCAL_CORE_HOSTS.join(', ')
  let host: string
  try {
    host = new URL(url ?? '').hostname
  } catch {
    throw new Error(
      `SEEDER REFUSED: SYNQED_CORE_URL is missing or not a URL. This script deletes core data and only runs against a local core (${allowed}).`,
    )
  }
  if (!(LOCAL_CORE_HOSTS as readonly string[]).includes(host)) {
    throw new Error(
      `SEEDER REFUSED: core host "${host}" is not a local core. This script deletes core data and only runs against: ${allowed}.`,
    )
  }
}
