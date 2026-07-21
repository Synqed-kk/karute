// Pending-tabs drift guard (S1 fix batch). PENDING_TAB_IDS
// (thin/screens/SettingsScreen.tsx) and PENDING_SECTION_FILES
// (thin/vite.config.ts) are two hand-kept lists with no coupling between
// them: one gates which tabs SettingsShell renders as the in-shell 準備中
// panel, the other excludes the matching section files from the thin
// bundle. If the two drift (a tab's id and its section-file exclusion fall
// out of step), a live tab can render a null-ported bundle chunk — a blank
// production tab. Neither list is exported (both stay internal consts), and
// thin/vite.config.ts also pulls in vite/@vitejs/plugin-react which this
// suite has no need to load — so this test parses the raw source instead of
// importing, same idiom as thin-router-settings.test.tsx's PENDING_WEB_ROUTES
// pin.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Tab id → its section file. Mirrors the pairing both source files already
// document in their own header comments (design-parity packet 12 §S1).
const SECTION_FILE_BY_TAB: Record<string, string> = {
  stores: 'StoresSection.tsx',
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

describe('pending-tabs drift guard (SettingsScreen.tsx PENDING_TAB_IDS vs vite.config.ts PENDING_SECTION_FILES)', () => {
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
})
