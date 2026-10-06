#!/usr/bin/env node
// Selftest for the parity harness's alias reader (tsconfig-aliases.mjs) — fixture red, in seconds.
//   node scripts/business/reserve-card-parity/tsconfig-aliases.selftest.mjs
// Each case writes a throwaway dir holding only tsconfig file(s), calls tsconfigAliases(<dir>) and asserts either
// the exact alias table or a throw carrying the named message. Needs only typescript (from the repo root); nothing else is touched.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsconfigAliases } from './tsconfig-aliases.mjs'

// the temp dirs hold no node_modules, so typescript is resolved from this repo's root (HERE/../../..) as tsFrom
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const CASES = [
  ['comments + trailing comma read as TypeScript reads them', {
    'tsconfig.json': `{
  // line comment
  /* block comment */
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"], },
  },
}`,
  }, (d) => [{ find: '@', replacement: join(d, 'src') }]],
  ['extends: paths from the base file', {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { strict: true } }),
  }, (d) => [{ find: '@', replacement: join(d, 'src') }]],
  ['baseUrl: targets resolve under it', {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: './app', paths: { '@/*': ['./src/*'] } } }),
  }, (d) => [{ find: '@', replacement: join(d, 'app', 'src') }]],
  ['non-/* key throws naming it', {
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@lib': ['./src/lib/index.ts'] } } }),
  }, /tsconfig\.json paths: cannot map "@lib"/],
  ['two targets throws naming the entry', {
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*', './gen/*'] } } }),
  }, /tsconfig\.json paths: cannot map "@\/\*": \["\.\/src\/\*","\.\/gen\/\*"\]/],
  ['missing file throws naming the file', {}, (d) => new RegExp(`tsconfig\\.json: not found \\(${join(d, 'tsconfig.json').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\)`)],
]

let failed = 0
for (const [name, files, want] of CASES) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'parity-tsconfig-selftest-')))
  let ok, got
  try {
    for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body) }
    const expect = typeof want === 'function' ? want(dir) : want
    try {
      got = tsconfigAliases(dir, REPO)
      ok = Array.isArray(expect) && JSON.stringify(got) === JSON.stringify(expect)
      got = JSON.stringify(got)
    } catch (e) {
      got = `threw: ${e.message}`
      ok = expect instanceof RegExp && expect.test(e.message)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — got ${got}`}`)
}
if (failed) {
  console.error(`✗ parity tsconfig-aliases selftest: ${failed} of ${CASES.length} cases red`)
  process.exit(1)
}
console.log(`✓ parity tsconfig-aliases selftest: ${CASES.length} cases green`)
