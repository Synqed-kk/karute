// The F-9 lesson as a guard: a component that hardcodes a cookie-only
// `/api/ai/*` path renders fine in the shell but 401s on every send (the sweep
// found three: chat, review suggestions, profile regenerate). Every AI call in
// a component must go through the recording port's aiBase seam instead. This
// scans src/components for the literal and pins the seam's two bases, so a new
// hardcoded call fails HERE — not on the next sim drive.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { webRecordingPort } from '@/lib/ports/recording-port'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'

const ROOT = join(process.cwd(), 'src/components')

// Deliberate exemptions:
//  - AIAdvice.tsx is dead code (rendered nowhere; surgical rule says leave it).
const ALLOWED = new Set(['src/components/karute/AIAdvice.tsx'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('aiBase seam coverage (F-9b/c/d)', () => {
  it('no component hardcodes a cookie-only /api/ai/* path', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => /['"`]\/api\/ai\//.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(process.cwd() + '/', ''))
      .filter((rel) => !ALLOWED.has(rel))
    expect(offenders).toEqual([])
  })

  it('the seam bases: web same-origin, thin facade twins', () => {
    expect(webRecordingPort.aiBase).toBe('/api/ai')
    expect(viteRecordingPort.aiBase).toBe('/api/app/v1/ai')
  })
})
