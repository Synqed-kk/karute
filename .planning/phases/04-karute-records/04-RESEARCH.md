# Phase 4: Karute Records - Research

**Researched:** 2026-03-13
**Domain:** Supabase multi-table CRUD, Next.js Server Actions, karute detail view, category tag UI
**Confidence:** HIGH

## Summary

Phase 4 connects Phase 2 (AI review screen) and Phase 3 (customer management) to produce a persistent karute record. The work is almost entirely standard Next.js App Router + Supabase CRUD — there are no novel patterns here. The main decisions are: (1) how to atomically save a karute record plus N entries in one operation, (2) the route structure for the karute detail view, and (3) the "+ Add Entry" form pattern.

Saving a karute record involves two tables: `karute_records` (transcript, summary, customer_id, staff_id, date) and `entries` (category, title, notes, source_quote, confidence_score, is_manual, karute_record_id). Supabase's JavaScript client does not support multi-table transactions natively — the correct approach is either: (a) sequential inserts in a Server Action (insert karute_record → get ID → insert entries with that ID), relying on Supabase's implicit row-level error handling; or (b) a Postgres RPC function that wraps both inserts atomically. For v1 with low concurrency, sequential inserts in a Server Action are sufficient and simpler. Use a Postgres RPC function only if rollback atomicity becomes a real requirement.

The karute detail view is a server-rendered page at `app/(app)/karute/[id]/page.tsx` that fetches a karute_record with nested customer and entries in a single Supabase query using PostgREST's automatic foreign-key join syntax. Next.js 16 requires `params` to be awaited as a Promise. The "+ Add Entry" UI uses a shadcn Sheet (slide-in panel) with a react-hook-form + zod form containing a category selector and notes fields — this is a confirmed pattern in shadcn/ui's own documentation.

**Primary recommendation:** Use sequential Server Action inserts for the save flow; use PostgREST nested select for the detail view fetch; use shadcn Sheet + react-hook-form for the "+ Add Entry" form.

## Standard Stack

No new packages are needed for Phase 4. All required libraries were established in Phases 1-3.

### Core (established in prior phases)

| Library | Version | Purpose | Phase Established |
|---------|---------|---------|-------------------|
| @supabase/supabase-js | ^2.99.1 | DB client — insert, select with joins | Phase 1 |
| @supabase/ssr | ^0.x | Server client for Server Actions | Phase 1 |
| next (App Router) | 16.1.6 | Server Actions, dynamic routes, redirect | Phase 1 |
| react-hook-form | ^7.x | Add Entry form management | Phase 1 |
| zod | ^4.3.6 | Add Entry form schema validation | Phase 1 |
| @hookform/resolvers | ^5.2.2 | zod + react-hook-form bridge | Phase 1 |
| shadcn/ui | CLI v4.0.5 | Badge (category tags), Sheet (add entry panel) | Phase 1 |
| next-intl | ^4.8.3 | i18n for all UI strings | Phase 1 |

### shadcn Components to Install (if not already present)

```bash
npx shadcn@latest add badge sheet select dialog
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sequential Server Action inserts | Postgres RPC function | RPC is atomic but requires writing PL/pgSQL. For v1, sequential inserts are simpler; the only risk is a partial save if entries insert fails after karute_record insert succeeds. Mitigate by wrapping in a try/catch that deletes the orphaned karute_record on failure. |
| shadcn Sheet for Add Entry | shadcn Dialog | Dialog is better for destructive confirmations. Sheet (slide-in from right) is the conventional UX for "add item" side panels. Either works — Sheet is used here to match the mockup's panel aesthetic. |
| Server-rendered detail page | Client-side fetch with SWR | Server rendering is correct for this page — it is not real-time, content does not change on the client after load, and server rendering avoids client JS waterfall. |

## Architecture Patterns

### Recommended File Structure for Phase 4

```
src/
├── app/
│   └── (app)/
│       └── karute/
│           └── [id]/
│               └── page.tsx          # Karute detail view (server component)
├── actions/
│   ├── karute.ts                     # saveKaruteRecord(), addManualEntry()
│   └── entries.ts                    # addEntry(), deleteEntry() (if not already)
├── components/
│   └── karute/
│       ├── KaruteDetailView.tsx      # Main layout: summary + transcript + entries
│       ├── EntryCard.tsx             # Single entry with category tag + confidence
│       ├── CategoryBadge.tsx         # Color-coded category tag component
│       ├── AddEntrySheet.tsx         # Sheet panel with react-hook-form
│       └── SaveKaruteFlow.tsx        # Customer selector + save button (Phase 2 connector)
└── types/
    └── karute.ts                     # KaruteRecord, Entry, EntryCategory types
```

### Pattern 1: Async Params in Next.js 16 Dynamic Route

**What:** In Next.js 16, `params` is a Promise — must be awaited before accessing segment values.

**When to use:** Every dynamic route page (`[id]/page.tsx`).

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes (v16.1.6, 2026-02-27)
export default async function KarутеDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const karute = await getKaruteRecord(id)
  if (!karute) notFound()
  return <KaruteDetailView karute={karute} />
}
```

### Pattern 2: Supabase Nested Select (PostgREST auto-join)

**What:** Fetch a karute_record with its entries and customer in one query using PostgREST's automatic foreign-key relationship detection.

**When to use:** Any detail page that needs a record plus related child rows.

**Requires:** Foreign keys defined in schema: `entries.karute_record_id → karute_records.id`, `karute_records.customer_id → customers.id`.

```typescript
// Source: https://supabase.com/docs/guides/database/joins-and-nesting
// lib/supabase/karute.ts
import { QueryData } from '@supabase/supabase-js'

const karuteWithRelationsQuery = supabase
  .from('karute_records')
  .select(`
    id,
    created_at,
    summary,
    transcript,
    customer_id,
    staff_id,
    customers ( id, name ),
    entries (
      id,
      category,
      title,
      notes,
      source_quote,
      confidence_score,
      is_manual,
      created_at
    )
  `)

export type KaruteWithRelations = QueryData<typeof karuteWithRelationsQuery>

export async function getKaruteRecord(id: string) {
  const supabase = createClient() // server client
  const { data, error } = await supabase
    .from('karute_records')
    .select(`
      id, created_at, summary, transcript, customer_id, staff_id,
      customers ( id, name ),
      entries ( id, category, title, notes, source_quote, confidence_score, is_manual, created_at )
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}
```

### Pattern 3: Sequential Server Action Save (karute_record + entries)

**What:** Insert a karute record, get the returned ID, then bulk-insert all entries with that ID. Wrap in try/catch to clean up the orphaned record if entries fail.

**When to use:** The save flow when the user confirms from the AI review screen.

```typescript
// Source: https://supabase.com/docs/reference/javascript/insert (verified 2026-03-13)
// actions/karute.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function saveKaruteRecord(input: {
  customerId: string
  staffId: string
  transcript: string
  summary: string
  entries: Array<{
    category: string
    title: string
    notes?: string
    source_quote?: string
    confidence_score: number
    is_manual: boolean
  }>
}) {
  const supabase = createClient()

  // Step 1: Insert the karute record and get its ID
  const { data: record, error: recordError } = await supabase
    .from('karute_records')
    .insert({
      customer_id: input.customerId,
      staff_id: input.staffId,
      transcript: input.transcript,
      summary: input.summary,
    })
    .select('id')
    .single()

  if (recordError) throw new Error(recordError.message)

  // Step 2: Bulk-insert all entries linked to the new record
  const { error: entriesError } = await supabase
    .from('entries')
    .insert(
      input.entries.map((e) => ({
        ...e,
        karute_record_id: record.id,
      }))
    )

  if (entriesError) {
    // Clean up orphaned karute record
    await supabase.from('karute_records').delete().eq('id', record.id)
    throw new Error(entriesError.message)
  }

  revalidatePath(`/customers/${input.customerId}`)
  redirect(`/karute/${record.id}`)
  // Note: redirect() throws — no code after this executes
}
```

### Pattern 4: Add Entry Sheet with react-hook-form + zod

**What:** shadcn Sheet (slide-in panel) containing a form with category selector, title input, and notes textarea. Calls a Server Action on submit.

**When to use:** The "+ Add Entry" button on any karute detail view.

```typescript
// Source: https://ui.shadcn.com/docs/forms/react-hook-form + https://ui.shadcn.com/docs/components/radix/sheet
// components/karute/AddEntrySheet.tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addManualEntry } from '@/actions/entries'
import { ENTRY_CATEGORIES } from '@/lib/karute/categories'

const addEntrySchema = z.object({
  category: z.string().min(1),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
})

type AddEntryValues = z.infer<typeof addEntrySchema>

export function AddEntrySheet({
  karuteId,
  open,
  onOpenChange,
}: {
  karuteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const form = useForm<AddEntryValues>({
    resolver: zodResolver(addEntrySchema),
    defaultValues: { category: '', title: '', notes: '' },
  })

  async function onSubmit(values: AddEntryValues) {
    await addManualEntry({ karuteId, ...values })
    form.reset()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Add Entry</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {ENTRY_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* title and notes fields follow same pattern */}
            <SheetFooter>
              <button type="submit" disabled={form.formState.isSubmitting}>
                Save Entry
              </button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
```

### Pattern 5: Color-Coded Category Badge

**What:** A map of category value → Tailwind color classes, rendered as shadcn Badge with custom className. Defined as a constant so both the badge and the Add Entry selector share a single source of truth.

**When to use:** Every entry display in the detail view.

```typescript
// Source: https://ui.shadcn.com/docs/components/radix/badge (verified 2026-03-13)
// lib/karute/categories.ts
export const ENTRY_CATEGORIES = [
  { value: 'preference', label: 'Preference', labelJa: '好み', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { value: 'treatment', label: 'Treatment', labelJa: 'トリートメント', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  { value: 'lifestyle', label: 'Lifestyle', labelJa: 'ライフスタイル', color: 'bg-green-500/20 text-green-300 border-green-500/30' },
  { value: 'concern', label: 'Concern', labelJa: '悩み', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { value: 'product', label: 'Product', labelJa: '製品', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  { value: 'note', label: 'Note', labelJa: 'メモ', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
] as const

export type EntryCategory = typeof ENTRY_CATEGORIES[number]['value']

// components/karute/CategoryBadge.tsx
import { Badge } from '@/components/ui/badge'
import { ENTRY_CATEGORIES } from '@/lib/karute/categories'

export function CategoryBadge({ category }: { category: string }) {
  const cat = ENTRY_CATEGORIES.find((c) => c.value === category)
  return (
    <Badge
      variant="outline"
      className={cat?.color ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'}
    >
      {cat?.label ?? category}
    </Badge>
  )
}
```

### Pattern 6: Confidence Score Display

**What:** Confidence score (0.0–1.0 float from GPT extraction) rendered as a percentage label. Low confidence (<0.7) shown in amber, high confidence (>=0.85) shown in green. Manual entries show no score.

```typescript
// No library needed — pure Tailwind + conditional class
export function ConfidenceIndicator({ score, isManual }: { score: number | null; isManual: boolean }) {
  if (isManual || score === null) return null
  const pct = Math.round(score * 100)
  const colorClass = score >= 0.85
    ? 'text-green-400'
    : score >= 0.70
    ? 'text-amber-400'
    : 'text-red-400'
  return <span className={`text-xs font-mono ${colorClass}`}>{pct}%</span>
}
```

### Pattern 7: Save Flow Connecting Phase 2 AI Review to Phase 4

**What:** After the user confirms entries on the AI review screen (Phase 2), they select a customer, then the save flow calls `saveKaruteRecord()`. The review screen holds transcript + entries in React state (or passed via URL-encoded temp storage). Customer selector is a searchable shadcn Combobox backed by a `getCustomers()` server helper.

**Flow:**
```
AI Review Screen (Phase 2)
  → User clicks "Save as Karute"
  → Customer selector modal/sheet opens
  → User selects customer
  → saveKaruteRecord() Server Action called
  → Redirect to /karute/[newId]
  → Karute detail view renders with new record
```

**State handoff options (pick one):**
1. **Session storage** (simplest): AI review screen writes `{ transcript, summary, entries }` to `sessionStorage` before navigating to the customer selector step. Customer selector reads from session storage, then calls the Server Action.
2. **URL search params**: Pass a `draftId` pointing to a `karute_drafts` table row in Supabase. More robust but adds a table.
3. **React state in parent layout**: If all steps are in the same layout, pass state down as props. Works if the steps share a layout without full navigation.

Recommendation for v1: Use `sessionStorage` for handoff — simplest, no extra DB table, and the draft is naturally cleaned up when the session ends.

### Anti-Patterns to Avoid

- **Calling `redirect()` inside a try/catch block:** `redirect()` throws a control-flow exception that will be caught by try/catch and treated as an error. Call `revalidatePath()` inside try, then call `redirect()` outside the catch block.
- **Using `params.id` synchronously in Next.js 16:** `params` is a Promise. Always `await params` first.
- **Using the browser Supabase client in the save Server Action:** Server Actions must use `createServerClient()` from `@supabase/ssr` with `cookies()`. Never import the browser client in a server action.
- **Building a custom color-coded tag system from scratch:** Use shadcn Badge with Tailwind variant classes. The complexity is zero; custom CSS will diverge from the design system.
- **Storing the full transcript in the entries table:** Transcript belongs on `karute_records`, not duplicated per entry. Entries store only `source_quote` (the verbatim excerpt supporting that specific entry).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color-coded category tags | Custom CSS badge component | shadcn Badge + Tailwind classes | Built-in variant system; dark mode handled; accessible |
| Form with category select + validation | Custom form state | react-hook-form + zod + shadcn Form | Validation, error messages, submit state included; ~50 lines vs ~200 custom |
| Slide-in "Add Entry" panel | Custom drawer/modal | shadcn Sheet | Focus trapping, keyboard nav, animation handled; Radix UI accessibility compliance |
| Multi-table "transaction" | Custom rollback logic | Sequential inserts + cleanup on error (or Postgres RPC) | The cleanup pattern is 5 lines; Postgres RPC is the proper answer if rollback atomicity is required |
| Nested data fetch (record + entries + customer) | Multiple separate queries | PostgREST nested select (single query) | One round-trip; type-safe via `QueryData<typeof query>` |

**Key insight:** Phase 4 has no novel technical problems. Every piece has an established solution in the existing stack. The risk is over-engineering the save flow or the Add Entry UI.

## Common Pitfalls

### Pitfall 1: redirect() Inside Try/Catch

**What goes wrong:** `redirect()` from `next/navigation` throws an internal Next.js exception to signal navigation. If wrapped in a try/catch, the throw is caught and the redirect never happens — the user sees a blank response or a silent failure.

**Why it happens:** Instinct to wrap the entire Server Action body in try/catch for error handling.

**How to avoid:**
```typescript
export async function saveKaruteRecord(input: ...) {
  let newId: string
  try {
    // database operations
    newId = record.id
  } catch (e) {
    return { error: 'Failed to save' } // return error, don't throw
  }
  // redirect() OUTSIDE the try/catch
  revalidatePath(`/karute/${newId}`)
  redirect(`/karute/${newId}`)
}
```

**Warning signs:** Server Action completes but user stays on the same page; redirect never fires.

### Pitfall 2: Orphaned karute_record When entries Insert Fails

**What goes wrong:** Step 1 inserts `karute_records` successfully and returns an ID. Step 2 inserts `entries` fails (validation error, RLS violation, etc.). The karute_record row now exists in the DB with no entries, and no foreign-key constraint prevents this. The customer's visit history shows a record that has no content.

**Why it happens:** Sequential inserts without cleanup logic.

**How to avoid:** In the catch block for the entries insert error, delete the just-created karute_record before returning the error:
```typescript
if (entriesError) {
  await supabase.from('karute_records').delete().eq('id', record.id)
  return { error: entriesError.message }
}
```

**Warning signs:** Customer karute history shows records with no entries; no error surfaced to the user.

### Pitfall 3: params Not Awaited (Next.js 16 Breaking Change)

**What goes wrong:** Accessing `params.id` directly (without await) returns a Promise object, not the string value. The Supabase query receives `[object Promise]` as the ID, which returns no rows, and `notFound()` is never called — the page renders with empty data.

**Why it happens:** `params` was synchronous in Next.js 14 and earlier. Developers copy old patterns.

**How to avoid:**
```typescript
// WRONG (Next.js 14 pattern)
export default async function Page({ params }: { params: { id: string } }) {
  const karute = await getKaruteRecord(params.id) // BUG

// CORRECT (Next.js 16)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const karute = await getKaruteRecord(id)
```

**Warning signs:** Page renders with empty state but no 404; Supabase query returns null for all records.

### Pitfall 4: Entries `category` Not in the Defined Set

**What goes wrong:** GPT extraction in Phase 2 generates category strings that don't match the constants defined in `ENTRY_CATEGORIES`. The `CategoryBadge` component receives an unknown category and renders no color, or throws a type error.

**Why it happens:** The GPT extraction prompt in Phase 2 uses different category names than what Phase 4's UI expects, and they are never aligned.

**How to avoid:**
- Define `ENTRY_CATEGORIES` in `lib/karute/categories.ts` as the single source of truth
- Import these values in Phase 2's GPT extraction prompt construction (feed them as the allowed category enum to the Zod schema for structured output)
- In the database schema, consider a `CHECK` constraint on `entries.category` to enforce valid values at the DB level

**Warning signs:** Entries showing generic fallback color; "Unknown category" labels in the UI.

### Pitfall 5: SessionStorage State Handoff Not Cleaned Up

**What goes wrong:** The AI review screen writes draft data to `sessionStorage` before navigating to the customer selector. If the user abandons the flow and starts a new recording, the old draft data is still in sessionStorage and pre-fills the save flow incorrectly.

**Why it happens:** Draft state management is an afterthought; the clear-on-save step is forgotten.

**How to avoid:**
- Always `sessionStorage.removeItem('karute_draft')` after calling `saveKaruteRecord()` (or on navigation away from the save flow)
- Write a timestamp alongside the draft data and discard drafts older than 1 hour

**Warning signs:** Save flow pre-fills with data from a previous recording session.

### Pitfall 6: Entries Not Ordered Consistently

**What goes wrong:** The `entries` array returned by the nested Supabase select comes back in database insertion order (which may be non-deterministic across queries or after manual inserts). The UI displays entries in a different order each time the page loads.

**Why it happens:** No `ORDER BY` clause in the entries sub-query.

**How to avoid:** Add ordering to the nested select:
```typescript
entries ( id, category, title, ..., created_at ).order('created_at', { ascending: true })
```

Or define a default sort in the Supabase query using PostgREST's nested order syntax.

**Warning signs:** Entries shuffle on page refresh; manual entries appear in different positions.

## Code Examples

Verified patterns from official sources:

### Inserting a record and getting back the ID

```typescript
// Source: https://supabase.com/docs/reference/javascript/insert (verified 2026-03-13)
const { data: record, error } = await supabase
  .from('karute_records')
  .insert({
    customer_id: customerId,
    staff_id: staffId,
    transcript: transcript,
    summary: summary,
  })
  .select('id')
  .single()
// record.id is available immediately after this call
```

### Nested query with TypeScript types

```typescript
// Source: https://supabase.com/docs/guides/database/joins-and-nesting (verified 2026-03-13)
import { QueryData } from '@supabase/supabase-js'

const query = supabase
  .from('karute_records')
  .select(`
    id, created_at, summary, transcript,
    customers ( id, name ),
    entries ( id, category, title, notes, source_quote, confidence_score, is_manual, created_at )
  `)
  .eq('id', id)
  .single()

type KaruteDetail = QueryData<typeof query>

const { data, error } = await query
```

### Server Action with revalidatePath + redirect (outside try/catch)

```typescript
// Source: https://nextjs.org/docs/app/getting-started/updating-data (version 16.1.6, lastUpdated 2026-02-27)
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function saveKaruteRecord(input: SaveInput) {
  let recordId: string
  try {
    const { data, error } = await supabase.from('karute_records').insert(...).select('id').single()
    if (error) return { error: error.message }
    recordId = data.id
    // insert entries...
  } catch (e) {
    return { error: 'Unexpected error' }
  }
  // redirect OUTSIDE try/catch
  revalidatePath(`/customers/${input.customerId}`)
  redirect(`/karute/${recordId}`)
}
```

### Next.js 16 async params (dynamic route)

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes (version 16.1.6, lastUpdated 2026-02-27)
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // use id safely here
}
```

### useActionState for pending state on Add Entry form

```typescript
// Source: https://react.dev/reference/react/useActionState + https://nextjs.org/docs/app/getting-started/updating-data
'use client'
import { useActionState } from 'react'
import { addManualEntry } from '@/actions/entries'

const [state, action, pending] = useActionState(addManualEntry, null)
// pending is true while the Server Action is executing
// show spinner on save button, disable inputs while pending
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `params.id` sync access | `await params` (Promise) | Next.js 15→16 | Breaking change — must update all dynamic route components |
| `useFormState` | `useActionState` | React 19 / Next.js 15 | `useFormState` deprecated; `useActionState` from `react` package |
| Supabase `auth-helpers` `createServerComponentClient` | `createServerClient` from `@supabase/ssr` | January 2026 | auth-helpers deprecated; migrate before Phase 4 implementation |
| `QueryResult` for type inference | `QueryData` | Supabase JS 2.x | `QueryData<typeof query>` infers the full nested type shape correctly |

**Deprecated/outdated:**
- `useFormStatus` from `react-dom`: deprecated in Next.js 15+; replaced by `useActionState` from `react`
- Direct `params.id` access: deprecated since Next.js 15, removed from type definitions in Next.js 16

## Open Questions

1. **Database schema for `entries.category`**
   - What we know: Phase 1 designs the schema; the category values used by GPT extraction (Phase 2) must match the UI categories (Phase 4)
   - What's unclear: Whether Phase 1 schema uses a Postgres ENUM, TEXT with a CHECK constraint, or unconstrained TEXT for `entries.category`
   - Recommendation: Define `ENTRY_CATEGORIES` as a TypeScript const in `lib/karute/categories.ts` from Phase 4; import these values for the Phase 2 GPT extraction schema; add a Postgres CHECK constraint in Phase 1 schema migration to enforce valid values at DB level

2. **Staff ID source for save flow**
   - What we know: Phase 5 (Staff Profiles) is the phase that builds the staff switcher. Phase 4 depends on having a staff_id to write to `karute_records`.
   - What's unclear: How is the current staff_id available in Phase 4 if Phase 5 isn't built yet?
   - Recommendation: Phase 4 plans should include a temporary "use first staff profile row" fallback for the save action, with a TODO note to wire up the real staff switcher in Phase 5. Alternatively, plan 04-04 (save flow) should treat staff_id as an optional parameter that defaults to null if no staff switcher exists yet.

3. **SessionStorage vs. URL params for draft handoff**
   - What we know: The AI review screen (Phase 2) produces transcript + entries; Phase 4's save flow needs this data
   - What's unclear: Whether the entries array can be large enough to overflow URL length limits
   - Recommendation: Use sessionStorage for the handoff. URL params are not reliable for large JSON payloads (browser limits ~2KB-8KB). SessionStorage is synchronous, scoped to the tab, and cleaned up on tab close — appropriate for ephemeral draft data.

## Sources

### Primary (HIGH confidence)
- [Next.js Dynamic Routes docs](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes) — async params pattern, TypeScript types, version 16.1.6, lastUpdated 2026-02-27
- [Next.js Updating Data docs](https://nextjs.org/docs/app/getting-started/updating-data) — Server Actions, revalidatePath, redirect, useActionState, version 16.1.6, lastUpdated 2026-02-27
- [Supabase Joins and Nesting docs](https://supabase.com/docs/guides/database/joins-and-nesting) — PostgREST nested select, foreign key auto-detection, QueryData type helper
- [Supabase Insert docs](https://supabase.com/docs/reference/javascript/insert) — insert + select to return new row
- [shadcn/ui Badge component](https://ui.shadcn.com/docs/components/radix/badge) — variant system, custom className pattern
- [shadcn/ui Sheet component](https://ui.shadcn.com/docs/components/radix/sheet) — slide-in panel for Add Entry
- [shadcn/ui React Hook Form docs](https://ui.shadcn.com/docs/forms/react-hook-form) — Form + Select pattern with Controller

### Secondary (MEDIUM confidence)
- [Supabase multi-table transactions discussion #3732](https://github.com/orgs/supabase/discussions/3732) — RPC as the correct approach for atomic multi-table inserts; sequential inserts as pragmatic alternative
- [Next.js Server Actions error handling](https://makerkit.dev/blog/tutorials/nextjs-server-actions) — discriminated union return type pattern; redirect outside try/catch warning
- [React useActionState docs](https://react.dev/reference/react/useActionState) — hook API for pending state in Server Action forms

### Tertiary (LOW confidence)
- Community patterns for sessionStorage draft handoff — no single authoritative source; consistent with general Next.js multi-step form advice

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries are from Phase 1; no new dependencies
- Architecture (save flow, detail view): HIGH — verified against official Next.js 16 and Supabase docs with publication dates
- Color-coded category tags: HIGH — shadcn Badge + Tailwind CSS classes, official docs
- Add Entry form (Sheet + react-hook-form): HIGH — official shadcn docs cover this exact pattern
- Save flow state handoff (sessionStorage): MEDIUM — pragmatic recommendation, no authoritative source for this specific use case
- Sequential insert vs. RPC transaction: MEDIUM — Supabase community discussion confirmed RPC is correct for atomicity; sequential with cleanup is a pragmatic shortcut

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable libraries; only risk is a Next.js minor release changing params behavior)
