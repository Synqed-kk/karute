# Phase 3: Customer Management - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can create customers, find existing customers, and view a customer's complete session history at a glance. This phase covers CRUD operations for customer records and a profile page with karute history. It does NOT include karute record creation/saving (Phase 4), customer deletion, or advanced features like tags/categories.

</domain>

<decisions>
## Implementation Decisions

### Customer List Presentation
- Table layout with sortable columns: name, contact, last visit, visit count
- Initials avatar circle (random pastel color per customer) next to customer name
- Default sort: last visit date (most recent first)
- All columns sortable by clicking headers
- Live search (debounced, filter as you type) matching name + furigana + contact info (phone/email)
- Page numbers at bottom, 10 customers per page
- "+ New Customer" button in top right of page header
- Subtle row highlight on hover (no pointer cursor change)
- Click row navigates directly to customer profile page
- No delete functionality in v1

### Customer Creation Flow
- Sheet/drawer slides in from the right side (stays on list page)
- Fields: name (single field, required), furigana/reading (optional), phone (optional), email (optional)
- After save: sheet closes, list refreshes, success toast notification
- Duplicate name detection: warn "A customer named X already exists" but allow saving

### Customer Profile Layout
- Header section at top: larger initials avatar, customer name, contact info, visit stats (count + last visit date), Edit button
- Edit button triggers inline editing in the header — fields become editable in-place with Save/Cancel
- Karute history list below header showing sessions in reverse-chronological order
- Each session row shows: date, staff member name, AI summary snippet (~100 chars)
- Click session row navigates to karute detail page (/karute/[id])
- Karute history paginated same as customer list (10 per page, page numbers)
- "Back" always navigates to /customers list page

### Claude's Discretion
- Customer name display order (Japanese family-first vs locale-dependent)
- Exact avatar pastel color palette for dark theme
- Loading skeleton design
- Error state handling for failed API calls
- Exact spacing, typography, and responsive breakpoints

</decisions>

<specifics>
## Specific Ideas

- Furigana field enables searching by pronunciation (e.g., type たなか to find 田中) — important for Japanese business context
- Initials circles should have consistent per-customer colors (deterministic from customer ID, not random on each render)
- Empty states should feel welcoming, not empty — illustration/icon + clear CTA for first-time experience

</specifics>

<deferred>
## Deferred Ideas

- Customer deletion — not included in v1 to prevent accidental data loss
- Customer tags/categories (VIP, regular) — captured in v2 requirements as ACUST-01
- Customer photos/avatars — captured in v2 requirements as ACUST-02

</deferred>

---

*Phase: 03-customer-management*
*Context gathered: 2026-03-13*
