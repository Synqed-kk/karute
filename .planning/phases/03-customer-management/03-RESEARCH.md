# Phase 3: Customer Management - Research

**Researched:** 2026-03-13
**Domain:** Next.js App Router CRUD, Supabase data layer, search/pagination, form management
**Confidence:** HIGH (core patterns verified via Next.js official docs, Supabase official docs, shadcn/ui official docs, Context7)

---

## Summary

Phase 3 builds the customer data layer and two UI pages (customer list + customer profile). The tech stack is locked from Phase 1 — Next.js 16, Supabase, react-hook-form + zod, shadcn/ui. There are no new library decisions to make for this phase. The primary research questions are: (1) how to structure Server Actions for customer CRUD, (2) how to implement searchable/paginated list with URL search params, and (3) how to wire a shadcn/ui form for create/edit with zod validation.

The standard approach for this phase is: Server Actions for all CRUD mutations (create, update), server-side Supabase query for listing with ilike search and .range() pagination, URL search params (not React state) for search and page number so the list is bookmarkable and SSR-compatible. The customer list uses shadcn Table + TanStack Table v8 for column definitions; the profile page is a Server Component fetching customer + karute records from Supabase in parallel.

Key Next.js 16 specifics: `searchParams` and `params` props on page components are now `Promise<...>` and must be awaited. Using `searchParams` opts the page into dynamic rendering automatically. The `revalidatePath` + `redirect` pattern is the correct post-mutation flow for Server Actions. No additional libraries are needed — all required packages are already in the established stack.

**Primary recommendation:** Use URL search params for search state + Server Actions for mutations + server-side Supabase queries with ilike + .range() for pagination. No client-side state management for the list.

---

## Standard Stack

No new dependencies are needed for Phase 3. All required libraries are already in the project from Phase 1.

### Core (already installed from Phase 1)

| Library | Version | Purpose | Phase 3 Usage |
|---------|---------|---------|---------------|
| Next.js | 16.1.6 | App Router, Server Actions, pages | Customer list page, profile page, Server Actions |
| @supabase/supabase-js | ^2.99.1 | Database client | Customer CRUD queries |
| @supabase/ssr | ^0.x | Server-side Supabase client with cookies | createClient() in server.ts for all Server Actions |
| react-hook-form | ^7.x | Form state management | Customer create/edit form |
| zod | ^4.3.6 | Schema validation | Customer form schema + Server Action input validation |
| @hookform/resolvers | ^5.2.2 | Zod resolver for react-hook-form | zodResolver in useForm() |
| shadcn/ui | CLI v4.0.5 | UI components | Table, Form, Input, Button, Dialog, Sheet |
| next-intl | ^4.8.3 | i18n | All customer UI strings in EN/JP translation files |

### Supporting (new install needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| use-debounce | ^10.1.0 | Debounce search input | Wrap the search onChange handler — delays Supabase query by 300ms as user types |

**Installation:**
```bash
npm install use-debounce
```

### shadcn/ui Components to Add

These shadcn components need to be added via CLI if not already added in Phase 1:

```bash
npx shadcn@latest add table
npx shadcn@latest add form
npx shadcn@latest add input
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add sheet
npx shadcn@latest add badge
npx shadcn@latest add avatar
```

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| URL search params for search state | React useState | useState loses state on refresh/share; URL params enable bookmarking and SSR |
| ilike for name search | Postgres full-text search (tsvector) | ilike is sufficient for customer name search at this scale; full-text adds complexity without benefit for a single-field name search |
| Server Actions for CRUD | Route Handlers | Server Actions are correct for CRUD — they're smaller payloads (no audio), auto-typed, and integrate with revalidatePath |
| useDebouncedCallback | Custom debounce | use-debounce is Next.js's own recommended package in their official App Router tutorial |

---

## Architecture Patterns

### Recommended File Structure for Phase 3

```
src/
├── app/
│   └── (app)/
│       └── customers/
│           ├── page.tsx                # Customer list page (Server Component)
│           ├── loading.tsx             # Skeleton loading state
│           ├── new/
│           │   └── page.tsx            # New customer page (or use Dialog on list page)
│           └── [id]/
│               ├── page.tsx            # Customer profile page (Server Component)
│               ├── loading.tsx         # Skeleton while fetching
│               └── edit/
│                   └── page.tsx        # Edit customer page (optional route)
├── actions/
│   └── customers.ts                    # createCustomer, updateCustomer, getCustomer
├── components/
│   └── customers/
│       ├── CustomerList.tsx            # Client Component — searchable table
│       ├── CustomerSearch.tsx          # 'use client' — debounced search input + URL update
│       ├── CustomerForm.tsx            # 'use client' — create/edit form with react-hook-form
│       ├── CustomerCard.tsx            # Optional card variant for mobile
│       └── KaruteHistoryList.tsx       # Profile page — session history (Phase 4 fills data)
└── types/
    └── customers.ts                    # Customer TypeScript types (from Supabase gen types)
```

### Pattern 1: URL Search Params for Search State

**What:** The search query and page number live in the URL (`/customers?query=yamada&page=2`). The page component reads them from `searchParams` and passes them to the Supabase query. The Search input component reads from `useSearchParams()` and updates the URL via `useRouter().replace()`.

**When to use:** Any list page where the state should survive refresh, be shareable, and support browser back/forward.

**Why not useState:** React state resets on navigation. URL state is free, persistent, and SSR-compatible.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/page (Next.js 16.1.6 official docs)
// app/(app)/customers/page.tsx — Server Component
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string }>
}) {
  const { query = '', page = '1' } = await searchParams
  const currentPage = Number(page)
  const pageSize = 20

  const { customers, totalCount } = await listCustomers({ query, page: currentPage, pageSize })
  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div>
      <CustomerSearch placeholder="Search customers..." />
      <CustomerList customers={customers} />
      <Pagination currentPage={currentPage} totalPages={totalPages} />
    </div>
  )
}
```

### Pattern 2: Debounced Search Input with URL Sync

**What:** A Client Component that debounces the search input and updates the URL `?query=` param without a full page navigation.

```typescript
// Source: https://nextjs.org/learn/dashboard-app/adding-search-and-pagination (Next.js official tutorial)
// components/customers/CustomerSearch.tsx
'use client'

import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { Input } from '@/components/ui/input'

export function CustomerSearch({ placeholder }: { placeholder: string }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { replace } = useRouter()

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('page', '1') // Reset to page 1 on new search
    if (term) {
      params.set('query', term)
    } else {
      params.delete('query')
    }
    replace(`${pathname}?${params.toString()}`)
  }, 300)

  return (
    <Input
      placeholder={placeholder}
      onChange={(e) => handleSearch(e.target.value)}
      defaultValue={searchParams.get('query')?.toString()}
    />
  )
}
```

### Pattern 3: Supabase Customer List Query with ilike + Pagination

**What:** A server-side helper function that fetches customers with optional name filter and pagination using Supabase's `.ilike()` and `.range()`.

```typescript
// Source: Supabase official docs — https://supabase.com/docs/reference/javascript/insert
// Verified with: https://supalaunch.com/blog/supabase-nextjs-pagination
// lib/customers/queries.ts (or in actions/customers.ts)
import { createClient } from '@/lib/supabase/server'

interface ListCustomersOptions {
  query?: string
  page?: number
  pageSize?: number
}

export async function listCustomers({ query = '', page = 1, pageSize = 20 }: ListCustomersOptions) {
  const supabase = createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let dbQuery = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true })
    .range(from, to)

  if (query) {
    dbQuery = dbQuery.ilike('name', `%${query}%`)
  }

  const { data, error, count } = await dbQuery

  if (error) throw error

  return {
    customers: data ?? [],
    totalCount: count ?? 0,
  }
}
```

### Pattern 4: Server Action for Customer CRUD

**What:** Server Actions in a dedicated `actions/customers.ts` file for create and update. They call `revalidatePath` after success and `redirect` after create.

```typescript
// Source: https://nextjs.org/docs/app/getting-started/updating-data (Next.js 16.1.6 official docs)
// actions/customers.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
})

export async function createCustomer(input: z.infer<typeof CustomerSchema>) {
  const validated = CustomerSchema.parse(input)
  const supabase = createClient()

  const { data, error } = await supabase
    .from('customers')
    .insert([validated])
    .select()
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/customers')
  redirect(`/customers/${data.id}`)
}

export async function updateCustomer(id: string, input: z.infer<typeof CustomerSchema>) {
  const validated = CustomerSchema.parse(input)
  const supabase = createClient()

  const { error } = await supabase
    .from('customers')
    .update(validated)
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
}
```

### Pattern 5: shadcn/ui Form with react-hook-form + zod for Customer Create/Edit

**What:** A Client Component form using `useForm` + `zodResolver` + shadcn Form components. Works for both create and edit by passing optional `defaultValues`.

```typescript
// Source: https://ui.shadcn.com/docs/components/form (shadcn official docs)
// components/customers/CustomerForm.tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createCustomer, updateCustomer } from '@/actions/customers'

const CustomerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
})

type CustomerFormValues = z.infer<typeof CustomerFormSchema>

interface CustomerFormProps {
  customerId?: string
  defaultValues?: Partial<CustomerFormValues>
}

export function CustomerForm({ customerId, defaultValues }: CustomerFormProps) {
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(CustomerFormSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      notes: '',
      ...defaultValues,
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    if (customerId) {
      await updateCustomer(customerId, values)
    } else {
      await createCustomer(values)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Customer name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email (optional)</FormLabel>
              <FormControl>
                <Input type="email" placeholder="email@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (optional)</FormLabel>
              <FormControl>
                <Input type="tel" placeholder="+81 90-1234-5678" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving...' : (customerId ? 'Update' : 'Create Customer')}
        </Button>
      </form>
    </Form>
  )
}
```

### Pattern 6: Customer Profile Page — Parallel Data Fetching

**What:** The profile page fetches customer info and karute history in parallel using `Promise.all`. The karute records are a placeholder list in Phase 3 (populated by Phase 4).

```typescript
// Source: Next.js official docs — server-side data fetching patterns
// app/(app)/customers/[id]/page.tsx
export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createClient()

  const [customerResult, karuteResult] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    supabase
      .from('karute_records')
      .select('id, created_at, summary, staff_id')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (customerResult.error || !customerResult.data) notFound()

  const customer = customerResult.data
  const karuteRecords = karuteResult.data ?? []

  return (
    <div>
      <CustomerProfile customer={customer} />
      <KaruteHistoryList records={karuteRecords} />
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **useState for search query:** Don't store the search term in React state — it resets on navigation and breaks SSR. Use URL search params instead.
- **useEffect to trigger searches:** Don't fetch in useEffect when the page component can be a Server Component that fetches on render with searchParams.
- **Fetching customer list in a Client Component:** The list is static enough for Server Components. Only the search input needs to be `'use client'`.
- **Calling redirect() inside a try/catch:** `redirect()` throws internally — if you wrap it in try/catch, you'll catch the redirect and suppress it. Call it outside any catch block.
- **Separate API routes for CRUD:** Don't create `/api/customers/create` Route Handlers. Server Actions are the correct tool here — they handle small JSON payloads cleanly with zero boilerplate.
- **ilike on the wrong column:** Ensure the ilike is on `name`, not on `id` or other columns that don't have expected string values.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced search | Custom debounce hook or setTimeout | use-debounce `useDebouncedCallback` | Memory leak risk with raw setTimeout; use-debounce handles cleanup, is tested, and is Next.js's own recommendation |
| Form validation | Custom validation logic | zod + @hookform/resolvers + react-hook-form | Error state, touched tracking, async validation, field-level errors — all complex to hand-roll correctly |
| Pagination UI | Custom page number component | shadcn/ui pagination or custom Link-based component using `createPageURL` | Bookmarkable href links (not buttons) enable browser navigation and share; buttons with onClick lose URL state |
| Table column definitions | Raw HTML `<table>` | shadcn Table + TanStack Table v8 via ColumnDef | TanStack Table handles sorting, filtering state, column visibility — use even if you start with basic features |
| Supabase query error handling | Per-query if/else | Centralized throw pattern (if error throw) | Consistent error bubbling to error.tsx boundary; avoids silent data corruption on failed writes |

**Key insight:** For customer management, the temptation is to add real-time search (useEffect + fetch on input). Resist this — URL param search with a debounce is simpler, more resilient, and SSR-compatible.

---

## Common Pitfalls

### Pitfall 1: Forgetting to await searchParams and params (Next.js 15+/16 breaking change)

**What goes wrong:** `searchParams` and `params` are now `Promise<...>` in Next.js 15+. If you access `searchParams.query` without `await searchParams` first, TypeScript will error and the runtime will produce `undefined`.

**Why it happens:** Next.js changed these from synchronous props to async in version 15. Code copied from Next.js 14 tutorials will silently fail or produce TypeScript errors.

**How to avoid:** Always await props in async Server Components:
```typescript
const { query = '', page = '1' } = await searchParams
const { id } = await params
```
Use the `PageProps<'/customers/[id]'>` helper for strict typing.

**Warning signs:** TypeScript showing `Promise<...>` type errors on `searchParams.query` access; `query` is always `undefined`.

### Pitfall 2: redirect() Inside try/catch Blocks

**What goes wrong:** `redirect()` from `next/navigation` works by throwing a special internal exception. If called inside a try/catch, the catch block intercepts the redirect and suppresses it. The user never navigates after create.

**Why it happens:** Natural pattern to wrap entire Server Action in try/catch for error handling.

**How to avoid:**
```typescript
// WRONG — redirect gets caught
try {
  await supabase.from('customers').insert([...])
  redirect('/customers') // throws, gets caught!
} catch (e) { ... }

// CORRECT — revalidate inside try/catch, redirect outside
let newId: string
try {
  const { data, error } = await supabase.from('customers').insert([...]).select().single()
  if (error) throw error
  newId = data.id
  revalidatePath('/customers')
} catch (e) {
  return { error: e.message }
}
redirect(`/customers/${newId}`) // outside try/catch
```

**Warning signs:** Create button appears to do nothing; no navigation happens after submit.

### Pitfall 3: ilike Without Index on customers.name

**What goes wrong:** `ilike('%yamada%')` (leading wildcard) cannot use a standard B-tree index. For a small customers table this is fine. If a business accumulates thousands of customers, the query becomes a full table scan.

**Why it happens:** ilike with a leading `%` prevents index use. This is a Postgres behavior, not a Supabase-specific issue.

**How to avoid:** For this phase at v1 scale (salons have hundreds, not tens of thousands of customers), ilike is fine. Add a `pg_trgm` GIN index if search becomes slow:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
```
This enables fast ilike searches even with leading wildcards.

**Warning signs:** Customer list page noticeably slow to load with 500+ customers.

### Pitfall 4: Using searchParams in a Layout Component

**What goes wrong:** `searchParams` is NOT available as a prop on layout.tsx. Only `page.tsx` receives it. Trying to read search params in a layout file causes TypeScript errors and runtime failures.

**Why it happens:** Next.js intentionally doesn't pass `searchParams` to layouts — layouts are shared across routes and caching layouts with dynamic data would defeat their purpose.

**How to avoid:** Always read `searchParams` in the `page.tsx` component and pass the values down as props to child Server Components or Client Components.

### Pitfall 5: Customer List Flickers on Search Because Suspense Key Is Missing

**What goes wrong:** As the user types and the URL changes, the customer list may show stale data while the new query is in flight, then flash to the new results — no loading state.

**Why it happens:** Without a Suspense boundary with a key tied to the query, React cannot show a fallback during the data re-fetch.

**How to avoid:** Wrap the list component in Suspense with the query as a key:
```tsx
<Suspense key={query + currentPage} fallback={<CustomerListSkeleton />}>
  <CustomerList customers={customers} />
</Suspense>
```

**Warning signs:** Customer list shows stale results briefly after typing stops; no loading indicator during search.

### Pitfall 6: Missing i18n for Customer UI Strings

**What goes wrong:** Form labels, error messages, placeholder text, and headings get hardcoded in English during rapid development. When Phase 6 wires the JP locale, all customer management UI is untranslated.

**Why it happens:** It's faster to write `<FormLabel>Name</FormLabel>` than `<FormLabel>{t('customers.form.name')}</FormLabel>`.

**How to avoid:** Add all customer management strings to `messages/en.json` and `messages/ja.json` from the start. The next-intl setup from Phase 1 means this adds ~5 seconds per string. Do it immediately, not retroactively.

---

## Code Examples

Verified patterns from official sources:

### Supabase insert with .select().single() to get the new record back

```typescript
// Source: https://supabase.com/docs/reference/javascript/insert (Supabase official docs)
const { data, error } = await supabase
  .from('customers')
  .insert([{ name, email, phone }])
  .select()
  .single()

if (error) throw new Error(error.message)
// data is the newly created customer row
```

### Supabase update with .eq() filter

```typescript
// Source: https://supabase.com/docs/reference/javascript/update (Supabase official docs)
const { error } = await supabase
  .from('customers')
  .update({ name, email, phone })
  .eq('id', customerId)

if (error) throw new Error(error.message)
```

### Supabase list with ilike search + pagination + exact count

```typescript
// Source: Supabase official docs (.ilike, .range, count) — verified
const from = (page - 1) * pageSize
const to = from + pageSize - 1

let query = supabase
  .from('customers')
  .select('*', { count: 'exact' })
  .order('name', { ascending: true })
  .range(from, to)

if (searchQuery) {
  query = query.ilike('name', `%${searchQuery}%`)
}

const { data, error, count } = await query
```

### Next.js 16 page.tsx with async searchParams

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/page (Next.js 16.1.6 official docs)
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string }>
}) {
  const { query = '', page = '1' } = await searchParams
  const currentPage = Number(page)
  // use query and currentPage for data fetching
}
```

### Next.js 16 page.tsx with async params

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/page (Next.js 16.1.6 official docs)
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // use id to fetch the specific customer
}
```

### Server Action with revalidatePath + redirect pattern

```typescript
// Source: https://nextjs.org/docs/app/getting-started/updating-data (Next.js 16.1.6 official docs)
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createCustomer(input: CustomerInput) {
  // ... Supabase insert ...
  revalidatePath('/customers')
  redirect('/customers') // must be OUTSIDE try/catch
}
```

### shadcn/ui Form + react-hook-form + zod complete structure

```typescript
// Source: https://ui.shadcn.com/docs/components/form (shadcn official docs)
const form = useForm<FormValues>({
  resolver: zodResolver(formSchema),
  defaultValues: { name: '', email: '' },
})

// Render:
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl><Input {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </form>
</Form>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sync `searchParams` prop | `searchParams: Promise<...>` must be awaited | Next.js 15.0 (breaking), Next.js 16 | All page.tsx files receiving searchParams or params must be async and use await |
| `getStaticProps` / `getServerSideProps` | Server Components with direct async data fetching | Next.js 13 App Router | Page-level data fetching is just an async function — no lifecycle APIs |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` with createBrowserClient/createServerClient | January 2026 (deprecated) | auth-helpers is no longer maintained; already established in Phase 1 stack |
| Client-side search with useEffect + fetch | URL search params + Server Component data fetching | App Router pattern (2023+) | Less client JS, SSR-compatible, bookmarkable |
| react-hook-form v8 | react-hook-form v7 (stable) | v8 is still in beta as of early 2026 | Stay on v7; v8 has API changes that conflict with @hookform/resolvers v5 |

**Deprecated/outdated:**
- `router.query` (Pages Router): Not available in App Router — use `useSearchParams()` hook
- `getServerSideProps` data fetching: Use async Server Component with direct Supabase calls
- `@supabase/auth-helpers-nextjs createServerComponentClient()`: Replaced by `@supabase/ssr createServerClient()`

---

## Open Questions

1. **Customer schema fields: what optional contact info fields?**
   - What we know: CUST-01 says "name and optional contact info." The FEATURES.md research lists: name, phone, email, birthday, allergies/sensitivities as table stakes.
   - What's unclear: Phase 1 defines the schema — if the `customers` table already has specific columns, the form fields must match exactly. The Phase 3 data layer must work from the actual schema.
   - Recommendation: Read the Phase 1 Supabase migration file during implementation to ensure the form fields match the actual `customers` table columns exactly. The Zod schema in `actions/customers.ts` must reflect the database schema.

2. **New customer UX: full page vs modal/sheet?**
   - What we know: The roadmap specifies "new customer button" on the list page. Shadcn provides both Dialog (modal) and Sheet (slide-over) components.
   - What's unclear: Whether the create form should be a new route (`/customers/new`) or an in-page Sheet/Dialog.
   - Recommendation: Use a Sheet (slide-over) component for create — keeps the list context visible, faster than full-page navigation, consistent with modern admin UX patterns. Use a separate `/customers/[id]/edit` route for editing (more content/space).

3. **Karute history list in Phase 3 profile page: empty state vs placeholder?**
   - What we know: Phase 3's profile page includes a karute history section; karute records are populated in Phase 4. The spec says "(populated in Phase 4)."
   - What's unclear: Whether to show a placeholder/empty state, or scaffold the data fetch now so Phase 4 just adds data.
   - Recommendation: Scaffold the `karute_records` query now (the table exists from Phase 1) and show an empty state UI. When Phase 4 adds records, the profile page will automatically show them. This avoids Phase 4 needing to touch Phase 3's profile page.

---

## Sources

### Primary (HIGH confidence)
- Next.js 16.1.6 official docs — page.tsx searchParams/params as Promise: https://nextjs.org/docs/app/api-reference/file-conventions/page
- Next.js 16 official tutorial — search and pagination with URL params: https://nextjs.org/learn/dashboard-app/adding-search-and-pagination
- Next.js 16 official docs — Server Actions, redirect, revalidatePath: https://nextjs.org/docs/app/getting-started/updating-data
- shadcn/ui official docs — Form component with react-hook-form + zod: https://ui.shadcn.com/docs/components/form
- shadcn/ui official docs — Data Table with TanStack Table: https://ui.shadcn.com/docs/components/radix/data-table
- Supabase official docs — JavaScript client insert: https://supabase.com/docs/reference/javascript/insert
- Supabase official docs — Creating SSR client (Server Components, Actions, Route Handlers): https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Supabase official docs — Full-text search (ilike vs tsvector): https://supabase.com/docs/guides/database/full-text-search

### Secondary (MEDIUM confidence)
- supalaunch.com — Supabase + Next.js pagination with .range() and count: https://supalaunch.com/blog/supabase-nextjs-pagination (pattern consistent with official Supabase docs)
- use-debounce npm — version 10.1.0 current, Next.js recommended: https://www.npmjs.com/package/use-debounce

### Tertiary (LOW confidence)
- None — all critical claims are backed by official sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in use from Phase 1; only one new package (use-debounce v10.1.0 confirmed on npm)
- Architecture patterns: HIGH — URL search params, Server Actions, Supabase queries all verified against official Next.js and Supabase docs
- Pitfalls: HIGH — searchParams-as-Promise is documented in Next.js 16.1.6 official docs; redirect/try/catch pitfall documented in Next.js official docs; others are general Next.js/Supabase patterns verified across multiple sources

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days — stable libraries, patterns unlikely to change)
