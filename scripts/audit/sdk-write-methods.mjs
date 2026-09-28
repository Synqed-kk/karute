// Shared SDK write-method derivation — used by CP3 (audit-sdk-write-sites)
// AND the emission walker's mutation-anchor rule (CP2/CP7). Derives from the
// INSTALLED SDK (node_modules/@synqed-kk/client/dist), never hardcoded, so a
// dist-format or SDK-version change is caught by the sentinel/floor
// assertions in audit-sdk-write-sites.test.ts, not silently under-derived.
//
// Plain ESM + JSDoc types (moved from src/__tests__/integration/helpers/
// sdk-write-methods.ts, 2026-09-28) so plain `node` can import it — the CI
// audit-gates job installs only `typescript` — alongside jest (CP3). That
// job has NO SDK, so a plain-node caller of the emission walker passes its
// own `writePairs` and never reaches deriveSdkClasses()
// (scripts/business/check-shared-cores.mjs).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const SDK_DIST = join(process.cwd(), 'node_modules/@synqed-kk/client/dist')
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** @typedef {{ prop: string, method: string }} WritePair */

/** Per-class derivation result — `methodCount` lets callers enforce the
 *  per-class parse floor (contract §8 CP3 amendment: a class yielding zero
 *  methods is a loud parse failure, guarding a core-side codegen change that
 *  silently shrinks the write set).
 *  @typedef {{ prop: string, className: string, methodCount: number, writes: WritePair[] }} ClassDerivation */

/** @param {string} dts
 *  @returns {Map<string, string>} */
function classToModule(dts) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const re = /import \{ (\w+) \} from '\.\/([\w-]+)\.js';/g
  /** @type {RegExpExecArray | null} */
  let m
  while ((m = re.exec(dts))) out.set(m[1], m[2])
  return out
}

/** @param {string} dts
 *  @returns {[string, string][]} */
function classProps(dts) {
  /** @type {[string, string][]} */
  const out = []
  const re = /^\s{4}(\w+): (\w+Client);$/gm
  /** @type {RegExpExecArray | null} */
  let m
  while ((m = re.exec(dts))) out.push([m[1], m[2]])
  return out
}

/** @param {string} jsSource
 *  @returns {{ name: string, bodyText: string }[]} */
function methodBodies(jsSource) {
  const sf = ts.createSourceFile('__m__.js', jsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  /** @type {{ name: string, bodyText: string }[]} */
  const out = []
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      out.push({ name: node.name.text, bodyText: node.body.getText() })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Per-class breakdown (for the per-class parse floor) + the flat write-pair
 *  list. Throws if client.d.ts itself can't be found/parsed at all — that IS
 *  a loud failure (never a silently-empty derivation).
 *  @returns {ClassDerivation[]} */
export function deriveSdkClasses() {
  const dtsPath = join(SDK_DIST, 'client.d.ts')
  if (!existsSync(dtsPath)) {
    throw new Error(`SDK derivation: ${dtsPath} not found — @synqed-kk/client dist layout changed?`)
  }
  const dts = readFileSync(dtsPath, 'utf8')
  const modules = classToModule(dts)
  const props = classProps(dts)
  /** @type {ClassDerivation[]} */
  const out = []
  for (const [prop, className] of props) {
    const mod = modules.get(className)
    if (!mod) {
      throw new Error(`SDK derivation: no module import found for class ${className} (property '${prop}')`)
    }
    const jsPath = join(SDK_DIST, `${mod}.js`)
    if (!existsSync(jsPath)) {
      throw new Error(`SDK derivation: ${jsPath} not found for property '${prop}'`)
    }
    const js = readFileSync(jsPath, 'utf8')
    const methods = methodBodies(js).filter((m) => m.name !== 'constructor')
    /** @type {WritePair[]} */
    const writes = []
    for (const { name, bodyText } of methods) {
      let verb = 'GET'
      const verbMatch = /method:\s*'(\w+)'/.exec(bodyText)
      if (verbMatch) verb = verbMatch[1]
      else if (/fetchMultipart\(/.test(bodyText)) verb = 'POST'
      if (WRITE_VERBS.has(verb)) writes.push({ prop, method: name })
    }
    out.push({ prop, className, methodCount: methods.length, writes })
  }
  return out
}

/** @returns {WritePair[]} */
export function deriveWriteMethods() {
  return deriveSdkClasses().flatMap((c) => c.writes)
}
