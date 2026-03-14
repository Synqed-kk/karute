---
phase: 07-export
verified: 2026-03-14T17:38:17Z
status: passed
score: 10/10 must-haves verified
re_verification: false
human_verification:
  - test: "Download PDF from karute detail view"
    expected: "Browser downloads a PDF file; Japanese characters (customer name, section headers, entries) render as readable Japanese text, not boxes or mojibake"
    why_human: "Font embedding and CJK rendering in react-pdf cannot be verified programmatically — requires visual inspection of the rendered PDF"
---

# Phase 7: Export Verification Report

**Phase Goal:** A staff member can export any karute record as a formatted PDF (with Japanese character support) or as plain text for use outside the app.
**Verified:** 2026-03-14T17:38:17Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /api/karute/{id}/export/pdf returns a downloadable PDF file | VERIFIED | route.tsx: exports GET, returns Response with Content-Type: application/pdf and Content-Disposition attachment |
| 2 | PDF contains customer name, date, AI summary, categorized entries, and transcript | VERIFIED | KarutePdfDocument.tsx renders all five sections: heading with customerName, dateLine, AI サマリー, エントリー (mapped entries), トランスクリプト |
| 3 | Japanese characters render correctly in the PDF using Noto Sans JP font | VERIFIED (automated) | Font.register at module level with both Regular (5.1MB) and Bold (5.1MB) static TTFs; page style sets fontFamily: 'NotoSansJP'; human verification recommended |
| 4 | Unauthenticated requests to the PDF route return 401 | VERIFIED | route.tsx lines 20-26: supabase.auth.getUser() check, returns new Response('Unauthorized', { status: 401 }) if no user |
| 5 | Requesting a nonexistent karute ID returns 404 | VERIFIED | route.tsx lines 29-33: getKaruteRecord(id) null check, returns new Response('Not Found', { status: 404 }) |
| 6 | GET /api/karute/{id}/export/text returns a downloadable .txt file | VERIFIED | text/route.ts: exports GET, returns Response with Content-Type: text/plain; charset=utf-8 and Content-Disposition attachment |
| 7 | Text file contains customer name, date, AI summary, entries by category, and transcript | VERIFIED | formatKaruteText.ts: カルテ header, 顧客/日付 lines, ===== AI サマリー =====, ===== エントリー ===== with [category] labels, ===== トランスクリプト ===== |
| 8 | Japanese text is preserved correctly in the downloaded file (UTF-8) | VERIFIED | Response header: 'Content-Type': 'text/plain; charset=utf-8'; formatKaruteAsText returns a JS string (always UTF-16 internally, encoded to UTF-8 by Node.js Response) |
| 9 | Unauthenticated requests to the text route return 401 | VERIFIED | text/route.ts lines 16-22: same auth pattern as PDF route, returns 401 if no user |
| 10 | Export buttons appear on the karute detail view linking to both PDF and text download routes | VERIFIED | ExportButtons.tsx: two <a> tags with href /api/karute/${karuteId}/export/pdf and /api/karute/${karuteId}/export/text, both with download attribute; KaruteDetailView.tsx line 31: <ExportButtons karuteId={karute.id} /> |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `public/fonts/NotoSansJP-Regular.ttf` | Noto Sans JP Regular weight for PDF rendering | VERIFIED | 5,324,144 bytes — valid static weight TrueType font |
| `public/fonts/NotoSansJP-Bold.ttf` | Noto Sans JP Bold weight for PDF rendering | VERIFIED | 5,319,680 bytes — valid static weight TrueType font |
| `src/components/karute/KarutePdfDocument.tsx` | react-pdf Document component for karute layout | VERIFIED | Font.register at module level, full layout with all 5 sections |
| `src/app/api/karute/[id]/export/pdf/route.tsx` | GET route handler for PDF export | VERIFIED | Exports GET, export const runtime = 'nodejs' |
| `src/lib/karute/formatKaruteText.ts` | Pure function to format karute record as structured plain text | VERIFIED | Exports formatKaruteAsText, no side effects, all required sections present |
| `src/app/api/karute/[id]/export/text/route.ts` | GET route handler for plain text export | VERIFIED | Exports GET, export const runtime = 'nodejs' |
| `src/components/karute/ExportButtons.tsx` | Client component with PDF and text download links | VERIFIED | 'use client', two anchor tags with correct href and download attributes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pdf/route.tsx | KarutePdfDocument.tsx | import and renderToStream | WIRED | Line 10: import { KarutePdfDocument }; line 37: renderToStream(React.createElement(KarutePdfDocument, { karute })) |
| pdf/route.tsx | src/lib/supabase/karute.ts | getKaruteRecord import | WIRED | Line 9: import { getKaruteRecord }; line 29: const karute = await getKaruteRecord(id) |
| KarutePdfDocument.tsx | public/fonts/ | Font.register with process.cwd() absolute path | WIRED | Lines 17-29: Font.register with path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf') and Bold variant |
| text/route.ts | formatKaruteText.ts | formatKaruteAsText import | WIRED | Line 7: import { formatKaruteAsText }; line 33: const text = formatKaruteAsText(karute) |
| text/route.ts | src/lib/supabase/karute.ts | getKaruteRecord import | WIRED | Line 6: import { getKaruteRecord }; line 26: const karute = await getKaruteRecord(id) |
| ExportButtons.tsx | /api/karute/[id]/export routes | anchor href links | WIRED | Lines 20-35: href /api/karute/${karuteId}/export/pdf and /api/karute/${karuteId}/export/text |
| KaruteDetailView.tsx | ExportButtons.tsx | import and render | WIRED | Line 7: import { ExportButtons }; line 31: <ExportButtons karuteId={karute.id} /> |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| EXP-01 (PDF export with Japanese font support) | SATISFIED | PDF route, KarutePdfDocument, font files all verified and wired |
| EXP-02 (Plain text export) | SATISFIED | Text route, formatKaruteAsText, ExportButtons all verified and wired |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, no stub implementations, no empty handlers found across all 5 implementation files.

### Additional Checks

- **TypeScript:** `npx tsc --noEmit` exits 0 — no type errors
- **@react-pdf/renderer:** package.json confirms `"@react-pdf/renderer": "^4.3.2"` installed
- **Font registration pattern:** Font.register called at module level (outside component function) — correct, prevents re-registration per request
- **Runtime declaration:** Both route files have `export const runtime = 'nodejs'` — required for file system access
- **Download pattern:** ExportButtons uses `<a href download>` — correct native browser download, no fetch/blob complexity
- **Note:** PDF route file has `.tsx` extension (route.tsx), not `.ts` as specified in the plan. This is acceptable — the SUMMARY explains React.createElement was used to avoid JSX complications; TypeScript passes cleanly.

### Human Verification Required

#### 1. Japanese Character Rendering in PDF

**Test:** Download a PDF from a karute detail view with Japanese content (customer name in Japanese, Japanese transcript)
**Expected:** PDF opens; Japanese characters in the heading, section labels (AI サマリー, エントリー, トランスクリプト), and body text all render as readable Japanese glyphs, not boxes or question marks
**Why human:** react-pdf font embedding and CJK glyph rendering cannot be asserted programmatically — requires visual inspection of the rendered PDF output

### Gaps Summary

No gaps. All 10 observable truths are verified. Both EXP-01 and EXP-02 requirements are satisfied. The only item deferred to human verification is the visual rendering quality of Japanese characters in the PDF, which is a confirmation check rather than a gap — the font files are correctly sized static-weight TTFs, Font.register is correctly configured, and the PDF content pipeline is fully wired.

---

_Verified: 2026-03-14T17:38:17Z_
_Verifier: Claude (gsd-verifier)_
