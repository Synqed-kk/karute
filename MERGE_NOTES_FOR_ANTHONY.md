# Merge notes — `ui` → `main` (PR #17)

**Author:** Liam (Claude-assisted)
**Branch:** `ui` (39 commits this session, 56 ahead of `main`)
**Audit date:** 2026-05-25
**Status:** Visual + scaffolding pass complete. **Zero schema / zero AI calls touched.** Safe to merge any sub-section independently or in full.

---

## TL;DR

This branch is a **visual + scaffolding port of the design spike** into the production codebase. It mirrors the spike's layout 1:1 so the muscle-memory transfers, but every AI surface is rendered as a `対応予定` (Coming Soon) placeholder until you wire the real pipeline. **No schema migrations. No new AI calls. No backend mutations beyond what already shipped.** TypeScript clean (`tsc --noEmit` exit 0). All visible strings are i18n keys (no hardcoded JP/EN leaking).

The branch is **safe to merge in chunks** — see the "What shipped (by surface area)" section for natural seams. You can take the whole thing, or split it into a UI-only PR + future function PRs as Liam mentioned.

---

## What shipped (by surface area)

### 1. Customer list (`/customers`) — spike-aligned compact rows
- `CustomersListView.tsx`, `CustomerCardMobile.tsx`, `CustomerRowDesktop.tsx` rewritten to match spike's list density (~5× more rows visible).
- `CustomersListHeader.tsx` — sticky opaque title bar + notification-bell stub.
- `CustomersStaffFilter.tsx` — iOS-style segmented Self/All toggle + per-staff colored pills.
- `CustomersStatusFilters.tsx` — dark active state.
- `CustomersListPagination.tsx` — 12/page with elision for >7 pages.
- `AiStatusChipRow.tsx` — 4 mini chips (体調予測 / 推奨 / 要約 / 録音 — all 対応予定) shown only when in karute context.
- Family-name avatars (姓 initial) via `lib/customers/identity.ts`.
- Sequential karute numbers (display-only stand-in via `assignSequentialKaruteNumbers`).
- Phone auto-formatted `0XX-XXXX-XXXX` via `lib/format/phone.ts`.

**Safety:** No new props on `CustomerListRow`. Header grid template kept in lock-step with row template.

### 2. Customer profile (`/customers/[id]`) — tabs + flat layout
- `CustomerProfileView.tsx` — tabs (Memory / Sessions / Photos / Privacy) kept, but laid out flat edge-to-edge to match spike.
- `CustomerIdentityCard.tsx` — flat (no card), shows age / gender / visit count / last visit / usual service.
- `CustomerEditDialog.tsx` (new) — pencil opens a Dialog over `CustomerForm`.
- `CustomerTabBar.tsx` — underline + blue-icon styling, horizontal scroll on mobile.

### 3. Karute tab (`/karute`) — record-centric list
- `karute/page.tsx` is now **record-centric**: every customer appears (with `record-missing` placeholder row when they have no karute_records yet), so newly added customers don't vanish.
- `spike-lifted/list/KaruteRecordListView.tsx` + `KaruteListRow.tsx` — spike's list-row visual.

### 4. Karute customer detail (`/karute/customer/[customerId]`) — **NEW route**
The vertical AI-section stack from the spike. Path is **separate** from `/customers/[id]` on purpose: profile = customer record (tabs); karute detail = AI surfaces stacked vertically (matches spike's `KaruteDetailPage`).

Section order (mirrors spike line-for-line):
1. Back-to-カルテ一覧 breadcrumb
2. `CustomerIdentityCard` (= spike's `CustomerHeaderCard`)
3. `CustomerMemoryCard` (collapsible categories, **empty by default**)
4. `PhotoRecordCard` (lifted; mutations stubbed)
5. `AIBodyPredictionPreview` + `AIOutreachCard` (lg:grid-cols-2)
6. Session entries (main col, lifted `SessionEntryTimeline`) + `AISummaryPreview` + `TranscriptCard` (sidebar on desktop; bottom-sheets on mobile via `KaruteAiAssistSheets`)
7. `KaruteCoachingPanel` placeholder (Layer 1 — requires role context)

### 5. Mobile AI bottom-sheets — `KaruteAiAssistSheets`
Compact list-row triggers ("AI要約" + "録音・文字起こし") at the bottom of mobile karute detail, opening `Sheet side="bottom"` overlays with the full surface inside. Matches spike's `MobileKaruteSheets`. Desktop renders the same content inline in the sidebar — sheets are `md:hidden`.

### 6. Cross-cutting
- **i18n sweep**: every new visible string lives in `messages/{en,ja}.json` under namespaced keys (`customers.*`, `karute.*`, `karute.aiAssist.*`, `karute.transcript.*`, `karute.session.*`, `karute.memory.*`, `karute.outreach.*`, `karute.photos.*`).
- **JST timezone**: all bucketing/formatting pinned to `Asia/Tokyo` (this was your earlier change — preserved).
- **Fonts**: `palt` + `optimizeLegibility` + antialiasing on `body` to match spike rendering. Noto Sans JP weight 600 added.
- **Bottom nav**: iOS-style active indicator (3px blue bar + bold + stroke-2.5) — `bottom-nav.tsx`.
- **Prisma error toasts**: `actions/customers.ts` now translates `P2002` (unique constraint) into a friendly i18n key instead of dumping raw Prisma errors.

---

## What's wired vs stubbed

### Wired (real data flowing today)
| Surface | Source |
|---|---|
| Customer list rows | `prisma.customers.findMany` (existing) |
| Customer profile identity | Existing customer query |
| Karute list rows | New record-centric query in `karute/page.tsx` (left-joins customers → karute_records) |
| Customer create/edit (姓+名 split, phone auto-format) | Existing `createCustomer` / `updateCustomer` server actions |
| Pagination, filters, search | In-memory (12/page; existing) |

### Stubbed (UI renders; backend is a placeholder)
| Surface | Stub location | What needs wiring |
|---|---|---|
| Notification bell (header) | `CustomersListHeader.tsx` | Notifications backend; spike was also a stub |
| AI body prediction (体調予測) | `UpcomingAiFeatures.tsx` → `AIBodyPredictionPreview` | AI generator + `karute_records.body_prediction jsonb` (see schema TODOs §3) |
| AI outreach card | `spike-lifted/outreach/AIOutreachCard.tsx` | Generator + `outreach_drafts` table + channel send (see schema §6 + backend §B) |
| AI session summary (AI要約) | `UpcomingAiFeatures.tsx` → `AISummaryPreview` | Generator + `karute_records.ai_summary jsonb` (schema §4) |
| Transcript player + utterances | `spike-lifted/transcript/TranscriptCard.tsx` | Recording flow + Whisper + diarization pass (backend §C) |
| Session entry timeline (per-utterance categories) | `spike-lifted/session/SessionEntryTimeline.tsx` | Category classifier + `karute_entries` table (schema §8) |
| Customer memory items (categorized) | `spike-lifted/memory/CustomerMemoryCard.tsx` | Memory extractor + `customer_memory_items` table (schema §9) |
| Photo records (overlapping thumbnails + body-area chips) | `spike-lifted/photos/` | Supabase Storage + `karute_photos` table (schema §10) |
| Re-engagement preview | `UpcomingAiFeatures.tsx` → `CustomerReengagementPreview` | AI generator + cron + `customer_reengagement_suggestions` table (schema §11) |
| Coaching panel (スタッフ専用) | `KaruteCustomerDetailView.tsx` (inline placeholder) | Role context plumbing + lift `KaruteCoachingPanel` from spike (Layer 1) |

Every stub renders a `対応予定` amber pill + an `ANTHONY:` block in the file header pointing at the spike source + `AI_PROMPTS.md` section.

---

## Schema TODOs (priority order)

Ordered by how blocking each is for the next visible feature unlock. None of these have been migrated — DB is untouched.

| # | Table / column | Why | Blocks |
|---|---|---|---|
| 1 | **Drop** `UNIQUE (business_id, email)` on `customers` | Real salons share emails (family accounts, shared inbox). Currently surfaces as `P2002` toast. | New-customer flow correctness |
| 2 | `customers.age int?` + `customers.gender enum?` | Form fields exist as 対応予定 stubs; spike shows them in identity card. | Identity card "{age}歳・{gender}" line |
| 3 | `customers.assigned_staff_id` (FK staff) in zod for create/update | List filter is already wired client-side; mutation drops the value. | Staff filter parity |
| 4 | `customers.karute_number int` + per-tenant Postgres sequence | Currently derived sequentially in JS at render — works for display, not persistent. | Stable karute # across pagination / sort |
| 5 | `karute_records.service text` + `karute_records.duration_minutes int` | Spike's session row shows service name + duration. | Session row meta |
| 6 | `karute_records.review_needed bool` | Drives `needsReview` AI status chip. | "要確認" badge |
| 7 | `outreach_drafts` table (or `karute_records.outreach_draft jsonb`) | Stores AI-drafted follow-up message + status (draft/sent/edited). | Outreach card |
| 8 | `karute_records.ai_summary jsonb` (or `karute_summaries`) | Bullet list + 対応予定 pill. | AI summary card |
| 9 | `customer_memory_items` (id, customer_id, category enum, content text, ai_confidence float, created_at, edited_at) | Spike's 5-category memory (health / preferences / goals / lifestyle / private). | Memory card |
| 10 | `karute_photos` (id, record_id, body_area enum, storage_path, taken_at, consent_recorded bool) | Spike's photo record overlay grid. | Photo card |
| 11 | `customer_reengagement_suggestions` (id, customer_id, suggested_at, channel, draft text, sent_at?) | Reengagement preview on profile. | Reengagement banner |
| 12 | `karute_entries` (id, record_id, utterance_id?, category enum, time, content, ai_confidence float) | Per-utterance entries by category. | Session entry timeline |
| 13 | `recordings.diarized_transcript jsonb` | Speaker-separated utterances post-Whisper. | Transcript bubbles |
| 14 | `outreach_sends` (id, draft_id, channel, sent_at, status, external_id) | Audit + dedup for send-channels. | Approve & Send button |
| 15 | `customer_intakes` table or `customers.intake jsonb` | Intake form scaffold lives in profile; data shape TBD. | Intake tab |

**Migration suggestion**: groups 1–4 are quick and unblock 4 visible surfaces; do them first in a "schema-foundations" PR. 7–14 are AI-pipeline-coupled — pair each table with the matching AI worker so we don't ship empty tables.

---

## Backend wiring TODOs (grouped by AI surface)

Each block points at the spike's `AI_PROMPTS.md` section in `/Users/liam/Documents/synqed-karute-design-spike/`. None of the production code calls any AI today.

### A. Recording → transcript → diarization pipeline
1. Recording capture flow (consent toggle is already in spike UI — needs the actual MediaRecorder + Supabase Storage upload).
2. Whisper transcription on upload completion.
3. **Diarization pass** (new) — assigns each utterance a `speaker` of `staff | customer | unknown`. Spec: spike `AI_PROMPTS.md` §6.
4. Audio playback via Supabase Storage signed URLs (5-min TTL recommended).
5. Persist on `recordings.diarized_transcript jsonb`.

### B. AI Outreach (`AIOutreachCard`)
- **Channel strategy** (Liam's call, in commit messages): LINE Messaging API requires verified business account + per-recipient consent — out of scope for first cut. Ship **`copy`** as default (clipboard) + email (SES/Salesforce) + SMS (Twilio) as automated channels once you have keys.
- Generator: nightly Sonnet pass from memory + most recent session. Prompt: spike `AI_PROMPTS.md` §3.
- Edit + Approve&Send buttons currently open a stubbed Dialog — swap for real edit form + send action.

### C. AI session summary (`AISummaryPreview`)
- Spike prompt: `AI_PROMPTS.md` §1.
- Persist on `karute_records.ai_summary jsonb`; render bullets in the card.

### D. AI body prediction (`AIBodyPredictionPreview`)
- Spike prompt: `AI_PROMPTS.md` §2 (今日の体調予測).
- Persist on `karute_records.body_prediction jsonb`.

### E. Per-utterance entry classifier (`SessionEntryTimeline`)
- Spike prompt: `AI_PROMPTS.md` §4. 5 categories: treatment / concern / condition / product / next.
- Pipeline: diarized transcript → classifier → `karute_entries`.

### F. Customer memory extractor (`CustomerMemoryCard`)
- Spike prompt: `AI_PROMPTS.md` §5. 5 categories: health / preferences / goals / lifestyle / private.
- Run after each session; appends to `customer_memory_items`.

### G. Photo capture flow (`PhotoRecordCard`)
- Camera capture + Supabase Storage upload + body-area tagging.
- Consent step (already shown in UI as `撮影同意済み` badge — needs persistence).

### H. Re-engagement (`CustomerReengagementPreview`)
- Cron-based scan for customers past their recommended rebooking window.
- Generator drafts outreach via shared prompt with §B but with reengagement-specific context.

### I. Coaching panel (Layer 1)
- Lift `KaruteCoachingPanel` from spike (`src/components/coaching/KaruteCoachingPanel.tsx`).
- Requires role-context plumbing (staff vs owner) — staff-only surface.
- Spike prompt: `AI_PROMPTS.md` §12 (in-session coaching).

---

## Dead code — safe deletions

These have 0 (non-comment) callers. Confirmed via `grep -rn "from.*<Name>"`.

| File | Status |
|---|---|
| `src/components/karute/KaruteListView.tsx` | **0 imports.** Anthony's prior session-stream view, replaced by `spike-lifted/list/KaruteRecordListView.tsx`. Safe to delete. |
| `src/components/customers/redesign/profile/MemoryTabContent.tsx` | **0 imports.** Replaced by `spike-lifted/memory/CustomerMemoryCard.tsx`. Safe to delete. |
| `src/components/customers/redesign/profile/PhotosTabContent.tsx` | **Component dead** (replaced by `PhotoRecordCard`), but the `CustomerPhoto` type is still imported by `customers/[id]/page.tsx`, `CustomerProfileView.tsx`, `CustomerDetailTabs.tsx`, `actions/customers.ts`. **Action**: move `CustomerPhoto` to its own `types.ts`, then delete this file. |

I deliberately did **not** delete these in this PR — kept them so the diff stays additive and reviewers can see the replacement pattern. Delete in a follow-up cleanup PR after merge.

---

## Multi-language posture

- Every visible chrome string lives in `messages/{en,ja}.json` keyed under namespaced paths (`customers.*`, `karute.*`).
- **No hardcoded JP/EN strings** in `.tsx` files (audited via grep on this branch).
- **Data fields are free-form user input** — memory items, intake answers, customer names all store whatever the user typed (JP / EN / ZH / anything else works without code changes).
- Adding a new language = add `messages/<locale>.json` + update next-intl config. No component changes.

**One i18n gotcha worth knowing**: my deep-set JSON helper silently fails when a key collides with a primitive (e.g. if `karute.transcript = "Transcript"` already exists as a flat string, you can't write `karute.transcript.title` over it). This bit me once mid-session — see commit `2c47106`. Recommend adding an assertion in any future i18n sweep tool.

---

## File map (spike-lifted directory)

Everything new lives under `src/components/karute/spike-lifted/` so the provenance is obvious. Each file has a header comment naming the spike source it was lifted from.

```
src/components/karute/spike-lifted/
├── KaruteCustomerDetailView.tsx       (main vertical-stack view, /karute/customer/[id])
├── KaruteAiAssistSheets.tsx           (mobile bottom-sheet pattern — md:hidden)
├── list/
│   ├── KaruteRecordListView.tsx       (record-centric karute tab)
│   ├── KaruteListRow.tsx
│   └── types.ts
├── memory/
│   ├── CustomerMemoryCard.tsx         (5-category collapsible)
│   └── types.ts
├── outreach/
│   └── AIOutreachCard.tsx             (edit + approve&send, stubbed dialogs)
├── photos/
│   ├── PhotoRecordCard.tsx
│   ├── PhotoThumbnail.tsx
│   ├── types.ts
│   └── usePhotoStore.ts               (client-side store; mutations stubbed)
├── session/
│   └── SessionEntryTimeline.tsx       (5-category chips: treatment/concern/condition/product/next)
└── transcript/
    └── TranscriptCard.tsx             (player + speakers + utterances; always renders scaffold when expanded)
```

Shared utilities:
- `src/lib/customers/identity.ts` — `deriveFamilyInitials` + `assignSequentialKaruteNumbers`
- `src/lib/customers/list-enrich.ts` — `formatJoinDate` + `formatLastVisit` (locale-aware) + `deriveKaruteNumber`
- `src/lib/format/phone.ts` — `formatJpPhone(raw)` for `0XX-XXXX-XXXX` format

---

## Verification & risk

| Check | Result |
|---|---|
| `tsc --noEmit` | **Clean** (exit 0) |
| `messages/{en,ja}.json` validity | **Valid JSON** (jq parses both) |
| Dev server boot | **Clean** (port 3000; auth redirect at `/` as expected) |
| Hardcoded JA in `.tsx` | **None** (grep clean) |
| Database migrations | **None.** Zero `prisma migrate` runs. Zero changes to `prisma/schema.prisma`. |
| Existing AI calls modified | **None.** No `Anthropic.messages.create` calls added or removed. |
| Existing routes broken | **None.** Existing `/customers`, `/customers/[id]`, `/karute` routes preserved + redesigned. New `/karute/customer/[id]` is additive. |
| Server actions modified | Only `actions/customers.ts` — added `translateBackendError` for friendlier P2002 toasts. **No behavior change** beyond toast wording. |

### What's NOT verified
- Visual eye-check past the auth wall — Liam will eye-check post-pull. The headless preview browser can't pass the auth gate.
- Cross-browser polish (only validated in Chrome desktop). Mobile validated at 393 + 440 px via responsive tools.
- Cross-locale rendering on long German/Korean strings (only EN + JA tested).

### What could go wrong on merge
- If you've added anything to `karute_records` in `main` since the branch point, the record-centric query in `karute/page.tsx` may need a fresh `npx prisma generate` after merge.
- The Dialog-based `CustomerEditDialog` uses our `Dialog` component which renders via `render` prop, not `asChild` — if you've recently refactored Dialog APIs, double-check this wrapper.

---

## Branch hygiene recommendations for future work

Liam mentioned splitting into branches: **UI / function / bug fix**. Forward-looking:

- **UI branch** (this one): visual + scaffolding only. ✅ Done — merge-ready.
- **`schema-foundations` branch** (suggested next): items 1–4 from the schema TODOs table above. Small, mergeable independent of any AI work.
- **`ai-memory` branch**: memory extractor pipeline + `customer_memory_items` table + wire `CustomerMemoryCard` to real data.
- **`ai-summary-and-outreach` branch**: summary generator + outreach drafter + the two tables they need. Pair with `outreach_sends` send-channel implementation.
- **`recording-pipeline` branch**: recording capture + Whisper + diarization + Supabase Storage signed URLs. The transcript card lights up automatically.
- **`coaching-layer-1` branch**: lift coaching panel + role-context plumbing.

Each can ship in any order — the UI scaffolding doesn't care which AI pipeline lands first.

---

## One last thing

Every component file under `spike-lifted/` has a header comment naming its spike source and an `ANTHONY:` block calling out the specific data shape / table / prompt it needs. When you're wiring a feature, the file itself tells you what to plug in.

Spike repo for reference: `/Users/liam/Documents/synqed-karute-design-spike/`
Spike prompts: `AI_PROMPTS.md` in that repo
Spike data spec: `AI_INTEGRATION_SPEC.md`

Ping Liam if any section reads ambiguously — happy to clarify or restructure.
