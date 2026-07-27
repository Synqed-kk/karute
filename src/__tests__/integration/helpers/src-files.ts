// Shared source-file enumerator — CP3/CP4/CP7 all need the same "every
// non-test .ts/.tsx file under src/" walk. Skips the canonical
// src/__tests__ root (contract §8 fix round 1 #1) — a directory literally
// named __tests__ at any OTHER depth (e.g. a fixtures/mocks dir a real
// module imports) is still scanned; the old any-depth skip let production
// code hiding there escape every proof. Also skips any dir named
// node_modules (local-install strays; blind-round wording fix 2026-07-28):
// a COMMITTED src/**/node_modules would be invisible to these jest-hosted
// proofs — same shadow-dir class the audit-gates job's find-purge kills.
// Committed node_modules is banned repo-wide and none exist (git ls-files
// verified).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** `srcRoot` is the absolute path to the `src` directory itself. */
export function srcFiles(srcRoot: string): string[] {
  const out: string[] = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue
      const full = join(dir, entry)
      if (full === join(srcRoot, '__tests__')) continue
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
        out.push(full)
      }
    }
  }
  walk(srcRoot)
  return out
}
