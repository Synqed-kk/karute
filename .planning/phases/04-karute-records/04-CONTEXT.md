# Phase 4: Karute Records - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Save reviewed AI-extracted sessions as karute records linked to a customer and staff member. View karute detail with AI summary, transcript, and categorized entries. Add manual entries to any karute record. This phase connects the AI pipeline (Phase 2) and customer management (Phase 3) into a persisted record.

</domain>

<decisions>
## Implementation Decisions

### Karute detail layout
- Two-column layout: entries on the left, summary + transcript on the right; stacks vertically on mobile/tablet
- Entries displayed as compact list items (category tag, title, confidence dot on one line; source quote on expand)
- Transcript collapsed by default — click to expand
- Header shows customer name, staff name, date, session duration — no avatar/photo

### Entry categories & tags
- Keep all 8 categories from existing app: Symptom (red), Treatment (blue), Body Area (purple), Preference (amber), Lifestyle (green), Next Visit (cyan), Product (pink), Other (gray)
- Colored pill/badge style for category tags (e.g., rounded "Preference" badge in teal)
- Flat list with category tags on each entry — not grouped by category
- Confidence scores shown as color-coded dots (green/yellow/red) — no numbers
- AI entries include originalQuote linking back to the source transcript text

### Save flow
- After confirming entries on the AI review screen, inline searchable combobox to select customer
- "+ New customer" shortcut in the picker — quick name entry, creates and selects in one step
- Save immediately on click — no confirmation dialog
- After save, redirect to the newly created karute detail view

### Manual entry addition
- Inline always-visible form at the top of the entries list (same pattern as existing karute app)
- Category-first: user picks a category badge, then types content in a textarea, clicks add
- Fields: category selector + content text only (minimal)
- Manually added entries get a small "Manual" badge to distinguish from AI-extracted entries
- Manual entries have no confidence score (AI-only concept)
- Entry action buttons (edit/delete) revealed on hover — clean by default

### Claude's Discretion
- Exact color values for category badges (match dark theme aesthetic)
- Entry card spacing and typography details
- Loading/saving state animations
- Error state handling for save failures
- How originalQuote is displayed when expanded (tooltip, inline text, etc.)

</decisions>

<specifics>
## Specific Ideas

- Follow existing karute app patterns from github.com/synqdev/karute — specifically the KaruteEditor two-column layout, inline add-entry form with category badge selection, and hover-reveal action buttons
- Recording flow in existing app at synq-karute.vercel.app/appointments is the reference UX
- Entry data structure should match existing: category, content, originalQuote (optional), confidence (AI-only), tags, sortOrder

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-karute-records*
*Context gathered: 2026-03-13*
