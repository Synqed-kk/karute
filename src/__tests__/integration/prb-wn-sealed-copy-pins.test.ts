/**
 * PR-B Wn — SCOPE 4 (R-S81-9 + R-S82-6): source-text pins for the sealed copy.
 *
 * 1. THE AWAIT PIN. Inside an IndexedDB transaction scope (from `.transaction(`
 *    to the end of the innermost block holding it) every `await` is a request
 *    await — `await req(`, or `await Promise.all([...])` over `req(` calls —
 *    or the transaction's own completion (`await committed`, only where the
 *    scope wires `tx.oncomplete`). No `.then(` at all. Every same-file helper
 *    CALLED from a scope obeys the same rule over its whole body. The shim
 *    does not model auto-commit, so a non-request await would pass every
 *    behaviour test here and fail on every device — this pin is the only net.
 *    Covered: all of take-vault.ts, and the door's scopes in take-store.ts
 *    (`readLiveTake`, `deleteTakeRows`). Built against the decoy set below.
 * 2. The sealed database and store names are not the live ones.
 * 3. The import boundary: only take-store.ts (and tests) import take-vault —
 *    static, dynamic or relative — and no other src/ or thin/ file names the
 *    sealed database.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Comments removed and string/template contents blanked (same length, quotes
 *  kept), so braces, `await`s and calls are only ever real code. */
function codeOnly(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i++
      }
    } else if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
    } else if (c === "'" || c === '"' || c === '`') {
      out += c
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += ' '
          i++
        }
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Index of the brace that closes the block opened at `open`. */
function closeOf(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return i
  }
  return code.length
}

/** The innermost block containing `at`: [its `{`, its `}`]. */
function blockAround(code: string, at: number): [number, number] {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    if (code[i] === '}') depth++
    else if (code[i] === '{') {
      if (depth === 0) return [i, closeOf(code, i)]
      depth--
    }
  }
  return [0, code.length]
}

/** Every same-file function body, by name: `function NAME(…) … {` and
 *  `const NAME = (…) => {` / `const NAME = async (…) => {`. */
function helperBodies(code: string): Map<string, string> {
  const out = new Map<string, string>()
  const decl = /(?:function\s+([A-Za-z_]\w*)\s*\(|const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]*)?=>\s*\{)/g
  for (let m = decl.exec(code); m; m = decl.exec(code)) {
    const name = m[1] ?? m[2]
    let open: number
    if (m[1]) {
      // past the parameter list and any return type: the body is the `{` that
      // starts a line's last token after the header's closing `)`.
      const header = code.slice(m.index)
      const body = /\)\s*(?::[^\n]*?)?\{\s*\n/.exec(header)
      if (!body) continue
      open = m.index + body.index + body[0].lastIndexOf('{')
    } else open = m.index + m[0].length - 1
    out.set(name, code.slice(open, closeOf(code, open) + 1))
  }
  return out
}

const AWAIT_OK = /^await\s+(req\(|Promise\.all\(\[)/

/** Violations in one region (a transaction scope or a called helper). */
function checkRegion(region: string, helpers: Map<string, string>, seen: Set<string>, completion: boolean): string[] {
  const bad: string[] = []
  for (const m of region.matchAll(/\bawait\b[^;\n]*/g)) {
    const text = m[0]
    if (AWAIT_OK.test(text)) {
      if (text.startsWith('await Promise.all([')) {
        const inner = region.slice(m.index!, closeOf(region.replace(/\[/g, '{').replace(/\]/g, '}'), m.index! + text.indexOf('[')))
        if (!/req\(/.test(inner) || /\bawait\b(?!\s+req\()/.test(inner.slice(5))) bad.push(text)
      }
      continue
    }
    if (completion && /^await\s+committed\b/.test(text)) continue
    bad.push(text)
  }
  if (/\.then\(/.test(region)) bad.push('.then(')
  for (const m of region.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1]
    if (name === 'req' || seen.has(name) || !helpers.has(name)) continue
    seen.add(name)
    bad.push(...checkRegion(helpers.get(name)!, helpers, seen, false).map((b) => `${name}: ${b}`))
  }
  return bad
}

/** Every transaction scope in `src` (optionally only inside the named
 *  top-level functions) → its violations. Also returns how many scopes. */
function awaitPin(src: string, only?: string[]): { scopes: number; bad: string[] } {
  const code = codeOnly(src)
  const helpers = helperBodies(code)
  const spans = only?.map((name) => {
    const at = code.search(new RegExp(`function\\s+${name}\\s*\\(`))
    expect(at).toBeGreaterThanOrEqual(0)
    return [at, code.indexOf('\n}\n', at)] as const
  })
  let scopes = 0
  const bad: string[] = []
  for (const m of code.matchAll(/\.transaction\(/g)) {
    if (spans && !spans.some(([a, b]) => m.index! > a && m.index! < b)) continue
    scopes++
    const [, end] = blockAround(code, m.index!)
    const region = code.slice(m.index!, end)
    bad.push(...checkRegion(region, helpers, new Set(), /\btx\.oncomplete\s*=/.test(region)))
  }
  return { scopes, bad }
}

describe('THE AWAIT PIN (R-S81-9, R-S82-6)', () => {
  it('take-vault.ts: every await inside a transaction scope is a request or the completion', () => {
    const { scopes, bad } = awaitPin(read('src/lib/karute/take-vault.ts'))
    expect(scopes).toBe(1)
    expect(bad).toEqual([])
  })
  it("take-store.ts's door scopes (readLiveTake, deleteTakeRows): request awaits only", () => {
    const { scopes, bad } = awaitPin(read('src/lib/karute/take-store.ts'), ['readLiveTake', 'deleteTakeRows'])
    expect(scopes).toBe(2)
    expect(bad).toEqual([])
  })

  const wrap = (body: string, extra = '') => `${extra}
async function copy(db: IDBDatabase) {
  const tx = db.transaction(['a'], 'readwrite')
  const committed = new Promise((r) => (tx.oncomplete = () => r(true)))
${body}
}
`
  it.each([
    ['request awaits + the completion', wrap(`  await req(tx.objectStore('a').get(1))\n  await committed`)],
    ['await Promise.all over req(...) calls', wrap(`  await Promise.all([req(s.get(1)), ...rows.map((r) => req(s.put(r)))])`)],
    ['a bad await only in a // comment', wrap(`  // await sleep(10)\n  await req(s.get(1))`)],
    ['a bad await only in a /* */ comment', wrap(`  /* await fetch(url) */\n  await req(s.get(1))`)],
    ['a bad await after the scope closed', `async function f(db: IDBDatabase) {\n  {\n    const tx = db.transaction(['a'])\n    await req(tx.objectStore('a').get(1))\n  }\n  await fetch('x')\n}\n`],
  ])('decoy PASSES: %s', (_label, src) => {
    expect(awaitPin(src).bad).toEqual([])
  })
  it.each([
    ['a non-request await', wrap(`  await fetch('x')`)],
    ['a non-request await moved into a dead scope', wrap(`  if (false) {\n    await sleep(1)\n  }`)],
    ['a non-request await inside a helper CALLED from the scope', wrap(`  await req(s.get(1))\n  pause()`, `async function pause() {\n  await sleep(1)\n}\n`)],
    ['a .then( on a non-request promise', wrap(`  void fetch('x').then(() => req(s.get(1)))`)],
    ['await Promise.all over a non-request promise', wrap(`  await Promise.all([fetch('x')])`)],
    ['awaiting the completion where the scope wires no oncomplete', `async function f(db: IDBDatabase) {\n  const tx = db.transaction(['a'])\n  await committed\n}\n`],
  ])('decoy FAILS: %s', (_label, src) => {
    expect(awaitPin(src).bad.length).toBeGreaterThan(0)
  })
})

describe('the sealed names (R-S80-1)', () => {
  it('the sealed database and its stores are not karute_takes / takes / segments', () => {
    const src = read('src/lib/karute/take-vault.ts')
    const names = ['VAULT_DB', 'VAULT_TAKES', 'VAULT_SEGMENTS'].map((k) => {
      const m = new RegExp(`const ${k} = '([^']+)'`).exec(src)
      expect(m).not.toBeNull()
      return m![1]
    })
    expect(new Set(names).size).toBe(3)
    for (const n of names) expect(['karute_takes', 'takes', 'segments']).not.toContain(n)
  })
})

describe('the import boundary (R-S80-1, D-18)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((f) => {
      const p = join(dir, f)
      if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) return []
      return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : []
    })
  const isTest = (p: string) => /__tests__|\.test\.|\.spec\./.test(p)
  const files = [...walk('src'), ...walk('thin')].filter((p) => !isTest(p))

  it('only take-store.ts imports take-vault (static, dynamic or relative)', () => {
    const importers = files.filter((p) =>
      /(from\s+['"][^'"]*\/take-vault['"]|import\(\s*['"][^'"]*\/take-vault['"]\s*\)|require\(\s*['"][^'"]*\/take-vault['"]\s*\))/.test(read(p)),
    )
    expect(importers.map((p) => relative('.', p))).toEqual(['src/lib/karute/take-store.ts'])
  })
  it('no src/ or thin/ file but take-vault.ts names the sealed database', () => {
    const db = /const VAULT_DB = '([^']+)'/.exec(read('src/lib/karute/take-vault.ts'))![1]
    expect(files.filter((p) => read(p).includes(db))).toEqual(['src/lib/karute/take-vault.ts'])
  })
})
