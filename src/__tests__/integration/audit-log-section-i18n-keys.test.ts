// 監査ログ round 2, PR D2 fix round 1, F2(b) (LENS-PR-D2-BLIND-2026-09-11.md
// finding 2 / PACKET-PR-D2-FIX-ROUND1-2026-09-11.md F2): the whole test suite
// stayed green while settings.auditLog.fold.count/fold.range were missing
// from BOTH locales, because the component's own test supplied them from a
// hand-typed dictionary. No gate in the repo checked a literal t()/tc()/
// tRole() key against messages/*.json — i18n-key-parity.test.ts only
// compares ja⇄en (both-missing still passes), i18n-label-totality.test.ts
// only walks CAPABILITIES + AUDIT_ACTIONS.
//
// This gate is source-driven, not a fixture list: it reads
// AuditLogSection.tsx itself, collects every literal t('…')/tc('…')/
// tRole('…') call (never a t.has(…) check — those exist precisely to permit
// absence, and never a dynamic/template key — those are pinned separately by
// the automationLabelKey/karuteMissingReasonKey/transcribeFailedReasonKey
// unit tests in audit-labels.test.ts, which assert the exact string each
// returns), and asserts each resolves to a real string in BOTH ja.json and
// en.json under the namespace its own useTranslations() call declared.
//
// Deleting any of those keys from either locale must fail THIS test — see
// the blind lens's mutant m8 (delete the whole settings.auditLog.thread
// block from both locales; the old suite stayed green, this one must not).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

const COMPONENT_PATH = join(
  process.cwd(),
  'src/components/settings/redesign/sections/AuditLogSection.tsx',
)

/** Hook variable -> namespace, read straight off the component's own
 *  `useTranslations('…')` call sites — never hand-typed, so a renamed
 *  namespace or a new hook is caught by the assertion below rather than
 *  silently scanning the wrong prefix. */
function hookNamespaces(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /const\s+(\w+)\s*=\s*useTranslations\('([^']+)'\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out[m[1]!] = m[2]!
  return out
}

/** Every literal `<hook>('key')` / `<hook>("key")` call for a known hook
 *  name, EXCLUDING `<hook>.has(...)` (a deliberate presence check, not a
 *  render) and excluding dynamic/template-literal keys (no quote
 *  immediately after the paren — those are covered by the pure-helper unit
 *  tests instead, per the file header above). */
function literalKeyCalls(src: string, hooks: string[]): { hook: string; key: string }[] {
  const out: { hook: string; key: string }[] = []
  const alt = hooks.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`(?<![.\\w])(${alt})\\(\\s*(['"])([\\w.]+)\\2`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push({ hook: m[1]!, key: m[3]! })
  return out
}

function resolves(messages: unknown, namespace: string, key: string): boolean {
  let cur: unknown = messages
  for (const part of `${namespace}.${key}`.split('.')) {
    cur = (cur as Record<string, unknown> | undefined)?.[part]
  }
  return typeof cur === 'string'
}

describe('AuditLogSection — every literal t()/tc()/tRole() key resolves in BOTH locales', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8')
  const namespaces = hookNamespaces(src)
  const hookNames = Object.keys(namespaces)

  it('the component declares the three known hooks (sanity — a renamed/added hook must not silently narrow this scan)', () => {
    expect(hookNames.sort()).toEqual(['t', 'tRole', 'tc'].sort())
    expect(namespaces.t).toBe('settings.auditLog')
    expect(namespaces.tRole).toBe('settings.permissions')
    expect(namespaces.tc).toBe('common')
  })

  const calls = literalKeyCalls(src, hookNames)

  it('found a non-trivial number of literal key calls (sanity — a broken regex that matches nothing would pass everything vacuously)', () => {
    expect(calls.length).toBeGreaterThan(30)
  })

  it.each(calls.map(({ hook, key }): [string, string, string] => [hook, key, namespaces[hook]!]))(
    '%s(%s) [%s] resolves in ja.json and en.json',
    (_hook, key, namespace) => {
      expect(resolves(ja, namespace, key)).toBe(true)
      expect(resolves(en, namespace, key)).toBe(true)
    },
  )
})
