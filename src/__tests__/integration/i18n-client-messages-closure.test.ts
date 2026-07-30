/**
 * Machine-check for the per-screen client-dictionary split
 * (src/i18n/client-messages.ts). A nested NextIntlClientProvider REPLACES the
 * message set for its subtree (installed use-intl: `messages === undefined ?
 * prevContext?.messages : messages` — no merge), so this test walks the REAL
 * import graph and proves, for every route file under src/app/[locale]:
 *
 *   1. Self-carrying surfaces (settings/coaching/data-export/…): every
 *      namespace reachable from the file is inside its PAGE_PICKS entry.
 *   2. Everything else (hot pages, shell layout, every loading/error
 *      fallback — fallbacks render OUTSIDE page-level providers): any
 *      reachable literal under a cold namespace must be covered by a
 *      RETAINED_HOT_PATHS prefix, because the layout provider no longer
 *      carries those namespaces.
 *   3. Every configured name/path exists in BOTH messages/ja.json and
 *      en.json — a typo'd pick would silently ship nothing.
 *
 * Plus direct unit checks of toLayoutMessages/pickMessages (cold removed,
 * retained grafted, input not mutated).
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  COLD_NAMESPACES,
  RETAINED_HOT_PATHS,
  PAGE_PICKS,
  toLayoutMessages,
  pickMessages,
} from '@/i18n/client-messages'
import type { AbstractIntlMessages } from 'next-intl'

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')
const LOCALE_DIR = path.join(SRC, 'app', '[locale]')

// ── import-graph walker ─────────────────────────────────────────────
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare specifier → node_modules
  for (const c of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
  ]) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      /* keep trying */
    }
  }
  return null
}

const NS_RE = /(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]/g
const NS_OBJ_RE = /getTranslations\(\s*\{[^}]*namespace:\s*['"]([^'"]+)['"]/g
// Every call site the two regexes above can't read — variable namespace
// (useTranslations(NS)), argless (useTranslations()), computed object form —
// is a closure the walker can't see. Counted per file and failed LOUD below,
// mirroring the interpolated-import guard (blind-round counterexample: a
// variable namespace on a hot page shipped raw keys while this test stayed
// green).
const NS_CALL_RE = /(?:useTranslations|getTranslations)\(/g

/** File text with FULL-LINE `//` comments removed. Doc comments are where
 *  phantom literals live — a commented example call-site in ScaffoldHint
 *  grafted a dead namespace into the layout payload. Only whole-line
 *  comments are stripped: trailing-comment stripping would mangle string
 *  literals containing '//' (URLs). */
function scanText(f: string): string {
  return fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')
}
// THREE independent regexes, not one alternation: a combined pattern's
// `[^'"]*?` lazy scan spans newlines, so a quoted `from '…'` later in the
// file would swallow a preceding backtick dynamic import inside its match
// (order-fragile — proven by mutant). Independent passes can't shadow each
// other. FROM_RE keys on the `from '…'` clause alone, which covers import,
// export-from and multi-line named forms alike.
const FROM_RE = /from\s*['"]([^'"]+)['"]/g
const DYN_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g
const DYN_BACKTICK_RE = /import\(\s*`([^`]+)`\s*\)/g

/** All translation-namespace literals reachable from `entry` via static
 *  imports. An INTERPOLATED local dynamic import can't be followed statically
 *  — it throws so a walked tree never silently under-reports its closure
 *  (messages/*.json interpolation in i18n/request.ts is not reachable from
 *  any route file, so this stays quiet until someone adds one). */
function reachableLiterals(entry: string): Set<string> {
  const seen = new Set<string>()
  const lits = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const s = scanText(f)
    let literalCalls = 0
    for (const re of [NS_RE, NS_OBJ_RE]) {
      re.lastIndex = 0
      for (const m of s.matchAll(re)) {
        lits.add(m[1])
        literalCalls++
      }
    }
    NS_CALL_RE.lastIndex = 0
    const totalCalls = [...s.matchAll(NS_CALL_RE)].length
    if (totalCalls !== literalCalls) {
      throw new Error(
        `unscannable namespace call in ${f}: ${totalCalls} useTranslations/` +
          `getTranslations call(s) but only ${literalCalls} readable literal(s) — ` +
          'a variable/argless/computed namespace hides its closure from this walk; ' +
          'use a string literal or extend the test',
      )
    }
    for (const re of [FROM_RE, DYN_RE, DYN_BACKTICK_RE]) {
      re.lastIndex = 0
      for (const m of s.matchAll(re)) {
        const spec = m[1]
        if (!spec) continue
        if (
          spec.includes('${') &&
          (spec.startsWith('@/') || spec.startsWith('.'))
        ) {
          throw new Error(
            `unscannable interpolated import in ${f}: import(\`${spec}\`) — ` +
              'the closure walk cannot follow it; resolve statically or extend the test',
          )
        }
        const r = resolveSpec(spec, f)
        if (r && !r.includes('__tests__')) stack.push(r)
      }
    }
  }
  return lits
}

// ── route-file inventory ────────────────────────────────────────────
const ROUTE_FILE = /^(page|layout|loading|error|template|not-found)\.tsx$/
function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...routeFiles(p))
    else if (ROUTE_FILE.test(e.name)) out.push(p)
  }
  return out
}

// Self-carrying surfaces → their pick. Coaching's provider lives in its
// LAYOUT, so every route file under coaching/ (loading fallbacks included)
// is covered by the coaching pick. Elsewhere the provider lives in page.tsx,
// so ONLY page.tsx is covered — that segment's loading.tsx renders outside
// the pick and falls through to rule 2.
function pickFor(file: string): readonly string[] | null {
  const rel = path.relative(LOCALE_DIR, file).split(path.sep).join('/')
  if (rel.startsWith('(app)/coaching/')) return PAGE_PICKS.coaching
  const byPage: Record<string, readonly string[]> = {
    '(app)/settings/page.tsx': PAGE_PICKS.settings,
    '(app)/data-export/page.tsx': PAGE_PICKS.dataExport,
    '(app)/data-import/page.tsx': PAGE_PICKS.dataImport,
    '(app)/welcome/page.tsx': PAGE_PICKS.welcome,
    'page.tsx': PAGE_PICKS.landing,
    'login/page.tsx': PAGE_PICKS.authPages,
    'signup/page.tsx': PAGE_PICKS.authPages,
    'reset-password/page.tsx': PAGE_PICKS.authPages,
    'reset-password/confirm/page.tsx': PAGE_PICKS.authPages,
    'join/page.tsx': PAGE_PICKS.join,
  }
  return byPage[rel] ?? null
}

const COLD = new Set<string>(COLD_NAMESPACES)
function coveredByRetention(literal: string): boolean {
  const parts = literal.split('.')
  return RETAINED_HOT_PATHS.some(
    (p) => p.length <= parts.length && p.every((seg, i) => parts[i] === seg),
  )
}

describe('i18n client-message split closure', () => {
  const files = routeFiles(LOCALE_DIR)

  it('found the route inventory (guards against the walker going blind)', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files.some((f) => f.endsWith(`(app)${path.sep}layout.tsx`))).toBe(true)
  })

  it.each(files.map((f) => [path.relative(ROOT, f), f]))(
    '%s stays inside its client dictionary',
    (_rel, file) => {
      const lits = [...reachableLiterals(file)]
      const pick = pickFor(file)
      if (pick) {
        // Rule 1 — the pick must contain the subtree's full closure.
        const missing = lits
          .map((l) => l.split('.')[0])
          .filter((ns) => !pick.includes(ns))
        expect(missing).toEqual([])
      } else {
        // Rule 2 — cold namespaces may only appear via retained sub-trees.
        const uncovered = lits.filter(
          (l) => COLD.has(l.split('.')[0]) && !coveredByRetention(l),
        )
        expect(uncovered).toEqual([])
      }
    },
  )

  it.each(['ja', 'en'])(
    'every configured namespace/path exists in %s.json',
    (locale) => {
      const messages = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8'),
      ) as Record<string, unknown>
      for (const ns of COLD_NAMESPACES) expect(messages[ns]).toBeDefined()
      for (const pick of Object.values(PAGE_PICKS))
        for (const ns of pick) expect(messages[ns]).toBeDefined()
      for (const p of RETAINED_HOT_PATHS) {
        let node: unknown = messages
        for (const seg of p) {
          expect(node).toBeDefined()
          node = (node as Record<string, unknown>)[seg]
        }
        expect(node).toBeDefined()
      }
    },
  )
})

describe('toLayoutMessages / pickMessages', () => {
  const all = {
    common: { ok: 'OK' },
    settings: { title: '設定', stores: { add: '追加' } },
    coaching: {
      panel: { t: 'x' },
      common: { c: 'y' },
      staff: { monthlyGrowth: { m: 'z' }, other: { o: 'w' } },
      modules: { big: 'blob' },
    },
    auth: { subtitle: 's' },
  } as unknown as AbstractIntlMessages

  it('drops cold namespaces but grafts the retained hot sub-trees', () => {
    const slim = toLayoutMessages(all) as Record<string, unknown>
    expect(slim.common).toEqual({ ok: 'OK' })
    expect(slim.auth).toBeUndefined()
    // settings reduced to exactly the shell's sub-tree
    expect(slim.settings).toEqual({ stores: { add: '追加' } })
    // coaching reduced to the karute-detail panel's needs
    expect(slim.coaching).toEqual({
      panel: { t: 'x' },
      common: { c: 'y' },
    })
  })

  it('does not mutate the input (getMessages() result is module-cached)', () => {
    const before = JSON.stringify(all)
    toLayoutMessages(all)
    expect(JSON.stringify(all)).toBe(before)
  })

  it('pickMessages returns exactly the requested namespaces', () => {
    const picked = pickMessages(all, ['auth', 'missing']) as Record<
      string,
      unknown
    >
    expect(Object.keys(picked)).toEqual(['auth'])
    expect(picked.auth).toEqual({ subtitle: 's' })
  })
})

export {}
