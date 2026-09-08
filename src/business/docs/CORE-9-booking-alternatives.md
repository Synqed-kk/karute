# CORE-9: booking alternatives and packing plans

Anthony approved this contract on 2026-09-07: a free bed can support several advertised therapist options. The bed is reserved only when a booking is confirmed. A displayed option is not a reservation.

The Today board now distinguishes **予約候補** (individually bookable therapist/start/duration choices) from **配置案** (the existing suggested packing layout). The former is the availability answer. The latter can reflow when a booking is cancelled and is not a simultaneous-capacity count or the complete customer choice set. Summing the prices of overlapping alternatives would not measure available revenue.

`bookingOptionsFor` adapts the committed board into `bookableOptions`. Each candidate uses a fixed customer-grid start and the selected treatment duration. It requires an unlocked, priced staff lane within its shift and at least one same-store room free for the entire treatment plus that room's cleanup. One room must cover the whole interval: two partial rooms cannot jointly satisfy a treatment. Stores without rooms retain staff-only availability. Private treatments require a private room; ordinary treatments prefer standard rooms under the store's private-last rule. Eligibility IDs are witnesses, not committed room assignments.

Booking choices use the existing committed held-window mask to label protected choices **新規限定** (new clients only). They remain visible as options instead of disappearing. Recomputed protection can change an option’s audience, but removing occupancy does not remove its therapist/start/duration identity. This preserves the stock-protection policy without mislabelling protected stock as generally bookable.

The packing plan and its pricing/guard rules remain available as operational suggestions. They no longer define the newly exposed booking choices. This is why the old greedy packing routine remains: it solves a proposed layout, not advertised availability. The nine-lane and synthetic regressions check the new availability adapter rather than freezing the packing plan's known losses.

The option list is read-only. Existing booking confirmation remains responsible for allocating and validating a room and enforcing Core's resource exclusion constraint. Availability does not acquire a database lock or create a reservation. This PR changes the Karute board; it does not claim to wire Reserve's separate public availability API or deploy Core's pending private-room migration.

## Verification

- Primitive tests cover shared capacity, whole-interval fit, cleanup, store isolation, shifts, locks, private-room requirements and cancellation monotonicity across durations/grids.
- The real fixture, its tomorrow view, the synthetic counterexample, and locked-lane variants pass a cancellation sweep through the same adapter used by the screen.
- The synthetic `apt-06-0` regression preserves therapist `p-06`'s 16:30–17:00 choice after cancellation.
- Existing packing/guard tests remain, with UI wording/census updates for the new availability reader.
- Full Jest suite: 536 suites passed, 8,672 tests passed and one skipped with `TZ=UTC`. The initial local-timezone run exposed an unchanged date-label test; it passes in UTC, matching CI.
- Type-check passes. Targeted lint has zero errors and one pre-existing hook warning.
- Compiled TodayScreen browser smoke passes at 1440×1000 and 390×844, including duration/private-room controls and popup viewport bounds. It uses the real fixture and React providers with Next navigation/link stubs; it is not a deployed end-to-end booking test.
