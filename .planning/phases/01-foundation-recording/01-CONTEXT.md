# Phase 1: Foundation + Recording - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Project scaffold (Next.js 16 + Supabase + Tailwind v4 + shadcn), database schema with RLS, auth, i18n (EN/JP), CI/CD, and working browser mic recording with staff selection. No AI transcription (Phase 2), no customer management (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Recording Experience
- Tap mic button → recording starts immediately (no countdown, no confirmation)
- After recording stops → send to AI immediately (auto-send to Whisper, show loading state) — note: Whisper integration is Phase 2, but the POST to `/api/transcribe` route should be wired
- Recording panel is a left panel overlay that slides in from left over the sidebar area (matches mockup)
- Waveform and recording flow should match the existing synq-karute app (https://github.com/synqdev/karute) as closely as possible
- Recording state machine: idle → recording → paused ↔ recording → stopped (then auto-send)
- Include pause/resume support (existing app has this)

**Existing app recording details (from repo analysis):**
- Waveform: 30 vertical bars (pill-shaped, `w-1.5 rounded-full bg-primary/40`). Cosine envelope — center bars tallest, edges shortest. Organic jitter for natural look. Flat at 8px when idle, animated with `transition-all duration-150 ease-out`
- Idle state: Single large round mic button (size-20, 80px circle, lucide Mic icon) with hover scale-up and active scale-down
- Recording state: Mic button replaced by Pause button (outline, size-14) + Stop button (destructive/red, size-14, Square icon)
- Paused state: Timer freezes, waveform goes flat, Pause flips to Play icon
- Stopped state: Green checkmark circle, "Recording complete" + file size, "New Recording" + "Upload" buttons
- Customer selector dropdown above the recording area
- Timer: large monospace `text-4xl font-light tracking-widest` (e.g., "04:38")
- Uses `navigator.mediaDevices.getUserMedia({ audio: true })`, MediaRecorder with 100ms chunks, Web Audio AnalyserNode for real-time RMS amplitude
- Audio format: `audio/webm` blob assembled from chunks
- Container: `rounded-2xl border border-border/50 bg-card/50 px-8 py-12 backdrop-blur-sm` max-w-md centered

### Dark Theme / Visual Direction
- Pixel-match the existing synq-karute repo UI — that codebase is the design reference
- Also reference the provided PSD mockups for any screens not in the existing app
- Inter font for English, Noto Sans JP for Japanese
- Sidebar collapses to icons only on smaller/tablet screens
- Header matches mockup exactly: sun icon (theme toggle), EN/JP toggle, user avatar + name dropdown

### Staff Switching
- Avatar dropdown in header — click avatar/name → dropdown list of staff → tap to switch
- Switching staff only changes attribution — new recordings get tagged with selected staff
- All staff see all records (no filtering by staff)
- Staff profiles managed in Settings page (name only — no role, no avatar upload)
- Auto-generated initials badge for the avatar display (like "AL" in mockup)

### Login / Onboarding
- Minimal dark login page — dark background, centered card with email/password fields, app logo above
- Self-service signup — sign up page with email/password creates business account
- Onboarding flow should match the existing synq-karute app
- After login → straight to the app (no mandatory setup wizard)

### Claude's Discretion
- Forgot password flow — include if low effort, skip if complex
- Loading skeleton design during recording send
- Exact spacing and component sizing (follow shadcn defaults where mockup is ambiguous)
- Error state handling for failed recordings
- AudioContext resume strategy

</decisions>

<specifics>
## Specific Ideas

- **Primary design reference**: https://github.com/synqdev/karute — match the UI of this existing codebase as closely as possible. This is the "reborn" of that app.
- **Mockup PSD**: Provided screenshots show the karute detail view, recording modal with dotted waveform, sidebar nav with icons + labels
- The recording panel overlays from the left side (not centered modal)
- Header shows: theme toggle (sun icon), EN/JP language toggle, staff avatar with initials + name + dropdown chevron

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-recording*
*Context gathered: 2026-03-13*
