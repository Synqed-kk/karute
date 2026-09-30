# Reserve member-card port — parity record

Source pin: `Synqed-kk/reserve` @ `4db48b73ba70fc5752bacbcce569e9a2dae96791` (2026-09-30 19:37:56 +0900).
Emitted by `node scripts/business/reserve-card-parity/run.mjs` — do not edit by hand.

## What is ported (file → Reserve range, byte-identical below each marker)
- `satin-material.ts` ← `src/lib/satin-material.ts` 1–33 (whole file)
- `member-card-vars.ts` ← `src/lib/types.ts` 170–193 (BrandTheme) · `src/lib/reserve-api/member-ia.ts` 257–272 (tenantGradientPair) · `src/components/customer/salon-surface.tsx` 36–61 (memberTenantVars)
- `ReserveCardPreview.tsx` ← `studio-home.tsx` 434–472 (the card's measure effect) · `studio-salon.tsx` 75–121 (the cover's measure effect) · `membership-date.tsx` 1–6; the JSX is Reserve's (studio-home.tsx MembershipCard 482–538, TenantCard 680–705; studio-salon.tsx StudioCover 163–237), the cover's lines 2–3 take the SHAPE of `member-ia.ts` coverLines 458–479 (never its data), with the edits listed in its header
- `reserve-card.css` ← `src/index.css` 871–884 · 905–960 · 1039–1051 · 1053–1104 · 1106–1126 · 1140–1140 · 1248–1503 · 1505–1533 · 1552–1579 · 1634–1666 · 3950–4020 · 4651–4660 · 4674–4682 · 4687–4687 · 4689–4690 · 4692–4727 · 4769–4822, plus ONE marked context block (not verbatim: --font-sans/--font-num from index.css 33–34, body 185–191, the page root's bg-background/text-foreground, and the inherited text defaults Reserve's page hands down — re-scoped to the preview root so a host's inherited type cannot leak in), and the SCOPED blocks listed under Declared edits

Verbatim check (last run): 24/24 identical
Scoped blocks (declarations after prefix strip): 2/2 identical

## Declared edits (not verbatim)
- `reserve-card.css` ← `src/index.css` 214–221 · 237–246 (.pressable, .tap44) — SCOPED: selectors prefixed `.member-ground `, declarations byte-identical to Reserve. Reserve keeps both idioms global in its own app; here a global rule would reach any Business element carrying the class. Checked by the harness after stripping the prefix (see the scoped-blocks line above).
- `ReserveCardPreview.tsx` StudioCover, the no-store branch — fallback branch: same markup as Reserve, not pixel-proven (no store-less case in the harness set). Its category line is fixed to GENERIC 「お店」: the port carries no business type.
- `ReserveCardPreview.tsx` + `card-color.ts` — Colour inputs are normalised at the boundary (card-color.ts): only `#RRGGBB` reaches the satin math; anything else counts as absent — identical on server and client, no hydration drift.

## Left out of index.css 4650–4822, and why
- 4661–4673 .member-minicard__stripe, .tameru-ticket__stub / .member-sheet__mark, .member-rc__wm — other tenant objects that wear the card's Satin (マイページ thumbnail, 回数券 stub, store sheet mark, 受付 wordmark), not a surface element
- 4683 .salon-rankfloat — the rank chip under the cover (store page body), not a surface element
- 4684–4686 .salon-next / __label / __date — the store page's 次回 block, not a surface element
- 4728 .member-ground.salon-surface > main — the store page's main column
- 4729–4767 .salon-rankfloat, .salon-next*, .salon-acts*, .salon-posts* — store page body (rank chip, next visit, points row, action buttons, posts) — the switchboard, LATER

## Other rules the surfaces match that are NOT ported
- 69–103, 302–306, 858–869 :root / .dark — app-wide tokens; every one the surfaces read is re-pointed by the ported .member-ground blocks (871–884, 905–960)
- 193–195 ::selection — global text-selection tint; porting it would restyle every Business page
- 322–351, 595–598, 608–611, 771–775 .member-ground (band / tray / column) — band and tab-tray geometry and the page column; nothing in the surfaces reads them
- 1036–1038 .member-ground main.main--greet — the preview has no <main>; its only job (padding-top 0) is the wrapper's own default
- 1534–1550 .copy-ok — no element opts back into selection
- 1580–1617 button / row / deal press tiers — match no element of the three surfaces
- 1618–1633 :focus-visible rings — the preview holds no focusable element (its anchors carry no href)
- 146–170 .salon-surface — the store page root's tenant re-skin (ground, role tints); the cover reads none of it
- 4642–4649 .member-shell-clearance — page-root clearance for the tray

## Proof
The harness ships in its own non-Business PR (branch `feat/business-reserve-card-parity-harness`): a shared file never rides in a Business PR (scripts/business/check-business-isolation.mjs). From a checkout of that branch, point it at this one with `PARITY_REPO=<this checkout>`; once both are on main, no env is needed.

`node scripts/business/reserve-card-parity/run.mjs` — 12 palette values × {home, store} + a 22-character name × {home, store} + the seed's own #285643; .mcard 353×187 · .tcard 353×76 · .salon-cover 393×295 at 393px; PASS = 0 differing RGB pixels per surface and every verbatim block identical (any DIFFER fails the run). Report + PNGs: this run's own scratch dir `<PARITY_DIR or tmpdir>/reserve-card-parity-XXXXXX/parity/` — removed at exit; run with `PARITY_KEEP=1` to keep it (the path is printed as `scratch kept: …`).
The unit test (src/__tests__/integration/business/reserve-card.test.ts) reads `reserve-card.expected-satin.json` beside it, emitted by the harness from Reserve's own satin-material.ts.
Reserve's small card at the pin is STUDIO FORCE (its name lives outside mock.ts), so the port's small card is compared under that name and colour pair; Reserve's store page hides `.salon-rankfloat` (a sibling overlapping the cover's bottom edge) for the capture; the port's sample context is Reserve's demo member at 2026-09-14 10:00 JST, so Reserve's clock is frozen there.

## Shipping
`reserve-card.css` is imported by the client component; it ships in a route chunk only once a route imports `ReserveCardPreview` (Turbopack drops the unused import). Proven 2026-09-24 with a temporary probe route: `.tap44` and every port rule landed in the route chunk; absent from every chunk on the unwired tip.

## Keeping it in step
When Reserve changes any of these ranges, re-run the harness against the new pin; a diff = re-port, never patch.
