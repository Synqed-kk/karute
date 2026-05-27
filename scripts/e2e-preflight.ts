// Fails fast if synqed-core isn't reachable, so E2E doesn't surface a confusing
// Server-Component error mid-suite. Run as pretest:e2e.
async function main() {
  const url = process.env.SYNQED_CORE_URL ?? 'http://localhost:3100'
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null)
  if (!res) {
    console.error(`\n✖ synqed-core not reachable at ${url}\n  Start synqed-core (it must listen on :3100) before running E2E.\n`)
    process.exit(1)
  }
  console.log(`✓ synqed-core reachable at ${url}`)
}

main()
