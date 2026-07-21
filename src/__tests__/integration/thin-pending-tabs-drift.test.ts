// Pending-tabs drift guard (S1 fix batch, extended to THREE-way at packet 12
// §B-3 S2 audit). Three hand-kept lists with no coupling between them:
// PENDING_TAB_IDS (thin/screens/SettingsScreen.tsx) gates which tabs
// SettingsShell renders as the in-shell 準備中 panel; PENDING_SECTION_FILES
// (thin/vite.config.ts) excludes the matching section files from the thin
// bundle at the Rollup boundary; the named exports of
// thin/ports/pending-sections-excluded.tsx are what those excluded files
// resolve TO (the null-render stand-in). If any pair drifts (a tab's id, its
// vite.config.ts exclusion, and its null-export all fall out of step), a
// live tab can render a null-ported bundle chunk — a blank production tab —
// OR (removing an export while the other two stay consistent) the Rollup
// build itself breaks with no test catching it first. Neither
// PENDING_TAB_IDS nor PENDING_SECTION_FILES is exported (both stay internal
// consts), and thin/vite.config.ts also pulls in vite/@vitejs/plugin-react
// which this suite has no need to load — so this test parses all three raw
// sources instead of importing, same idiom as
// thin-router-settings.test.tsx's PENDING_WEB_ROUTES pin.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Tab id → its section file/export name. Mirrors the pairing all three
// source files already document in their own header comments (design-parity
// packet 12 §S1/§B-3 S2).
const SECTION_FILE_BY_TAB: Record<string, string> = {
  staff: 'StaffSection.tsx',
  sync: 'SyncSection.tsx',
  audit: 'AuditLogSection.tsx',
}

function pendingTabIds(): string[] {
  const src = readFileSync(join(process.cwd(), 'thin/screens/SettingsScreen.tsx'), 'utf8')
  const match = /const PENDING_TAB_IDS[^=]*=\s*\[([\s\S]*?)\]/.exec(src)
  if (!match) throw new Error('PENDING_TAB_IDS not found in thin/screens/SettingsScreen.tsx')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function pendingSectionFiles(): string[] {
  const src = readFileSync(join(process.cwd(), 'thin/vite.config.ts'), 'utf8')
  const match = /const PENDING_SECTION_FILES = new Set\(\s*\[([\s\S]*?)\]/.exec(src)
  if (!match) throw new Error('PENDING_SECTION_FILES not found in thin/vite.config.ts')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Named (non-default) exports of pending-sections-excluded.tsx — the
 *  null-render stand-ins the vite boundary substitutes for each excluded
 *  section file. */
function pendingExcludedExports(): string[] {
  const src = readFileSync(
    join(process.cwd(), 'thin/ports/pending-sections-excluded.tsx'),
    'utf8',
  )
  return [...src.matchAll(/^export const (\w+) = Excluded$/gm)].map((m) => m[1])
}

describe('pending-tabs drift guard — THREE-way: PENDING_TAB_IDS ⋄ PENDING_SECTION_FILES ⋄ pending-sections-excluded.tsx exports', () => {
  it('every pending tab id has a matching excluded section file, and vice versa', () => {
    const tabs = pendingTabIds()
    const files = pendingSectionFiles()

    expect(tabs.length).toBeGreaterThan(0)
    expect(files.length).toBe(tabs.length)

    for (const tab of tabs) {
      const file = SECTION_FILE_BY_TAB[tab]
      if (!file) {
        throw new Error(
          `pending tab "${tab}" has no known section file — update SECTION_FILE_BY_TAB in this test`,
        )
      }
      expect(files.some((f) => f.endsWith(`/${file}`))).toBe(true)
    }

    for (const file of files) {
      const matchedTab = Object.entries(SECTION_FILE_BY_TAB).find(([, f]) =>
        file.endsWith(`/${f}`),
      )?.[0]
      expect(matchedTab).toBeDefined()
      expect(tabs).toContain(matchedTab)
    }
  })

  it('every pending tab has a matching null-export in pending-sections-excluded.tsx, and vice versa (removing an export must fail HERE, not just the Rollup build)', () => {
    const tabs = pendingTabIds()
    const exportNames = pendingExcludedExports()

    expect(exportNames.length).toBe(tabs.length)

    for (const tab of tabs) {
      const file = SECTION_FILE_BY_TAB[tab]
      const exportName = file?.replace(/\.tsx$/, '')
      expect(exportName).toBeTruthy()
      expect(exportNames).toContain(exportName)
    }

    for (const exportName of exportNames) {
      const matchedTab = Object.entries(SECTION_FILE_BY_TAB).find(
        ([, f]) => f === `${exportName}.tsx`,
      )?.[0]
      expect(matchedTab).toBeDefined()
      expect(tabs).toContain(matchedTab)
    }
  })
})
