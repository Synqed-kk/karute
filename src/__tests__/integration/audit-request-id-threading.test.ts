// CP5 — threading (contract §7/§8, PR-M5 piece ④/⑤). Every audit()/auditWeb()
// call site in web/job code must carry a requestId so a durable row can be
// correlated back to the request/job that produced it — the census this PR's
// packet found (~15 files) DROPPED requestId at every one of them. This walks
// the same surfaces the census grep covered (src/lib, src/actions,
// src/app/api — excluding audit.ts/audit-web.ts themselves, the emitter/
// wrapper infrastructure, not call sites) and fails loud for any audit(/
// auditWeb( call whose argument object doesn't mention `requestId` AND isn't
// marked with a `// no-request-scope:` comment in the few lines above it
// (pin-throttle.ts's pre-auth lockout — no request scope exists there).
//
// Ships hard-fail from the start (packet: "review-flag-soft then flips hard
// in the SAME PR once the backfill is green" — the backfill lands in this
// same PR, so the end state is simply a green hard-fail test, same method as
// facade-audit-totality.test.ts's route walk).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/lib', 'src/actions', 'src/app/api'].map((r) => join(process.cwd(), r))
// The emitter + its web wrapper — infrastructure, not call sites (their own
// internal `audit({...e, ...})` forwards a caller-supplied requestId via
// spread; nothing to scan there per the packet's census command).
const EXCLUDED = new Set(['audit.ts', 'audit-web.ts'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    if (EXCLUDED.has(entry)) continue
    out.push(full)
  }
  return out
}

interface CallSite {
  /** 1-based line the call opens on, for a readable offender message. */
  line: number
  /** The call's full argument text (from the opening `{` to its matching `}`). */
  args: string
  /** True when a `// no-request-scope:` marker sits in the few lines above. */
  documentedSkip: boolean
}

/** Finds every `audit({...})` / `auditWeb({...})` call in `src` — a real
 *  invocation, not a comment or a `synqed.audit.list(...)` SDK call (both of
 *  those never have `audit(` immediately followed by `{`). Balanced-brace
 *  scan from the opening `{` (not a naive regex) so a nested object/array in
 *  the detail payload — or a `crypto.randomUUID()` call inside it — can't
 *  truncate the match early. */
function callSites(src: string): CallSite[] {
  const sites: CallSite[] = []
  const re = /\b(?:auditWeb|audit)\(\s*\{/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const braceStart = src.indexOf('{', m.index)
    let depth = 0
    let end = braceStart
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++
      else if (src[end] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const args = src.slice(braceStart, end + 1)
    const before = src.slice(0, m.index)
    const line = before.split('\n').length
    const precedingLines = before.split('\n').slice(-5).join('\n')
    // The marker must carry a WRITTEN reason after the colon (contract C2:
    // checkable justifications, never a bare escape hatch) — a naked
    // `// no-request-scope:` does not count as documented (M5 delta-verify
    // finding, 2026-07-27).
    sites.push({ line, args, documentedSkip: /no-request-scope:\s*\S/.test(precedingLines) })
  }
  return sites
}

describe('audit requestId threading (CP5)', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root))

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('finds audit(/auditWeb( call sites (self-check the scanner isn\'t vacuous)', () => {
    const total = files.reduce((n, f) => n + callSites(readFileSync(f, 'utf8')).length, 0)
    expect(total).toBeGreaterThan(20) // the census found ~37 real call sites
  })

  it('every audit(/auditWeb( call site passes requestId, or documents why it can\'t', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(process.cwd() + '/', '')
      for (const site of callSites(readFileSync(file, 'utf8'))) {
        if (site.documentedSkip) continue
        if (!/\brequestId\b/.test(site.args)) {
          offenders.push(`${rel}:${site.line}: audit call has no requestId (or a '// no-request-scope:' marker)`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('would FAIL for a hypothetical call site missing requestId (self-check / mutant proof)', () => {
    const fakeSrc = [
      `audit({`,
      `  category: 'staff',`,
      `  action: 'staff.add',`,
      `  actorId: null,`,
      `  actorType: 'staff',`,
      `  businessId: null,`,
      `  source: 'web',`,
      `})`,
    ].join('\n')
    const [site] = callSites(fakeSrc)
    expect(site.documentedSkip).toBe(false)
    expect(/\brequestId\b/.test(site.args)).toBe(false)
  })

  it('accepts a documented no-request-scope call site (self-check)', () => {
    const fakeSrc = [
      `// no-request-scope: pre-auth, nothing to correlate to`,
      `audit({`,
      `  category: 'auth',`,
      `  action: 'auth.pin_lockout',`,
      `  actorId: actor,`,
      `  actorType: 'staff',`,
      `  businessId: null,`,
      `  source: 'web',`,
      `})`,
    ].join('\n')
    const [site] = callSites(fakeSrc)
    expect(site.documentedSkip).toBe(true)
  })

  it('rejects a BARE no-request-scope marker with no written reason (self-check)', () => {
    const fakeSrc = [
      `// no-request-scope:`,
      `audit({`,
      `  category: 'auth',`,
      `  action: 'auth.pin_lockout',`,
      `  actorId: actor,`,
      `  actorType: 'staff',`,
      `  businessId: null,`,
      `  source: 'web',`,
      `})`,
    ].join('\n')
    const [site] = callSites(fakeSrc)
    expect(site.documentedSkip).toBe(false)
  })
})
