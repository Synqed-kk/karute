# Roadmap: Karute

## Overview

Build a digital karute (client record-keeping) app for Japanese service businesses — salons, spas, clinics. The journey starts with project foundation, database, and working audio recording in Phase 1, then layers AI transcription and extraction, customer management, karute record saving, staff profiles, UI polish, export, and integration testing. Each phase delivers a complete, verifiable capability that compounds into the full product.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation + Recording** - Project scaffold, database schema, auth, CI/CD, and working browser mic recording
- [ ] **Phase 2: AI Pipeline** - Whisper transcription, GPT entry extraction, session summary, human review screen
- [ ] **Phase 3: Customer Management** - Create, edit, list, and view customers with karute history
- [ ] **Phase 4: Karute Records** - Karute detail view, categorized entries, manual entry addition, save to Supabase
- [ ] **Phase 5: Staff Profiles** - Staff profile CRUD, header switcher, and record attribution
- [ ] **Phase 6: UI/UX Polish** - Dark theme, bilingual toggle, sidebar navigation, tablet-responsive layout
- [x] **Phase 7: Export** - PDF export with Japanese fonts and plain text export
- [ ] **Phase 8: Integration Testing** - End-to-end integration tests for main flows and test data cleanup

## Phase Details

### Phase 1: Foundation + Recording
**Goal**: The project runs locally and in CI, data persists to Supabase, and a staff member can open the app and record a session through the browser microphone.
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, REC-01, REC-02, REC-03, REC-04
**Success Criteria** (what must be TRUE):
  1. Developer can run `npm dev` and see the app at localhost with dark theme shell and sidebar
  2. Supabase schema exists with customers, karute_records, entries, and profiles tables with RLS policies applied
  3. User can log in with business email/password and be redirected to the app
  4. User can open the recording modal, select a staff member, press record, see a live waveform and timer, and stop to produce an audio blob
  5. CI runs on pull requests, integration branch workflow is configured, and PRs use @claude tag convention
**Plans**: 7 plans

Plans:
- [ ] 01-01-PLAN.md — Next.js 16 scaffold with Tailwind v4 CSS-first config, shadcn, dark theme shell, collapsible sidebar
- [ ] 01-02-PLAN.md — Supabase schema (4 tables + RLS policies), browser/server clients, TypeScript types, dev/prod env config
- [ ] 01-03-PLAN.md — Supabase Auth email/password login, protected route group, proxy.ts token refresh
- [ ] 01-04-PLAN.md — next-intl v4 i18n routing (EN/JP), locale layout with NextIntlClientProvider, proxy.ts composition
- [ ] 01-05-PLAN.md — GitHub Actions CI (lint + type-check + test), integration branch workflow CONTRIBUTING.md
- [ ] 01-06-PLAN.md — MediaRecorder hooks with format negotiation, waveform visualization, recording timer
- [ ] 01-07-PLAN.md — Recording modal UI with staff selector, state machine (idle → recording → recorded)

### Phase 2: AI Pipeline
**Goal**: A recorded audio blob flows through Whisper transcription and GPT extraction, producing a transcript, categorized entries with confidence scores, and a session summary — all in the user's chosen language — before the audio is discarded.
**Depends on**: Phase 1
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06
**Success Criteria** (what must be TRUE):
  1. After stopping a recording, the audio is sent to Whisper and a Japanese/English transcript appears in the UI
  2. GPT produces structured entries (Preference, Treatment, Lifestyle, etc.) each with a category, title, source quote, and confidence score
  3. A prose session summary is generated and visible alongside the entries
  4. AI outputs (entry titles, summary text) respect the active language toggle (EN or JP)
  5. No audio file is ever written to Supabase Storage — only transcript text and extracted entries are persisted
  6. User sees a human review screen where they can edit, add, or remove AI-extracted entries before saving
**Plans**: 4 plans

Plans:
- [ ] 02-01-PLAN.md — Shared AI types/Zod schemas, OpenAI client singleton, locale-aware prompts, Whisper transcription API route
- [ ] 02-02-PLAN.md — GPT structured extraction API route + GPT session summary API route
- [ ] 02-03-PLAN.md — Human review screen UI with EntryCard, ReviewHeader, two-column layout, useFieldArray
- [ ] 02-04-PLAN.md — Pipeline orchestration (transcribe → parallel extract + summarize), processing modal, PipelineContainer

### Phase 3: Customer Management
**Goal**: Staff can create customers, find existing customers, and view a customer's complete session history at a glance.
**Depends on**: Phase 1
**Requirements**: CUST-01, CUST-02, CUST-03, CUST-04
**Success Criteria** (what must be TRUE):
  1. User can create a new customer with name and optional contact info, and the record persists in Supabase
  2. User can edit an existing customer's name and contact info
  3. User can view a paginated/searchable customer list and find a customer by name
  4. User can open a customer profile and see all past karute sessions in reverse-chronological order
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — Schema migration (furigana, phone, email columns), updated types, Server Actions, query helpers, avatar utils, i18n strings
- [ ] 03-02-PLAN.md — Customer list page with searchable/sortable table, pagination, new customer sheet with creation form
- [ ] 03-03-PLAN.md — Customer profile page with inline editing, visit stats, karute history list (scaffolded for Phase 4)

### Phase 4: Karute Records
**Goal**: After reviewing AI-extracted entries, a staff member can save a complete karute record linked to a customer and view the full detail of any past session.
**Depends on**: Phase 2, Phase 3
**Requirements**: KRT-01, KRT-02, KRT-03, KRT-04
**Success Criteria** (what must be TRUE):
  1. User can save a reviewed session as a karute record linked to a specific customer and staff member, and it persists in Supabase
  2. User can open any past karute record and see the AI summary, full transcript, and all categorized entries
  3. Entries display with color-coded category tags and confidence scores
  4. User can add a manual entry to any karute record via a + Add Entry button
**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md — Category constants, karute types, Server Actions (save record, add/delete entry), query helpers
- [ ] 04-02-PLAN.md — Karute detail view with two-column layout, entry cards, category badges, confidence dots, collapsible transcript, inline add entry form
- [ ] 04-03-PLAN.md — Save flow components: sessionStorage draft helpers, customer combobox, quick-create customer, SaveKaruteFlow
- [ ] 04-04-PLAN.md — Wire AI review screen to save flow, karute list page for browsing past records

### Phase 5: Staff Profiles
**Goal**: Multiple staff members can be represented in the system, a staff member can be selected in the header without re-authenticating, and every karute record shows which staff member created it.
**Depends on**: Phase 1
**Requirements**: STAFF-01, STAFF-02, STAFF-03
**Success Criteria** (what must be TRUE):
  1. Admin can create and edit staff profiles (name, display info) in the Settings page
  2. User can switch the active staff member from the header switcher without logging out
  3. Every saved karute record displays the name of the staff member who created it
**Plans:** 4 plans

Plans:
- [ ] 05-01-PLAN.md — Staff data layer: Server Actions (CRUD + setActiveStaff), helpers, Zod schema, RLS policies
- [ ] 05-02-PLAN.md — Staff management UI: Settings page with StaffList and StaffForm (create/edit/delete)
- [ ] 05-03-PLAN.md — Header staff switcher: StaffSwitcher dropdown, layout integration, cookie-backed persistence
- [ ] 05-04-PLAN.md — Gap closure: staff name display on karute detail view and history list (profiles join + render)

### Phase 6: UI/UX Polish
**Goal**: The full app is visually consistent with the mockup aesthetic, fully bilingual, navigable via sidebar, and comfortable on a tablet.
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. Every page uses the dark theme with visual consistency matching the provided mockup (colors, spacing, typography)
  2. User can toggle the language between EN and JP in the header and all UI text and AI outputs switch immediately
  3. Sidebar navigation links to Recording, Customers, Karute, and Settings pages and shows the active page
  4. App is fully usable on a tablet viewport (1024px) — no broken layouts, touch-friendly tap targets
**Plans**: 4 plans

Plans:
- [ ] 06-01-PLAN.md — Dark theme infrastructure (ThemeProvider, OKLCH tokens, Inter + Noto Sans JP fonts) and dashboard layout shell matching reference app
- [ ] 06-02-PLAN.md — Custom 90px sidebar with active state detection, TopBar with locale toggle and theme toggle
- [ ] 06-03-PLAN.md — Wire sidebar and TopBar into dashboard layout, complete EN/JP translation files for all pages
- [ ] 06-04-PLAN.md — Tablet responsive audit and fixes (touch targets, scrollable tables, stacked layouts), human verification

### Phase 7: Export
**Goal**: A staff member can export any karute record as a formatted PDF (with Japanese character support) or as plain text for use outside the app.
**Depends on**: Phase 4
**Requirements**: EXP-01, EXP-02
**Success Criteria** (what must be TRUE):
  1. User can click Export PDF on a karute detail view and receive a downloadable PDF with AI summary, entries, and transcript — Japanese characters render correctly using Noto Sans JP
  2. User can click Export Text and receive a plain text file containing the karute record contents
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — PDF export: @react-pdf/renderer with Noto Sans JP font embedding, KarutePdfDocument component, PDF route handler with auth and streaming
- [x] 07-02-PLAN.md — Plain text export: formatKaruteAsText formatter, text route handler, ExportButtons client component for karute detail view

### Phase 8: Integration Testing
**Goal**: The core end-to-end flow (record → transcribe → extract → review → save → view) is covered by automated integration tests that clean up after themselves, giving confidence in future changes.
**Depends on**: Phase 4
**Requirements**: TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. Automated integration tests cover the full record → transcribe → extract → save → view karute flow and pass in CI
  2. Test runs do not leave any data in the Supabase test database — teardown cleans up all created customers, karute records, and entries
**Plans**: TBD

Plans:
- [ ] 08-01: Integration test setup — test environment config, Supabase test project connection, test auth helpers, mock for OpenAI API calls
- [ ] 08-02: Core flow integration tests — record (mock audio) → transcribe → extract → review → save → view karute record
- [ ] 08-03: Test teardown and cleanup — afterEach/afterAll hooks that delete all test-created records from Supabase

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + Recording | 0/7 | Planned | - |
| 2. AI Pipeline | 0/4 | Planned | - |
| 3. Customer Management | 0/3 | Planned | - |
| 4. Karute Records | 0/4 | Planned | - |
| 5. Staff Profiles | 0/3 | Planned | - |
| 6. UI/UX Polish | 0/4 | Planned | - |
| 7. Export | 2/2 | ✓ Complete | 2026-03-14 |
| 8. Integration Testing | 0/3 | Not started | - |
