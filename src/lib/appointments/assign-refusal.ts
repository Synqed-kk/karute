// ⚖ FIX ROUND 3 item 10 (B2-2) — the ONE definition of the assign door's
// "this booking already has a staff" refusal. Client-safe on purpose (no server
// imports): the server door (mutations.ts assignStaffToBooking) returns it and
// the 担当未定 sheet recognises it, so a second tap that lost the race closes
// and refreshes instead of toasting an error.

/** Refusal for an assignment onto a booking that already has a staff. */
export const BOOKING_ALREADY_STAFFED = 'Booking already has a staff member.'
