# Phase 7: Export - Research

**Researched:** 2026-03-13
**Domain:** PDF generation with Japanese font support; plain text file download in Next.js App Router
**Confidence:** HIGH (stack decision) / MEDIUM (server-side font path pattern)

## Summary

Phase 7 has two requirements: PDF export of a karute record with Japanese character support (EXP-01), and plain text export (EXP-02). Plain text export is trivial — a route handler returning `text/plain` with a `Content-Disposition: attachment` header. PDF export is where the complexity lives.

The standard library for PDF generation in a React/Next.js project is `@react-pdf/renderer` (v4.3.2). The critical finding is that Next.js 16 **already includes `@react-pdf/renderer` in its built-in `serverExternalPackages` list** (confirmed from official Next.js 16.1.6 docs, updated 2026-02-27). This means no `next.config.js` modification is required for the library to work in App Router route handlers. Historical issues with `renderToStream` in Next.js 13-15 stemmed from React version conflicts in the dependency tree. The project uses React 19 (via Next.js 16), and `@react-pdf/renderer` v4.1.0+ explicitly supports React 19 — so the combination should work.

Noto Sans JP font files are large (4–9 MB per weight for language-specific TTF). Only two weights are needed (Regular and Bold). The font must be stored as static TTF files in `public/fonts/` and registered using an absolute path constructed with `process.cwd()` in the route handler. Font registration must happen at module level (once, outside the render function) to avoid redundant re-registration on every request. Variable-weight font files do not work with react-pdf — only static weight TTF files are supported.

**Primary recommendation:** Use `@react-pdf/renderer` v4.3.2 for PDF generation in a Next.js App Router route handler at `app/api/karute/[id]/export/pdf/route.ts`. Serve Noto Sans JP Regular and Bold TTF files from `public/fonts/`. Use a plain route handler returning `text/plain` for the text export. Both exports are triggered by a `<a href>` or button on the karute detail view that navigates to the API route.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @react-pdf/renderer | ^4.3.2 | PDF document generation with React components | Only React-native PDF library with SSR-compatible Node API; active maintenance; React 19 support since v4.1.0 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Noto Sans JP (TTF files) | 2014–2024 static weights | Japanese character rendering in PDF | Required for EXP-01; embed directly via Font.register |

### Already in Stack (no new packages)
| Library | Purpose | Phase Established |
|---------|---------|-------------------|
| next (App Router) | Route handler for download endpoints | Phase 1 |
| @supabase/ssr | Fetch karute record data server-side | Phase 1 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @react-pdf/renderer | Puppeteer/playwright + headless Chromium | Puppeteer supports CJK via OS fonts but is very heavy (100MB+ binary), slow on serverless, and requires `@sparticuz/chromium` for Vercel. react-pdf is ~2MB and pure Node. |
| @react-pdf/renderer | pdfmake | pdfmake has simpler font registration but uses a declarative JSON DSL instead of JSX. react-pdf keeps the PDF layout in React components, consistent with the rest of the codebase. |
| @react-pdf/renderer | jsPDF + html2canvas | Client-side only; inconsistent rendering across browsers; no server-side generation. Not appropriate for a server-generated download. |
| TTF fonts from public/ | Fetching from Google Fonts CDN at render time | CDN fetch adds latency, fails offline, and introduces an external dependency at PDF generation time. Local file is reliable. |

**Installation:**
```bash
npm install @react-pdf/renderer
```

Font files must be downloaded manually (not via npm):
- Download Noto Sans JP from Google Fonts: https://fonts.google.com/noto/specimen/Noto+Sans+JP
- Unzip and locate the `static/` subfolder
- Copy `NotoSansJP-Regular.ttf` and `NotoSansJP-Bold.ttf` into `public/fonts/`

## Architecture Patterns

### Recommended File Structure for Phase 7

```
public/
└── fonts/
    ├── NotoSansJP-Regular.ttf    # ~4MB — Noto Sans JP Regular weight
    └── NotoSansJP-Bold.ttf       # ~4MB — Noto Sans JP Bold weight

src/
├── app/
│   └── api/
│       └── karute/
│           └── [id]/
│               └── export/
│                   ├── pdf/
│                   │   └── route.ts   # GET /api/karute/[id]/export/pdf
│                   └── text/
│                       └── route.ts   # GET /api/karute/[id]/export/text
├── components/
│   └── karute/
│       ├── KarutePdfDocument.tsx      # @react-pdf/renderer Document component
│       └── ExportButtons.tsx          # Client component with export links
└── lib/
    └── karute/
        └── formatKaruteText.ts        # Plain text formatter (no deps)
```

### Pattern 1: PDF Route Handler with renderToStream

**What:** Next.js App Router route handler that fetches a karute record from Supabase, renders it as a PDF using `@react-pdf/renderer`, and streams it back as a download.

**When to use:** The GET endpoint for PDF export.

**Key constraint:** `@react-pdf/renderer` is automatically in `serverExternalPackages` in Next.js 16 — no config change needed.

```typescript
// Source: Next.js Route Handlers docs (v16.1.6, lastUpdated 2026-02-27)
// Source: @react-pdf/renderer Node API — https://react-pdf.org/node
// app/api/karute/[id]/export/pdf/route.ts

import { renderToStream } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { KarutePdfDocument } from '@/components/karute/KarutePdfDocument'
import { type NextRequest } from 'next/server'

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/karute/[id]/export/pdf'>
) {
  const { id } = await ctx.params

  // Authorization: must be authenticated staff
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const karute = await getKaruteRecord(id)
  if (!karute) {
    return new Response('Not Found', { status: 404 })
  }

  const stream = await renderToStream(<KarutePdfDocument karute={karute} />)

  // Convert Node.js readable stream to Web ReadableStream for Response
  const webStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
      stream.on('end', () => controller.close())
      stream.on('error', (err: Error) => controller.error(err))
    },
  })

  const customerName = karute.customers?.name ?? 'karute'
  const date = new Date(karute.created_at).toISOString().split('T')[0]
  const filename = `karute-${customerName}-${date}.pdf`

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
```

### Pattern 2: PDF Document Component with Noto Sans JP

**What:** A `@react-pdf/renderer` `Document` component defining the karute record layout. Font registration happens at module level, outside the component, so it runs once.

**When to use:** Imported by the PDF route handler.

**Font loading:** In a route handler context (server-side Node.js), the font `src` must be an absolute filesystem path. Use `process.cwd()` to construct it from the project root.

```typescript
// Source: @react-pdf/renderer fonts API — https://react-pdf.org/fonts
// Source: Community pattern — absolute path via process.cwd() for Node.js server context
// components/karute/KarutePdfDocument.tsx
// Note: NO 'use client' directive — this is used only in the route handler (server)

import path from 'path'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

// Register fonts at module level — runs once when the module is first imported.
// process.cwd() returns the Next.js project root in both dev and production.
Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf'),
      fontWeight: 'normal',
    },
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Bold.ttf'),
      fontWeight: 'bold',
    },
  ],
})

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 10,
    padding: 40,
    lineHeight: 1.6,
    color: '#1a1a1a',
  },
  heading: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subheading: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 4,
  },
  text: {
    marginBottom: 4,
  },
  entryContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  entryCategory: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#555555',
    marginBottom: 2,
  },
})

export function KarutePdfDocument({ karute }: { karute: KaruteWithRelations }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>
          {karute.customers?.name ?? '—'} — カルテ
        </Text>
        <Text style={styles.text}>
          {new Date(karute.created_at).toLocaleDateString('ja-JP')}
        </Text>

        <Text style={styles.subheading}>AI サマリー</Text>
        <Text style={styles.text}>{karute.summary}</Text>

        <Text style={styles.subheading}>エントリー</Text>
        {karute.entries?.map((entry) => (
          <View key={entry.id} style={styles.entryContainer}>
            <Text style={styles.entryCategory}>{entry.category}</Text>
            <Text style={styles.text}>{entry.content}</Text>
            {entry.source_quote ? (
              <Text style={[styles.text, { color: '#666666', fontSize: 9 }]}>
                &quot;{entry.source_quote}&quot;
              </Text>
            ) : null}
          </View>
        ))}

        <Text style={styles.subheading}>トランスクリプト</Text>
        <Text style={styles.text}>{karute.transcript}</Text>
      </Page>
    </Document>
  )
}
```

### Pattern 3: Plain Text Route Handler

**What:** A simple route handler that formats karute data as structured plain text and returns it as a `.txt` download.

**When to use:** The GET endpoint for plain text export.

```typescript
// Source: Next.js Route Handlers docs (v16.1.6, lastUpdated 2026-02-27)
// app/api/karute/[id]/export/text/route.ts

import { createClient } from '@/lib/supabase/server'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { formatKaruteAsText } from '@/lib/karute/formatKaruteText'
import { type NextRequest } from 'next/server'

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/karute/[id]/export/text'>
) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const karute = await getKaruteRecord(id)
  if (!karute) {
    return new Response('Not Found', { status: 404 })
  }

  const text = formatKaruteAsText(karute)
  const customerName = karute.customers?.name ?? 'karute'
  const date = new Date(karute.created_at).toISOString().split('T')[0]
  const filename = `karute-${customerName}-${date}.txt`

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
```

### Pattern 4: Plain Text Formatter

**What:** A pure function that formats a `KaruteWithRelations` record as structured, human-readable plain text. No external dependencies needed.

```typescript
// lib/karute/formatKaruteText.ts
import type { KaruteWithRelations } from '@/lib/supabase/karute'

export function formatKaruteAsText(karute: KaruteWithRelations): string {
  const lines: string[] = []
  const date = new Date(karute.created_at).toLocaleDateString('ja-JP')
  const customer = karute.customers?.name ?? '—'

  lines.push(`カルテ`)
  lines.push(`顧客: ${customer}`)
  lines.push(`日付: ${date}`)
  lines.push(``)
  lines.push(`===== AI サマリー =====`)
  lines.push(karute.summary ?? '')
  lines.push(``)
  lines.push(`===== エントリー =====`)

  for (const entry of karute.entries ?? []) {
    lines.push(``)
    lines.push(`[${entry.category}]`)
    lines.push(entry.content)
    if (entry.source_quote) {
      lines.push(`  引用: "${entry.source_quote}"`)
    }
  }

  lines.push(``)
  lines.push(`===== トランスクリプト =====`)
  lines.push(karute.transcript ?? '')

  return lines.join('\n')
}
```

### Pattern 5: Export Buttons on Karute Detail View

**What:** Client component rendering two download links pointing to the API routes. Using `<a href>` tags (not `fetch`) so the browser handles the download natively without JavaScript buffer management.

```typescript
// Source: Standard browser download pattern
// components/karute/ExportButtons.tsx
'use client'

export function ExportButtons({ karuteId }: { karuteId: string }) {
  return (
    <div className="flex gap-2">
      <a
        href={`/api/karute/${karuteId}/export/pdf`}
        download
        className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90"
      >
        PDF 出力
      </a>
      <a
        href={`/api/karute/${karuteId}/export/text`}
        download
        className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm border border-input bg-background hover:bg-accent"
      >
        テキスト出力
      </a>
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **Registering Font.register() inside the component function body:** Re-runs on every render/request. Always register at module level.
- **Using variable-weight (VF) Noto Sans JP fonts:** react-pdf does not support OpenType variable fonts — the PDF 2.0 spec does not allow them. Always use static weight TTF files from the `static/` subfolder of the Google Fonts download.
- **Using `PDFViewer` or `PDFDownloadLink` in a server context:** These are browser-only components. The route handler approach uses `renderToStream` — no browser APIs involved.
- **Fetching the font from Google Fonts CDN at render time:** Introduces network latency per export, fails offline, and depends on an external service. Use local TTF files.
- **Calling `fetch('/api/karute/[id]/export/pdf')` in JavaScript and managing a Blob:** More complex than needed. Using `<a href download>` lets the browser handle the download directly.
- **Using a relative path for font `src` in Font.register():** Relative paths do not resolve correctly in Next.js route handler context. Use `path.join(process.cwd(), 'public', 'fonts', 'filename.ttf')`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF document layout with multiple pages | Custom PDF binary serialization | @react-pdf/renderer | PDF binary format is extremely complex; font embedding, unicode, page breaks all handled by the library |
| Japanese character encoding in PDF | Manual Unicode → PDF encoding | @react-pdf/renderer + Noto Sans JP TTF | CJK glyph encoding in PDF requires complex subsetting and cmap tables; the library handles this |
| Stream to Response conversion | Custom buffer accumulation | ReadableStream wrapper pattern | The 6-line pattern shown above is standard and correct; buffering the entire PDF in memory is wasteful for large documents |
| Text file encoding for Japanese | Manual BOM/encoding handling | UTF-8 with `charset=utf-8` content-type header | Browsers handle UTF-8 correctly when declared; no BOM needed for txt downloads |

**Key insight:** PDF generation is one of the most complex binary formats to produce correctly. react-pdf handles font embedding, ligatures, line breaks, Unicode, and PDF structure. The only custom work is the layout component and the font files.

## Common Pitfalls

### Pitfall 1: Variable Font vs. Static Font Confusion

**What goes wrong:** Downloading Noto Sans JP from Google Fonts and using the top-level `.ttf` file (the variable font). react-pdf fails silently or renders boxes for all Japanese characters.

**Why it happens:** Google Fonts packages variable fonts at the root and static weight fonts in a `static/` subdirectory. The variable font is not supported by react-pdf.

**How to avoid:** After downloading and unzipping, look for the `static/` subfolder. Copy `NotoSansJP-Regular.ttf` and `NotoSansJP-Bold.ttf` from `static/` — not from the root of the zip.

**Warning signs:** PDF generates without error but Japanese characters appear as squares or are missing entirely.

### Pitfall 2: Font Registration Inside Component Function

**What goes wrong:** Placing `Font.register()` inside the component function body. Every request to the export route re-registers the font, causing memory growth and slower PDF generation over time.

**Why it happens:** Developers follow React patterns of co-locating setup with the component.

**How to avoid:** Place all `Font.register()` calls at module level, outside any function, so they run once when the module loads.

**Warning signs:** Memory usage increases with each PDF export; performance degrades under load.

### Pitfall 3: Font Path Incorrect in Production

**What goes wrong:** Font loaded successfully in development (`process.cwd()` = project root) but fails in production because the build output changes directory structure.

**Why it happens:** In Next.js production builds, `process.cwd()` still points to the project root directory. However, if deploying to Vercel or a container, the `public/` directory is included in the deployment and accessible via `process.cwd() + '/public'`. This should work — but if fonts are accidentally excluded from deployment (e.g., via `.vercelignore` or a Docker COPY that misses `public/`), the path will fail silently.

**How to avoid:** Verify `public/fonts/` is included in deployment. Add a startup check that logs whether font files exist.

**Warning signs:** PDF exports work locally but return 500 in production; check server logs for `ENOENT` errors on font paths.

### Pitfall 4: PDF Component Uses React Hooks or Context

**What goes wrong:** The `KarutePdfDocument` component is used in a server-side route handler. If it imports or uses React hooks (`useState`, `useEffect`) or context, it will throw at runtime because the route handler is not a React client component context.

**Why it happens:** react-pdf uses its own React reconciler — it is not a client component, and it does not support React hooks.

**How to avoid:** Keep `KarutePdfDocument` as a pure data-in → PDF-out component with no hooks or side effects. All data is passed as props from the route handler.

**Warning signs:** `Error: Invalid hook call` during PDF generation in the route handler.

### Pitfall 5: Noto Sans JP File Size Impact on Cold Start

**What goes wrong:** Loading two ~4MB TTF font files on every cold start of the serverless function adds noticeable startup latency.

**Why it happens:** Font files are read from disk on first use. In a serverless environment, cold starts re-run module initialization.

**How to avoid:** `Font.register()` only registers the path — it does not load the file until the font is actually used. The first PDF generation request after a cold start will be slower (~1-2s extra) while the font loads. This is acceptable for an infrequently-used export feature. If unacceptable, cache the font buffer in module scope after first load.

**Warning signs:** First PDF export after deployment is noticeably slower than subsequent exports.

### Pitfall 6: Missing Authentication Check on Export Routes

**What goes wrong:** The export route handler is called without authentication, leaking karute record data (transcript, summary, personal information) to unauthenticated users.

**Why it happens:** Route handlers do not automatically inherit auth middleware from the app layout.

**How to avoid:** Always call `supabase.auth.getUser()` at the top of the route handler and return 401 if no authenticated user. Add RLS to `karute_records` in Supabase so the DB query returns nothing even if the auth check is somehow bypassed.

**Warning signs:** `curl /api/karute/[any-valid-id]/export/pdf` returns a PDF without any login.

## Code Examples

Verified patterns from official sources:

### renderToStream with Node Readable → Web ReadableStream conversion

```typescript
// Source: @react-pdf/renderer Node API (https://react-pdf.org/node)
// Source: Next.js Route Handlers (v16.1.6, 2026-02-27)
import { renderToStream } from '@react-pdf/renderer'

const nodeStream = await renderToStream(<KarutePdfDocument karute={karute} />)

const webStream = new ReadableStream({
  start(controller) {
    nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
    nodeStream.on('end', () => controller.close())
    nodeStream.on('error', (err: Error) => controller.error(err))
  },
})

return new Response(webStream, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="karute.pdf"`,
  },
})
```

### Font registration with absolute path

```typescript
// Source: @react-pdf/renderer font docs (https://react-pdf.org/fonts)
// Pattern: process.cwd() for Next.js server context (community-verified)
import path from 'path'
import { Font } from '@react-pdf/renderer'

Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf'),
      fontWeight: 'normal',
    },
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Bold.ttf'),
      fontWeight: 'bold',
    },
  ],
})
```

### Text download route handler

```typescript
// Source: Next.js Route Handlers docs (v16.1.6, 2026-02-27)
return new Response(plainTextString, {
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="karute.txt"`,
  },
})
```

### Route Context typing in Next.js 16

```typescript
// Source: Next.js Route Handlers docs (v16.1.6, 2026-02-27)
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/karute/[id]/export/pdf'>
) {
  const { id } = await ctx.params
  // ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `serverComponentsExternalPackages` in `experimental` | `serverExternalPackages` (stable, top-level) | Next.js 15.0.0 | `@react-pdf/renderer` now auto-included in built-in list — no config needed |
| Puppeteer for server-side PDF with CJK | `@react-pdf/renderer` + local TTF | 2023–2025 | react-pdf is faster, lighter, and has no OS dependency; Puppeteer still needed for pixel-perfect HTML-to-PDF |
| Pages Router API routes for PDF generation | App Router Route Handlers | Next.js 13+ (stable in 15+) | Route handlers in `app/api/` are the correct location for server-side file generation |
| Registering fonts via HTTP URL at render time | Local TTF files via `process.cwd()` | Community best practice | HTTP registration is fragile; local file is reliable in Node context |

**Deprecated/outdated:**
- `serverComponentsExternalPackages` (experimental): replaced by `serverExternalPackages` (stable) in Next.js 15+. Do not use the old key.
- Browser-only PDF download via `jsPDF` + `html2canvas`: Produces inconsistent output across browsers and cannot run server-side. Not appropriate for this use case.

## Open Questions

1. **Font loading in Next.js 16 production build with `process.cwd()`**
   - What we know: `process.cwd()` returns the project root in both dev and production for standard Node.js deployments. `public/` is copied to the production output.
   - What's unclear: In edge cases (Docker with non-standard working directory, or if running in Vercel's Edge Runtime instead of Node Runtime), `process.cwd()` may behave differently. The route handler must run in Node Runtime, not Edge Runtime.
   - Recommendation: Add `export const runtime = 'nodejs'` at the top of both export route files to explicitly enforce Node Runtime, preventing accidental Edge Runtime execution where file system access is unavailable.

2. **`renderToStream` compatibility with React 19 + Next.js 16**
   - What we know: `@react-pdf/renderer` v4.1.0+ supports React 19. Next.js 16 auto-includes the library in `serverExternalPackages`. The combination resolves historical "PDFDocument is not a constructor" / "Minified React error #31" errors that affected Next.js 15 + React 18 mixtures.
   - What's unclear: No definitive confirmation for Next.js 16 specifically — most community reports stop at Next.js 15. If the combination fails, the fallback is to run PDF generation in a separate API server.
   - Recommendation: Treat this as HIGH confidence based on the chain of evidence (React 19 support added in v4.1.0, Next.js 16 lists the library in built-in serverExternalPackages), but plan a validation step early in task 07-01 to confirm `renderToStream` works before building the full document layout.

3. **Font file size and Vercel deployment limits**
   - What we know: Noto Sans JP Regular and Bold TTF static files are approximately 4MB each. Total: ~8MB added to `public/`.
   - What's unclear: Vercel's free tier has a 100MB deployment size limit. 8MB is well within this limit. Not an issue.
   - Recommendation: No action needed.

## Sources

### Primary (HIGH confidence)
- [Next.js serverExternalPackages docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — v16.1.6, lastUpdated 2026-02-27. Confirms `@react-pdf/renderer` is in the built-in list.
- [Next.js Route Handlers docs](https://nextjs.org/docs/app/getting-started/route-handlers) — v16.1.6, lastUpdated 2026-02-27. Response API, GET handler pattern, RouteContext typing.
- [@react-pdf/renderer Node API docs](https://react-pdf.org/node) — renderToStream, renderToFile, renderToString function signatures.
- [@react-pdf/renderer Font docs](https://react-pdf.org/fonts) — TTF/WOFF only, Font.register() API, multi-weight registration.
- [@react-pdf/renderer Compatibility docs](https://react-pdf.org/compatibility) — React 19 supported since v4.1.0; Next.js >=14.1.1 required for App Router; `serverExternalPackages` workaround documented.

### Secondary (MEDIUM confidence)
- [GitHub Issue #3074 — NodeJS renderToBuffer not working with Next 15](https://github.com/diegomura/react-pdf/issues/3074) — Root cause (React internal API conflict) and fix (upgrade React to 19, add `serverExternalPackages`). Confirms the issue is resolved with React 19.
- [GitHub Issue #2816 — Font.register issue on server component](https://github.com/diegomura/react-pdf/issues/2816) — Font.register does not work in RSC but does work in route handlers and client components.
- [GitHub Issue #2223 — Unable to load local font in Next.js](https://github.com/diegomura/react-pdf/issues/2223) — Confirms absolute paths work; relative paths do not.
- [Google Fonts — Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) — Download source for static weight TTF files.
- [Money Forward Dev Blog — Creating PDFs using React JS (2025-11)](https://global.moneyforward-dev.jp/2025/11/14/creating-pdfs-using-react-js/) — Production usage of react-pdf with Japanese content.

### Tertiary (LOW confidence)
- Community pattern for `process.cwd()` font path in route handlers — verified conceptually (Node.js docs confirm `process.cwd()` behavior) but no single authoritative source confirms it works for `Font.register` in Next.js 16 route handlers specifically.
- Noto Sans JP static TTF file sizes (~4MB each) — estimated from community reports; exact sizes vary by download.

## Metadata

**Confidence breakdown:**
- Standard stack (`@react-pdf/renderer`): HIGH — confirmed current version, React 19 support, Next.js built-in serverExternalPackages inclusion
- PDF route handler architecture: HIGH — official Next.js docs confirm pattern; React 19 + v4.1.0+ resolves historical compat issues
- Font loading (`process.cwd()` absolute path): MEDIUM — conceptually sound, community-supported, but not officially documented for this exact combination
- `renderToStream` on Next.js 16: MEDIUM — strong chain of evidence but no Next.js 16-specific confirmation found; validate early in implementation
- Plain text export: HIGH — trivial route handler with standard Response API; no novel patterns

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (react-pdf releases infrequently; Next.js minor releases unlikely to break serverExternalPackages behavior)
