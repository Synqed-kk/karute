// ─────────────────────────────────────────────────────────────
// Coaching dev preview — types
// ─────────────────────────────────────────────────────────────
// The dev preview lets a developer (Liam, Anthony) override the
// session-derived role for the coaching surfaces, so they can
// QA both owner and staff renderings without flipping DB rows
// or creating dummy staff accounts.
//
// SECURITY POSTURE
//
// This is a CLIENT-SIDE RENDER OVERRIDE ONLY. It does not
// elevate API privileges — RLS still enforces what data is
// returned. A developer flipping to "staff" preview still
// sees data scoped to their own session; flipping to "owner"
// preview against a staff session still returns staff-scoped
// data. The overlay is a UX QA tool, not a privilege gate.

export type CoachingRole = 'owner' | 'staff'

/** null = no override (use the real session role). */
export type DevPreviewRoleOverride = CoachingRole | null
