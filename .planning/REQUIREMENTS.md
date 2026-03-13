# Requirements: Karute

**Defined:** 2026-03-13
**Core Value:** Service providers can record a client session conversation and instantly get a structured, categorized digital karute without writing anything down.

## v1 Requirements

### Foundation

- [ ] **FOUND-01**: Next.js 16 project scaffold with TypeScript, Tailwind v4, shadcn
- [ ] **FOUND-02**: Supabase schema with RLS policies (customers, karute_records, entries, profiles tables)
- [ ] **FOUND-03**: Single business auth via Supabase Auth (email/password)
- [ ] **FOUND-04**: i18n scaffolding with next-intl (EN/JP) affecting UI and AI outputs
- [ ] **FOUND-05**: GitHub Actions CI/CD with Claude (@claude tag for PR code changes)
- [ ] **FOUND-06**: Integration branch workflow (PRs per task → integration → main)
- [ ] **FOUND-07**: Prod + dev Supabase environments with env config

### Recording

- [ ] **REC-01**: Browser mic recording with visual waveform and timer
- [ ] **REC-02**: iOS Safari + Chrome audio format handling (mp4/webm)
- [ ] **REC-03**: Staff profile selection before/during recording
- [ ] **REC-04**: Recording modal UI matching mockup design (dark theme, centered mic button)

### AI Pipeline

- [ ] **AI-01**: Whisper transcription of session audio (Japanese + English)
- [ ] **AI-02**: GPT structured entry extraction (category, title, source quote, confidence score)
- [ ] **AI-03**: AI session summary generation
- [ ] **AI-04**: AI outputs respect user's language preference (EN/JP)
- [ ] **AI-05**: Audio discarded after transcription — never persisted to storage
- [ ] **AI-06**: Human review screen before save (edit/add/remove AI-extracted entries)

### Customers

- [ ] **CUST-01**: User can create customer with name and optional contact info
- [ ] **CUST-02**: User can edit customer profiles
- [ ] **CUST-03**: User can view customer list with search
- [ ] **CUST-04**: User can view customer's karute history (chronological)

### Karute

- [ ] **KRT-01**: Karute detail view showing AI summary, transcript, and categorized entries
- [ ] **KRT-02**: Manual entry addition via + Add Entry button
- [ ] **KRT-03**: Save karute records to Supabase linked to customer and staff member
- [ ] **KRT-04**: Entry categories with color-coded tags (Preference, Treatment, Lifestyle, etc.) and confidence scores

### Staff

- [ ] **STAFF-01**: Staff profiles with name and display info
- [ ] **STAFF-02**: Staff switcher in header (toggle without re-authenticating)
- [ ] **STAFF-03**: Staff attribution on karute records (which staff created the record)

### Export

- [ ] **EXP-01**: PDF export of karute with Japanese font support (Noto Sans JP embedding)
- [ ] **EXP-02**: Plain text export of karute record

### UI/UX

- [ ] **UI-01**: Dark theme matching mockup aesthetic
- [ ] **UI-02**: Bilingual UI toggle (EN/JP) in header
- [ ] **UI-03**: Sidebar navigation (Recording, Dashboard, Customers, Karute, Settings)
- [ ] **UI-04**: Responsive layout optimized for tablet use in salon environments

### Testing

- [ ] **TEST-01**: Integration tests for main flows (record → transcribe → extract → save)
- [ ] **TEST-02**: Test teardown/cleanup so test data does not persist in database

## v2 Requirements

### Notifications
- **NOTF-01**: In-app notifications for new karute entries
- **NOTF-02**: Notification preferences per staff member

### Photos
- **PHOTO-01**: Before/after photo capture per visit
- **PHOTO-02**: Photo gallery per customer

### Advanced Karute
- **AKRT-01**: Transcript search across all past sessions
- **AKRT-02**: Timeline view of karute entries over time
- **AKRT-03**: Customizable karute fields per service type (hair, nail, skin)
- **AKRT-04**: Counseling sheet / intake form for first visits

### Advanced Customer
- **ACUST-01**: Customer tags/categories (VIP, regular, etc.)
- **ACUST-02**: Customer photos/avatars
- **ACUST-03**: Allergy and sensitivity tracking

### AI Chat
- **AICHAT-01**: AI assistant for querying past karute records
- **AICHAT-02**: AI-suggested follow-up questions based on history

### Moderation
- **MOD-01**: Staff-level permissions (read/write/admin)
- **MOD-02**: Audit log of karute changes

## Out of Scope

| Feature | Reason |
|---------|--------|
| Appointment scheduling/booking | Full product domain, not related to karute creation |
| POS / payment processing | Separate concern, adds massive complexity |
| Marketing / campaigns | Not a karute feature |
| Loyalty programs | Not a karute feature |
| Real-time streaming transcription | Batch after recording is simpler and sufficient for v1 |
| Mobile native app | Web-first, responsive design covers tablet use |
| Multi-tenant / multi-business | Single business for v1, architect for expansion later |
| OAuth / social login | Single shared business login sufficient |
| Data migration from other systems | v2+ feature |
| Offline mode | Requires service worker complexity, defer to v2 |
| Dashboard analytics | v2 feature |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Pending |
| FOUND-06 | Phase 1 | Pending |
| FOUND-07 | Phase 1 | Pending |
| REC-01 | TBD | Pending |
| REC-02 | TBD | Pending |
| REC-03 | TBD | Pending |
| REC-04 | TBD | Pending |
| AI-01 | TBD | Pending |
| AI-02 | TBD | Pending |
| AI-03 | TBD | Pending |
| AI-04 | TBD | Pending |
| AI-05 | TBD | Pending |
| AI-06 | TBD | Pending |
| CUST-01 | TBD | Pending |
| CUST-02 | TBD | Pending |
| CUST-03 | TBD | Pending |
| CUST-04 | TBD | Pending |
| KRT-01 | TBD | Pending |
| KRT-02 | TBD | Pending |
| KRT-03 | TBD | Pending |
| KRT-04 | TBD | Pending |
| STAFF-01 | TBD | Pending |
| STAFF-02 | TBD | Pending |
| STAFF-03 | TBD | Pending |
| EXP-01 | TBD | Pending |
| EXP-02 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| TEST-01 | TBD | Pending |
| TEST-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 7 (Foundation)
- Unmapped: 24 (pending roadmap creation)

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after initial definition*
