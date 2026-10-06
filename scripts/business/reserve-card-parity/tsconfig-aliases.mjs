// The app's module aliases for the parity harness's throwaway vite, from ONE definition: the app's tsconfig.json
// compilerOptions.paths (what TypeScript and Next resolve), read by TypeScript's OWN reader — comments, trailing
// commas and `extends` handled exactly as the app's toolchain handles them, never by a stricter JSON.parse.
// Each "X/*": ["./Y/*"] becomes alias X → <base>/Y, where base is what TypeScript itself uses: baseUrl when set,
// else the directory of the tsconfig that declared `paths` (TypeScript's pathsBasePath). Any other shape stops the
// run naming the entry — an alias is never guessed.
//   import { tsconfigAliases } from './tsconfig-aliases.mjs'; tsconfigAliases(root) → [{ find, replacement }]
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

const NO_INPUTS = 18003 // "No inputs were found in config file" — about include/files, irrelevant to paths

export function tsconfigAliases(root) {
  const file = join(root, 'tsconfig.json')
  if (!existsSync(file)) throw new Error(`tsconfig.json: not found (${file})`)
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile)
  if (error) throw new Error(`tsconfig.json: cannot be read (${file}): ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  const { options, errors } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(file), undefined, file)
  const bad = errors.filter((d) => d.code !== NO_INPUTS)
  if (bad.length) throw new Error(`tsconfig.json: cannot be parsed (${file}): ${bad.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`)
  const base = options.baseUrl ?? options.pathsBasePath ?? dirname(file)
  return Object.entries(options.paths ?? {}).map(([from, to]) => {
    if (!from.endsWith('/*') || !Array.isArray(to) || to.length !== 1 || !to[0].endsWith('/*')) throw new Error(`tsconfig.json paths: cannot map ${JSON.stringify(from)}: ${JSON.stringify(to)} one-to-one to a vite alias`)
    return { find: from.slice(0, -2), replacement: resolve(base, to[0].slice(0, -2)) }
  })
}
