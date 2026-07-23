// The Greptile-P1-on-#588 lesson, same guard class as ai-route-seam-coverage
// (F-9): a component that hardcodes the cookie-only `/api/export` path renders
// fine in the shell but 401s on every export (the shared view did exactly
// this — the facade twin existed with nothing calling it). Every export call
// in a component must ride the DataPort's exportBase seam. This scans
// src/components for the literal and pins the seam's two bases, so a new
// hardcoded call fails HERE — not on the next sim drive.
//
// The thin base is pinned by SOURCE TEXT: thin/ports/data.vite.ts imports
// ../env (import.meta), which jest cannot parse — the same constraint that
// put deliverFile in a sibling module.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sameOriginDataPort } from '@/lib/ports/data-port'

const ROOT = join(process.cwd(), 'src/components')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('exportBase seam coverage (Greptile P1, #588)', () => {
  it('no component hardcodes the cookie-only /api/export path', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => /['"`]\/api\/export/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(process.cwd() + '/', ''))
    expect(offenders).toEqual([])
  })

  it('the seam bases: web same-origin, thin facade twin', () => {
    expect(sameOriginDataPort.exportBase).toBe('/api/export')
    const viteSource = readFileSync(join(process.cwd(), 'thin/ports/data.vite.ts'), 'utf8')
    expect(viteSource).toMatch(/exportBase:\s*'\/api\/app\/v1\/export'/)
  })
})
