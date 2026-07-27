// CP2 — coveredBy proof (contract §8). Every FACADE_AUDIT_MAP / API_ROUTE_
// DECISIONS row carrying a structured `coveredBy` citation ('src/path/
// file.ts#symbolName') must point at a REAL writer: the file exists, the
// symbol resolves, and it emits on every non-error-classified return path
// (the shared walker, helpers/audit-emission.ts). Every `pendingWave` string
// is a dated tracked-TODO, listed here as a CI-visible inventory (contract
// CP2) so a wave slipping past its own date is visible in the passing-run log,
// not just buried in a comment.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  FACADE_AUDIT_MAP,
  API_ROUTE_DECISIONS,
  type FacadeAuditRule,
  type ApiRouteDecision,
} from '@/lib/audit'
import { findSymbol, emitsOnEveryNonErrorPath } from './helpers/audit-emission'

const ROOT = process.cwd()
const PENDING_WAVE_RE = /^Wave [A-Z]+ — \d{4}-\d{2}-\d{2}$/

interface Row {
  key: string
  coveredBy?: string
  pendingWave?: string
}

function isMethodKeyed(
  entry: ApiRouteDecision | Record<string, ApiRouteDecision>,
): entry is Record<string, ApiRouteDecision> {
  return !('kind' in entry)
}

function allRows(): Row[] {
  const rows: Row[] = []
  for (const [key, rule] of Object.entries(FACADE_AUDIT_MAP) as [string, FacadeAuditRule][]) {
    rows.push({ key, coveredBy: rule.coveredBy, pendingWave: rule.pendingWave })
  }
  for (const [key, entry] of Object.entries(API_ROUTE_DECISIONS)) {
    if (isMethodKeyed(entry)) {
      for (const [method, decision] of Object.entries(entry)) {
        rows.push({ key: `${key}.${method}`, coveredBy: decision.coveredBy, pendingWave: decision.pendingWave })
      }
    } else {
      rows.push({ key, coveredBy: entry.coveredBy, pendingWave: entry.pendingWave })
    }
  }
  return rows
}

describe('CP2 — coveredBy citations are real writers', () => {
  const rows = allRows()
  const coveredRows = rows.filter((r) => r.coveredBy)

  it('finds coveredBy rows to verify', () => {
    expect(coveredRows.length).toBeGreaterThan(0)
  })

  it.each(coveredRows.map((r) => [r.key, r.coveredBy!] as const))(
    '%s → coveredBy %s resolves and emits on every non-error path',
    (key, citation) => {
      const [file, symbolName] = citation.split('#')
      expect(symbolName).toBeTruthy()
      const abs = join(ROOT, file)
      expect(existsSync(abs)).toBe(true)
      const source = readFileSync(abs, 'utf8')
      const symbol = findSymbol(source, symbolName)
      expect(symbol).not.toBeNull()
      const result = emitsOnEveryNonErrorPath(symbol!)
      if (!result.ok) {
        throw new Error(`${key} coveredBy ${citation} has undominated returns:\n${result.offenders.join('\n')}`)
      }
      expect(result.ok).toBe(true)
    },
  )

  it('every pendingWave is a dated tracked-TODO (/^Wave [A-Z]+ — YYYY-MM-DD$/) — CI-visible inventory', () => {
    const pending = rows.filter((r) => r.pendingWave).map((r) => `${r.key}: ${r.pendingWave}`)
    // eslint-disable-next-line no-console -- deliberate: contract CP2 wants this listed in the passing-run log.
    console.log(`CP2 pendingWave inventory (${pending.length} rows):\n${pending.join('\n')}`)
    const malformed = rows.filter((r) => r.pendingWave && !PENDING_WAVE_RE.test(r.pendingWave))
    expect(malformed.map((r) => `${r.key}: ${r.pendingWave}`)).toEqual([])
  })
})

describe('CP2 self-checks (walker convention)', () => {
  it('FAILS a symbol with an early success-return before its emit', () => {
    const src = `
      export async function badWriter(x: number) {
        if (x > 0) return { ok: true }
        await doWrite()
        audit({ action: 'x' })
        return { ok: true }
      }
    `
    const symbol = findSymbol(src, 'badWriter')
    expect(symbol).not.toBeNull()
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(false)
    expect(result.offenders.length).toBeGreaterThan(0)
  })

  it('PASSES a catch-clause return regardless of shape', () => {
    const src = `
      export async function okCatch() {
        try {
          await doWrite()
          audit({ action: 'x' })
          return { ok: true }
        } catch {
          return { ok: false }
        }
      }
    `
    const symbol = findSymbol(src, 'okCatch')
    expect(emitsOnEveryNonErrorPath(symbol!).ok).toBe(true)
  })

  it('PASSES an { error: "..." } early return (non-null error property)', () => {
    const src = `
      export async function okErrorShaped(x: number) {
        if (x < 0) return { error: 'bad input' }
        await doWrite()
        audit({ action: 'x' })
        return { ok: true }
      }
    `
    const symbol = findSymbol(src, 'okErrorShaped')
    expect(emitsOnEveryNonErrorPath(symbol!).ok).toBe(true)
  })

  it('does NOT exempt { error: null } (the amended-rule reason for existing) — a real early success must still dominate', () => {
    const src = `
      export async function trapDataErrorNull(x: number) {
        if (x < 0) return { data: null, error: null }
        await doWrite()
        audit({ action: 'x' })
        return { data: x, error: null }
      }
    `
    const symbol = findSymbol(src, 'trapDataErrorNull')
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(false)
  })

  // Fix round 1 #5: CaseClause/DefaultClause are chain boundaries — an emit
  // in one case must not dominate a return in a SIBLING case. Before the fix
  // both cases' nearest ts.isBlock ancestor was the same function body Block
  // (a CaseClause's statements aren't wrapped in their own Block node), so
  // this read as a false PASS.
  it('FAILS a switch where case 1 emits but sibling case 2 returns without its own emit (fix round 1 #5)', () => {
    const src = `
      export async function switchWriter(x: number) {
        switch (x) {
          case 1:
            audit({ action: 'x' })
            return { data: 1 }
          case 2:
            return { data: 2 }
        }
        return { data: 0 }
      }
    `
    const symbol = findSymbol(src, 'switchWriter')
    expect(symbol).not.toBeNull()
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(false)
  })

  // Fix round 1 #6: the exemption is now a real AST PropertyAssignment named
  // `status`, not a getText() regex — the regex used to match this string
  // literal's TEXT even though there is no `status` field on the object at
  // all.
  it('does NOT exempt a return whose MESSAGE STRING merely contains "status: 404" text (fix round 1 #6)', () => {
    const src = `
      export async function stringStatusReturn(x: number) {
        if (x < 0) return { message: 'status: 404 not found' }
        await doWrite()
        audit({ action: 'x' })
        return { ok: true }
      }
    `
    const symbol = findSymbol(src, 'stringStatusReturn')
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(false)
  })

  it('exempts a return with a REAL status PropertyAssignment in the 4xx/5xx range (fix round 1 #6)', () => {
    const src = `
      export async function realStatusReturn(x: number) {
        if (x < 0) return { status: 404 }
        await doWrite()
        audit({ action: 'x' })
        return { ok: true }
      }
    `
    const symbol = findSymbol(src, 'realStatusReturn')
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(true)
  })

  // Fix round 1 #9: findSymbol must skip a bodyless overload SIGNATURE and
  // keep scanning for the real implementation sharing that name — resolving
  // to the signature would give the walker zero returns and zero emits,
  // which reads as a vacuous pass.
  it('findSymbol skips a bodyless overload signature and resolves the real implementation (fix round 1 #9)', () => {
    const src = `
      export function overloaded(x: string): void;
      export function overloaded(x: number): void;
      export function overloaded(x: string | number): void {
        audit({ action: 'x' })
      }
    `
    const symbol = findSymbol(src, 'overloaded')
    expect(symbol).not.toBeNull()
    expect(symbol!.body).toBeDefined()
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(true)
  })
})
