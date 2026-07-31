// Ja-sweep pin (packet 27): every export scope/format/filter/column/group
// carries a non-empty Ja twin, so a future English-only addition to
// src/lib/export/scopes.ts regresses loudly instead of silently.
import { SCOPES, FORMATS, GROUP_LABELS_JA } from '@/lib/export/scopes'

describe('export scopes — Ja completeness', () => {
  it('every scope has a non-empty labelJa + subJa', () => {
    for (const scope of Object.values(SCOPES)) {
      expect(scope.labelJa.length).toBeGreaterThan(0)
      expect(scope.subJa.length).toBeGreaterThan(0)
    }
  })

  it('every column has a non-empty labelJa, and its group has a mapped Ja label', () => {
    for (const scope of Object.values(SCOPES)) {
      for (const col of scope.columns) {
        expect(col.labelJa.length).toBeGreaterThan(0)
        expect(GROUP_LABELS_JA[col.group]?.length).toBeGreaterThan(0)
      }
    }
  })

  it('every filter has a non-empty labelJa', () => {
    for (const scope of Object.values(SCOPES)) {
      for (const f of scope.filters) {
        expect(f.labelJa.length).toBeGreaterThan(0)
      }
    }
  })

  it('every format has a non-empty subJa + metaJa', () => {
    for (const fmt of FORMATS) {
      expect(fmt.subJa.length).toBeGreaterThan(0)
      expect(fmt.metaJa.length).toBeGreaterThan(0)
    }
  })
})
