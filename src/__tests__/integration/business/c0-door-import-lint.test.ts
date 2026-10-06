/**
 * C0 (CORE-59): core-contract is tests-only until C2/B1. The ESLint rule in
 * eslint.config.mjs forbids any door import; this test proves it fires through
 * ESLint's own Node API (lintText only — nothing is written to disk).
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const RULE = 'no-restricted-imports'

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

async function restrictedErrors(code: string, relPath: string): Promise<number> {
  const arg = JSON.stringify({ code, filePath: path.join(ROOT, relPath), cwd: ROOT })
  const out = execFileSync(process.execPath, ['-e', RUNNER, arg], { cwd: ROOT, encoding: 'utf8' })
  const messages = JSON.parse(out) as Array<{ ruleId: string | null; severity: number }>
  return messages.filter((m) => m.ruleId === RULE && m.severity === 2).length
}

describe('C0 core-contract door-import lint rule', () => {
  jest.setTimeout(60_000)

  it('a door file importing @/lib/core-contract/c0 gets exactly one error', async () => {
    const code = "import { readC0Fields } from '@/lib/core-contract/c0'\nexport const x = readC0Fields\n"
    expect(await restrictedErrors(code, 'src/business/lib/planted-c0-import.ts')).toBe(1)
  })

  it('a test file importing it gets none', async () => {
    const code = "import { readC0Fields } from '@/lib/core-contract/c0'\nexport const x = readC0Fields\n"
    expect(await restrictedErrors(code, 'src/__tests__/integration/business/planted.test.ts')).toBe(0)
  })

  it('a relative import from src/app gets exactly one error', async () => {
    const code = "import { readC0Fields } from '../lib/core-contract/c0'\nexport const x = readC0Fields\n"
    expect(await restrictedErrors(code, 'src/app/x.ts')).toBe(1)
  })
})
