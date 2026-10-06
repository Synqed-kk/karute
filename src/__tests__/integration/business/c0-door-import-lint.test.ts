/**
 * C0 (CORE-59): core-contract is tests-only until C2/B1. The ESLint rules in
 * eslint.config.mjs forbid any door import, in every import form; this test proves
 * it through ESLint's own Node API (lintText) and once through the real
 * `npx eslint` on planted files in a scratch copy (nothing is written in the repo).
 */
import path from 'node:path'
import os from 'node:os'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const RULES = new Set(['no-restricted-imports', 'no-restricted-syntax'])
const MESSAGE = 'core-contract is tests-only until C2/B1'

// ESLint loads eslint.config.mjs by dynamic import(), which jest's module
// sandbox refuses without --experimental-vm-modules — so the same Node API
// call (new ESLint({ cwd }), lintText(code, { filePath })) runs in a child
// node process and returns the messages as JSON.
const RUNNER = `
const { ESLint } = require('eslint')
const { code, filePath, cwd } = JSON.parse(process.argv[1])
new ESLint({ cwd }).lintText(code, { filePath }).then(
  ([r]) => process.stdout.write(JSON.stringify(r.messages)),
  (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1) },
)`

type Msg = { ruleId: string | null; severity: number; message: string }
const caught = (messages: Msg[]) => messages.filter((m) => m.ruleId !== null && RULES.has(m.ruleId) && m.severity === 2 && m.message.includes(MESSAGE)).length

async function restrictedErrors(code: string, relPath: string): Promise<number> {
  const arg = JSON.stringify({ code, filePath: path.join(ROOT, relPath), cwd: ROOT })
  const out = execFileSync(process.execPath, ['-e', RUNNER, arg], { cwd: ROOT, encoding: 'utf8' })
  return caught(JSON.parse(out) as Msg[])
}

describe('C0 core-contract door-import lint rule', () => {
  jest.setTimeout(180_000)

  it.each([
    ['a static import', "import { readC0Fields } from '@/lib/core-contract/c0'\nexport const x = readC0Fields\n", 'src/business/lib/planted-c0-import.ts'],
    ['a dynamic import()', "export const x = () => import('@/lib/core-contract/c0')\n", 'src/business/lib/planted-dyn.ts'],
    ['a require()', "// eslint-disable-next-line @typescript-eslint/no-require-imports\nexport const x = require('@/lib/core-contract/c0')\n", 'src/business/lib/planted-req.ts'],
    ['a relative import from src/lib/x.ts', "import { readC0Fields } from './core-contract/c0'\nexport const x = readC0Fields\n", 'src/lib/x.ts'],
    ['a relative import from src/app', "import { readC0Fields } from '../lib/core-contract/c0'\nexport const x = readC0Fields\n", 'src/app/x.ts'],
    ['an export … from', "export { readC0Fields } from '@/lib/core-contract/c0'\n", 'src/business/lib/planted-reexport.ts'],
    ['a .jsx file', "import { readC0Fields } from '@/lib/core-contract/c0'\nexport const X = () => <div>{String(readC0Fields)}</div>\n", 'src/app/planted.jsx'],
  ])('%s in a door file → exactly one error', async (_name, code, file) => {
    expect(await restrictedErrors(code, file)).toBe(1)
  })

  it('a test file may import AND re-export the reader (src/__tests__ is outside the rule)', async () => {
    expect(await restrictedErrors("import { readC0Fields } from '@/lib/core-contract/c0'\nexport const x = readC0Fields\n", 'src/__tests__/integration/business/planted.test.ts')).toBe(0)
    expect(await restrictedErrors("export * from '@/lib/core-contract/c0'\n", 'src/__tests__/integration/business/fixtures/c0/planted-reexport.ts')).toBe(0)
  })

  it('src/lib/core-contract/ holds exactly c0.ts and README.md (no door file can hide inside it)', () => {
    expect(readdirSync(path.join(ROOT, 'src/lib/core-contract')).filter((f) => f !== '.DS_Store').sort()).toEqual(['README.md', 'c0.ts']) // NIT N-5: Finder's file, never committed
  })

  it('the real `npx eslint` catches 3 of 3 planted files in a scratch copy', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'c0-lint-'))
    for (const f of ['eslint.config.mjs', 'package.json', 'tsconfig.json']) copyFileSync(path.join(ROOT, f), path.join(dir, f))
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
    mkdirSync(path.join(dir, 'src/lib'), { recursive: true })
    mkdirSync(path.join(dir, 'src/business'), { recursive: true })
    writeFileSync(path.join(dir, 'src/business/zz-planted-a.ts'), "import { readC0Fields } from '@/lib/core-contract/c0'\nexport const a = readC0Fields\n")
    writeFileSync(path.join(dir, 'src/lib/zz-planted-b.ts'), "import { readC0Fields } from './core-contract/c0'\nexport const b = readC0Fields\n")
    writeFileSync(path.join(dir, 'src/business/zz-planted-c.ts'), "export const c = () => import('@/lib/core-contract/c0')\n")
    const r = spawnSync('npx', ['--no', '--', 'eslint', 'src', '--format', 'json'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' } })
    const results = JSON.parse(r.stdout) as Array<{ filePath: string; messages: Msg[] }>
    const hits = results.filter((x) => caught(x.messages) === 1).map((x) => path.basename(x.filePath)).sort()
    expect(hits).toEqual(['zz-planted-a.ts', 'zz-planted-b.ts', 'zz-planted-c.ts'])
  })
})
