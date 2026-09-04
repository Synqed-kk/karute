#!/usr/bin/env node
// Bundle budget gate (packet-02, first-paint proof) + purchase-exclusion proof.
// Run AFTER `vite build`: node scripts/thin/check-bundle-budget.mjs
//
// 1. Budget on RAW JS bytes (parse cost tracks uncompressed size). Re-based
//    2026-07-19 (Liam's call, packet-09): the scaffold-era ceiling (1.1 MB, set
//    at ~901 KB) predated the 6 converted screens; the full app builds at
//    ~1174 KB (gzip ~332 KB) — legitimate volume, not bloat. New ceiling =
//    current +~10% headroom; the tripwire is for accidental bloat (a stray
//    dependency), the real first-paint proof is the on-device p50 ≤ 300 ms
//    stop-rule. Code-splitting stays a post-ship option if device numbers
//    degrade.
// 2. Forbidden-content grep (Fable review round 1, codifying the manual A/B
//    proof): purchase-surface code must NEVER enter the bundle (§1.5). Component
//    identifiers minify away in prod, so each excluded file is ALSO tracked by a
//    distinctive string literal (translation key/namespace) that survives
//    minification. Any hit fails the gate.
//    Refined 2026-08-11 (Ruling B): the thin bundle now ships a real lazy
//    translation chunk (messages/en.json, boot-frozen locale). A few of the
//    tracked literals are ENGLISH PROSE COPY, not code identifiers or i18n
//    key namespaces — they can legitimately appear inside a translation blob
//    in any language ("Your last charge failed" is real billing copy that
//    belongs in en.json once translated, same as ja.json already carries the
//    Japanese equivalent). Scanning a translation-only chunk for prose would
//    fail the gate on the translation doing its job, not a leak. So the prose
//    markers are scoped OFF chunks whose build-manifest provenance is
//    exclusively messages/*.json; every identifier and dotted i18n-namespace
//    marker (code, never translation-JSON content) still scans EVERY chunk —
//    those catch the actual purchase-surface leak this gate exists for.
//    Provenance comes from the vite build manifest (thin/vite.config.ts sets
//    build.manifest: true), never a filename guess.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, resolve } from 'node:path'

const DIST = 'thin/dist/assets'
const MANIFEST = 'thin/dist/.vite/manifest.json'
// 1.5 MB set-and-forget (Liam 7/19, after the auth integration landed at
// 1269.0 vs the 1_300_000 ceiling — 0.5 KB margin). Deliberately roomy: this
// number is only a bloat tripwire; the §1.5 purchase-marker scan below and the
// on-device first-paint stop-rule (packet-09) are the gates that matter and
// neither depends on it.
// Raised 2026-07-21 at packet 12 §B-3 S2 — the live 店舗 tab ships
// StoresSection + StoreFormDialog (+12.6 KB genuine section code,
// duplication-checked) against 6.2 KB of remaining headroom; still only a
// tripwire — the purchase-marker scan stays the real gate.
// Raised 2026-07-22 at packet 12 §B-3 S4b — the スタッフ tab goes live
// (StaffSection + StaffForm/PinSetup/VoiceEnrollmentDialog/
// InviteStaffDialog now ship), measured at 1584.7 KB raw against the prior
// 1562.5 KB ceiling. Still a NON-LOAD-BEARING size tripwire, not the real
// gate — the purchase-exclusion marker scan below (0/13) is what actually
// blocks a leak (Liam's 2026-07-19 ruling).
// Raised 2026-07-23 at packet 23 — /data-export goes live (DataExportView +
// its 9 section components, never bundled before today), measured at
// 1642.9 KB raw against the prior 1611.3 KB ceiling. Genuine new-screen
// volume (icons + column/filter metadata for a whole export config UI), not
// bloat — same class as every prior raise on this line.
// Raised 2026-07-27 at the booking-audit PR (#628) — 監査ログ viewer gains
// booking burn-outcome/changed-code sub-lines + the booking.* ja/en action
// labels, measured at 1670.5 KB raw against the prior 1669.9 KB ceiling
// (over by 0.6 KB). Genuine feature strings, not bloat — same class as
// every prior raise; the purchase-marker scan below stays the real gate.
// Raised 2026-07-29 at the 詳細記録-pencil PR (#644) — the summary edit
// sheet ships (SummaryEditSheet + card pencil wiring + facade port +
// summaryEdit/summary_edit ja/en strings), measured at 1679.9 KB raw
// against the prior 1679.7 KB ceiling (over by 0.2 KB). Genuine
// new-feature volume, not bloat — same class as every prior raise; the
// purchase-marker scan below stays the real gate.
// Raised 2026-08-02 at the presentation-mode PR (#669) — the customer-facing
// fullscreen photo presentation ships (PhotoPresentationOverlay + interlock
// wiring + present* ja/en strings), measured at 1690.8 KB raw against the
// prior 1689.5 KB ceiling (over by 1.3 KB). Genuine new-feature volume, not
// bloat — same class as every prior raise; the purchase-marker scan below
// stays the real gate. (A lazy-chunk split was tried first and REVERTED: the
// gate correctly counts total thin JS, so splitting only added overhead.)
// Raised 2026-08-09 (11th) at the full merge-queue convergence — the complete
// stack (#670, #686, #679/#680/#682 resolutions, #681, #683–#685, this branch)
// measures 1,753,807 B ground-truth (fresh deterministic build of the final
// tip, confirmed reproducible across two clean builds; the earlier ≈1748.6 KB
// figure projected the photo stack only — the six non-photo PRs' bytes were
// outside it). Next-round-thousand (1_754_000) would leave 193 B headroom —
// the 8/8 razor-fail (1692.4 > 1692.4) says never do that; ~1.3 KB is the floor.
// Raised 2026-08-10 (12th) at the revisit-outcome PR (PR-A) — the 結果 dialog
// gains the 4th 「既存のお客様（通常ご来店）」 card (amber tone entry, RotateCw
// icon, gate + guard sub-copy) and its ja/en strings, plus the fix round's
// read-shape degrade (unknown-outcome fallback chip) and selection guard —
// measured at 1,755,330 B ground-truth (deterministic: identical across two
// clean builds from an emptied thin/dist) against the prior 1_755_000 ceiling,
// over by 330 B. Genuine new-feature volume, not bloat; the purchase-marker
// scan below stays the real gate. Ceiling set 1,150 B above the measurement:
// deliberately NOT a round thousand (the 8/8 razor-fail was a 193 B margin;
// ~1 KB is the floor).
// Raised 2026-08-11 (13th) — thin forgot-password sub-view (login-screen
// request half; web confirm page finishes) — genuine new-feature volume, not
// bloat; measured 1,757,951.
// Raised 2026-08-11 (14th) at Ruling B — the en.json lazy locale chunk lands
// (boot-frozen EN/JP toggle on the app login screen), +115,977 B and the
// first non-ja content the thin bundle has ever shipped. Measured
// 1,874,562 B ground-truth at the final tip 2557844b (fresh deterministic
// build, confirmed reproducible across two clean builds) against the prior
// 1_759_000 ceiling (over by 115,562 B) — corrects the in-flight
// 1,874,658 B / ad219c50 reading this comment cited before the tip settled.
// Genuine translation-chunk volume, not bloat — same class as every prior
// raise; the purchase-marker scan below (refined the same PR to exempt
// translation-only chunks from the prose markers) stays the real gate.
// Ceiling set 1,438 B above the measurement, back on the ~1.3 KB headroom
// convention (the 8/8 razor-fail was a 193 B margin; ~1.3 KB is the floor).
// Same-line conflict resolver keeps THIS number (largest wins; raises never
// shrink on a merge, only on a deliberate re-base measurement).
// Raised 2026-08-12 (15th) — provisional margin for the menu-catalog lane's
// PR-0 (03_PLAN.md §8), fork A (menu editing lives on SYNQED Business /
// computer only; the phone Karute app keeps the booking picker, no editor).
// +14,336 B (14 KB), sized ABOVE the richer stores i18n comparable
// (7,355 B ja+en, measured) because the menus settings tab carries more
// copy — 8 fields, helpers, two confirms, empty + web-only states — plus
// the booking picker's keys and code. The string comparables are already
// ja+en totals, never doubled. Provisional, not a measured overage (no PR
// in the lane has landed yet): the script's own rule is that the ceiling
// sits above a measurement and raises never shrink, so oversizing here is
// free (unused slack is harmless) while undersizing costs a second
// classifier-blocked-file round-trip. Each PR's own budget checkpoint
// (PR-1..PR-4b) is the measured truth under this ceiling.
// Raised 2026-08-17 — recording-integrity Phase A, lock-caveat truth fix
// (Liam field correction: §8.5's "locking suspends capture" claim was FALSE
// for the shipped shells — ios/App/App/Info.plist declares UIBackgroundModes:
// [audio], so a locked phone does NOT suspend capture; settings.
// autostartLockCaveat corrected to say so). Supersedes the same-day A4 fix
// round 2 figure (1,891,644 B / tip e8e15453) with this round's measured
// tip, per this script's own rule that raises never shrink and the LATEST
// measured number on a landed PR wins.
// MEASURED, not provisional: PR A4 (自動録音 per-store toggle) with the
// lock-caveat copy fix applied, measures 1,891,545 B at final tip
// 736ef10da16a28477acbacb278817d0680d5059e against the prior 1,890,336 B
// ceiling — 1,209 B over. A4's own cost is +3,374 B over origin/main
// b195998e (1,888,171 B) — 99 B LESS than fix round 2's 1,891,644 B
// measurement, because the corrected caveat ("画面をロックしても録音は継続
// します。" / "Recording continues even when the screen is locked.") is
// shorter in both locales than the disproven string it replaced.
// +12,288 B (12 KB) of provisional margin ABOVE that measurement, carried
// forward unchanged from the round-2 raise, for the two Phase-A PRs that
// still carry UI: A5b (the acknowledgement flow) and A7 (the auto-start
// countdown + its stop/cancel copy). Sized on the same oversize-is-free rule
// as every prior raise: unused slack is harmless, an undersized ceiling
// costs another classifier-blocked round-trip.
// Raised 2026-08-19 (16th) at the 顧客ピッカー v2 PR (#726) — 今日の予約一覧
// から開く顧客選択ダイアログ v2 (dialog v2 + the blind-round B-1〜B-9 fixes:
// deferred loading, a11y, today badge + the B-8 reset pin) plus this PR's
// search-row keyboard-navigation repair, measured at 1,909,137 B ground-truth
// at final tip 174c5b20 (deterministic: identical across two clean builds
// from an emptied thin/dist) against the prior 1,903,833 B ceiling — over by
// 5,304 B. Against origin/main (CI-measured at merge-base f54d05a2: 1851.0 KB
// raw, ~8.2 KB of headroom under the prior ceiling), this PR's own
// contribution is ~13.7 KB — genuine new-dialog + fix-round volume, not
// bloat; the purchase-marker scan below stays the real gate. Ceiling set
// 8,192 B above the measurement, back on the low-headroom convention (the
// 8/8 razor-fail was a 193 B margin; ~1.3 KB is the floor) rather than the
// two most recent entries' provisional multi-PR margins.
// Raised 2026-08-21 (17th) at the 復元バナー PR (PR-B1) — 保存されなかった
// カルテの復元バナー: the two amber recovery strips replaced by one
// informative save-only card, the day-restricted 保存先 re-point picker
// (RecoveryBanner + the picker's repoint variant), the in-flow 結果 popup with
// its per-leg money settlement, and the take-store outcome stamp — plus the
// two blind rounds and the delta-verify round on top of them. Measured at
// 1,929,092 B ground-truth at final tip (deterministic: identical across two
// clean builds from an emptied thin/dist) against the prior 1,917,329 B
// ceiling — over by 11,763 B. Ceiling set 5,308 B above the measurement, the
// same low-headroom convention as the #726 raise above: unused slack is
// harmless, an undersized ceiling costs another round-trip.
// Raised 2026-08-24 (lane date) at Build C — 録音中の名前表示: the customer's
// name on the live indicators (ninja-dot popover nameline + the bottom mic
// button's under-clock label), the NEW-2 chrome refetch when a pipeline run
// ends, the ⚖14 merged green-notice line, and the picker pinned-card
// bookedToday flag. Measured 1,935,376 B ground-truth at tip 9966d0ae
// (deterministic: identical across two clean builds from an emptied
// thin/dist) against the prior 1,934,400 B ceiling — over by 976 B (diff
// cost +1,536 B). Ceiling set 5,024 B above the measurement, same
// low-headroom convention as the two raises above.
// Raised 2026-08-25 (lane date) at Build F1/F2 — 録音履歴 (recordings inbox):
// one honest row per recording session on the record page (five states,
// probe-failure honesty, supersession poll), 要対応 badges on the mic FAB and
// sidebar, multi-take recovery, take TTL 7 days, and the tolerant phone-side
// job-status parse. Measured 1,950,482 B ground-truth at tip f894bd03
// (deterministic: identical across two clean builds from an emptied
// thin/dist) against the prior 1,940,400 B ceiling — over by 10,082 B
// (feature cost +13,123 B vs the c9d66c93 base). Ceiling set 5,118 B above
// the measurement, same low-headroom convention as the three raises above.
// Raised 2026-09-02 (lane date) at F4 — 顧客を変更 (karute customer reassign,
// end-to-end): the capability + i18n pair, the store-scoped picker dialog
// and confirm panel (money/photo honesty disclosure), and the phone facade
// port twin (facadeReassignKaruteCustomer + facadeListReassignCustomerOptions).
// Measured 1,964,392 B ground-truth at tip 4a9ee3f4 (deterministic: identical
// across two clean builds from an emptied thin/dist) against the prior
// 1,955,600 B ceiling — over by 8,792 B. Ceiling set 4,608 B above the
// measurement, same low-headroom convention as the four raises above.
// 2026-08-25: raised for PR #776 検索リビール (~2KB real feature weight), owner-approved.
// 2026-08-25: raised again for PR #779 PR-2a — CI measured 1929.7 KB against
// the 1928.7 KB ceiling. Report-only per the owner ruling of the same day:
// bundle raises are raised and reported, never gated. The headroom also covers
// the upcoming 月ジャンプ work.
// Raised 2026-08-26 at P5-A fix round 1 — 破棄の記録 (packet A-6) plus the
// written-reason gate's own fixes. Ground truth from an EMPTIED thin/dist,
// deterministic across two clean builds: base ce62545b = 1,988,520 B, tip
// = 1,992,218 B, feature cost +3,698 B. Note the prior ceiling had only
// 1,480 B of headroom left at that base, so it was already exhausted before
// this work — the overage is 2,218 B, not a 2 KB regression from nothing.
// The weight is honest feature volume: a new settings tab (label, description
// and its 11-key section block) in BOTH locales, the tab's icon and TABS
// entry, and the fix round's recorder/dialog code. The manager SECTION itself
// is excluded from the bundle (PENDING_SECTION_FILES) and its tab is 準備中 on
// thin, so none of the screen's own code ships here. Ceiling set 4,782 B above
// the measurement, same low-headroom convention as the five raises above.
// RE-MEASURED 2026-08-30, same emptied-thin/dist method, deterministic across
// two clean builds: the merged tip is 1,993,592 B raw against this 1,997,000 B
// ceiling, and the polish round on top of it is 1,994,051 B (+459 B: the
// recorder's in-flight mint guard and one i18n key in both locales). Real
// headroom is therefore 2,949 B — not the 4,782 B the raise above recorded,
// which was taken at the PRE-merge tip and is kept only as its history.
// Raised 2026-08-31 at packet P5-A2 (A2-2, the words behind a reasoned
// discard). Measured with the same emptied-thin/dist method, at tip 4833a77e:
// 1,996,004 B before (the script's own 1949.2 KB line) → 1,999,108 B after,
// +3,104 B. Honest feature volume, and none of it is the manager screen: the
// 破棄の記録 section stays excluded (PENDING_SECTION_FILES) and its A2-4
// transcript view ships nowhere near this bundle. What DOES land is the record
// page's own share — the discard-transcript register in take-store, the
// client persist module, the recorder/review arm wiring, and the two new
// i18n key blocks in both locales.
// The phone cannot USE any of it this round (viteRecordingPort's
// supportsDiscardTranscript is false — there is no facade route yet), which is
// exactly what the queue item 2 facade work would turn on; the code is shared
// with the web arm, so it is bundled either way.
// Ceiling set 3,892 B above the measurement, same low-headroom convention as
// the raises above.
// Raised 2026-08-31 at the phone-facade packet — 設定→破棄の記録 goes LIVE on
// the phone: the manager section's two reads gained facade routes + port twins,
// so DiscardReasonsSection leaves PENDING_SECTION_FILES and finally ships in
// this bundle (the section itself; its i18n block — 20 keys in both locales
// today, not the 11 an earlier entry above recorded: it grew with the A2-4
// transcript states — was already here either way).
// Measured with the emptied-thin/dist method, deterministic across two clean
// builds on BOTH sides: base 5635ae08 = 1,999,357 B, tip = 2,004,832 B,
// feature cost +5,475 B. The prior 2,003,000 ceiling had 3,643 B left at that
// base, so the overage is 1,832 B. Report-only per ⚖ 8/25 describes the RAISE
// and only the raise: a ceiling a real feature has outgrown gets raised and
// reported here, never held for an approval round. The SCRIPT still gates —
// it runs in CI (.github/workflows/ci.yml) and exits non-zero against whatever
// ceiling stands below, which is the whole point of writing one down.
//
// FILED RIDER EXECUTED HERE: this entry records no "ceiling set N B above the
// measurement" figure, and later entries should not either. That number was
// hand-maintained and went stale on the very next commit — the 8/30
// RE-MEASURED block above exists only to correct one of them. Headroom is
// whatever `node scripts/thin/check-bundle-budget.mjs` prints against a fresh
// build TODAY; the numbers worth writing down are the ones a raise actually
// measured. Prior entries keep theirs as history.
// Raised 2026-08-31 at the 破棄の記録 redesign — the manager screen gains the
// RECORDING behind each discard (customer, session time, length, store) and a
// bounded transcript panel with a sticky header and 5-minute markers. The
// section is a rebuild rather than an edit, and its i18n block grew by 15 keys
// in BOTH locales (ja rides the main chunk, en its own) — the data-layer joins
// themselves cost the phone nothing, being server-side and port-substituted.
// Measured with the emptied-thin/dist method, byte-identical across two clean
// builds on BOTH sides: base e987ef47 = 2,005,223 B, tip e68fc0a6 =
// 2,014,405 B, feature cost +9,182 B. The prior 2,009,000 ceiling had 3,777 B
// left at that base, so the overage is 5,405 B. Report-only per ⚖ 8/25: a
// ceiling a real feature has outgrown gets raised and reported, never held for
// an approval round. The SCRIPT still gates — it runs in CI and exits non-zero
// against whatever ceiling stands below.
// RE-BASED 2026-09-02 at PHONEWIRE-3, and this one is a MEASUREMENT-METHOD
// correction, not a feature raise. Bake 21 (evidence/bake21-20260902) found the
// gate FAILING on the very bundle it shipped: 2,019,183 B raw against the
// 2,019,000 ceiling, over by 183 B — while CI on the identical commit was
// green.
//
// Why both were true. CI (.github/workflows/ci.yml) builds this bundle with
// SHORT DUMMY env — VITE_FACADE_URL https://ci-dummy.invalid,
// VITE_SUPABASE_URL https://test-dummy.supabase.co, VITE_SUPABASE_ANON_KEY
// dummy-not-a-key — and passes no VITE_BUILD_COMMIT / VITE_BUILD_NUMBER. Vite
// INLINES those values as string literals, so a release build (a real facade
// URL, a real anon JWT, a real commit + build number) is strictly bigger. The
// CI step's own comment, "the baked values don't affect either", is wrong about
// bytes. Measured on base f7c1b064, same script, same emptied thin/dist:
//
//     release-way   2,019,183 B   (reproduces bake 21 byte-for-byte, per chunk)
//     CI-way        2,018,928 B
//     CI under-reads by               255 B
//
// The release-way figure was reproduced here WITHOUT copying any real
// credential: only the byte LENGTHS of the release env values were matched
// (24 / 40 / 208) with obvious placeholders. Vite inlines them as plain JSON
// string literals with nothing to escape, so equal length ⇒ equal bytes — and
// the proof is that all three chunks came out at exactly bake 21's sizes
// (en 129,609 · index 952,492 · vendor 937,082 = 2,019,183).
//
// This round's tip measures 2,018,785 B the release way — 398 B SMALLER than
// its base, because tab-calm-2 deletes more class text than the offline-catch
// and the un-suppressed create button add. So there is no feature overage to
// absorb; the ceiling moves because the number it was compared against was the
// wrong number. Set above the LARGER of the two honest release-way readings
// (the base's 2,019,183 — that is what is on phones today), with ~4.8 KB of
// headroom, the same low-headroom convention as the 2026-08-19/21/24/25 raises
// and well clear of the 8/8 razor-fail's 193 B margin.
//
// Report-only per ⚖ 8/25 describes the RAISE. The SCRIPT still gates: it runs
// in CI and exits non-zero against whatever ceiling stands below.
//
// And CI now measures the RIGHT number. The same round gave the workflow's
// bundle-gate step placeholder env of release LENGTH (24 / 40 / 208, plus the
// two build stamps at 8 / 2) — obvious 'x'-padded fakes, never a real value —
// so its build reproduces the release-way measurement byte-for-byte. Verified
// 2026-09-02 at this tip: workflow env alone, no thin/.env, 2,018,785 B, equal
// to the release-way figure above. CI's printed figure is no longer light;
// treat it as the real one.
// RAISED 2026-09-04 for the capture pipeline's client half (PR3 — secure-at-
// stop + session-first + born-reserved), ⚖ decision D: 2,024,000 → 2,032,000.
// This is a FEATURE raise, not a method correction — the method is unchanged
// from the 2026-09-02 entry above (release-length placeholder env, emptied
// thin/dist).
//
// What is in the phone for the bytes: the audio is now safe the moment 停止 is
// tapped rather than at 録音を使用 — the take is finalized against a key the
// server composes, its row is minted through the one session door when the
// start-mint never landed, every refusal comes back NAMED so a terminal one is
// never re-uploaded, and this round makes the row born reserved (the start-mint
// carries the take + container, with one step back for a server that predates
// the pair).
//
// Measured at this round's tip, the release way: en 129,756 · index 958,227 ·
// vendor 937,082 = 2,025,065 B — 1,065 B over the 2,024,000 ceiling, which is
// the breach this raise answers. The last release-way figure recorded on main
// is 2,018,785 B (965500a4, 2026-09-02), so the whole PR3 stack costs the phone
// +6,280 B. That raise left 6,935 B of headroom at the time it was written; PR4
// then spent it — see the entry below for where the number stands now.
//
// RAISED 2026-09-04 for PR4's never-delete doors (rounds 2–5), ⚖ 8/25:
// 2,032,000 → 2,040,000. A FEATURE raise, not a method correction — the method
// is unchanged from the 2026-09-02 entry above (release-length placeholder env,
// emptied thin/dist).
//
// What is in the phone for the bytes: a discarded recording's audio is no
// longer deleted, so what used to be a delete is now a decision — the settle
// reads the take and keeps one the server never received, every discard arm
// MARKS the take so a thrown-away session is never re-offered, a take that can
// never be sealed still gives up its words off a staged copy that is staged
// once, and (this round) the discard's word-collection waits for the stop's own
// upload the way the two pipeline readers already do, so the FIRST kick is the
// one that lands instead of the words waiting for a mount that may never come.
//
// Measured at this round's tip, the CI/release way: en 129,868 · index 965,152 ·
// vendor 937,082 = 2,032,102 B — 102 B over the 2,032,000 ceiling, which is the
// breach this raise answers. The whole PR4 stack costs the phone +7,037 B over
// the 2,025,065 B PR3 tip above. The new ceiling leaves 7,898 B of headroom.
// Measured again at the merged tip dc907339 (PR4 round 7 added the bound
// staging): en 129,868 · index 965,870 · vendor 937,082 = 2,032,820 B → 7,180 B
// of headroom.
//
// SLICE FIVE spends most of what that left, and the numbers belong here rather
// than only in a report: at 5a's final tip 8c3d57c4b (launch drain, staged
// identity, the release rule) 2,035,437 B → 4,563 B of headroom; at 5b's fix
// round 1 tip — the segment pump live, with this round's fresh run, its stop
// budget and the keyed segment read — en 129,868 · index 972,276 ·
// vendor 937,082 = 2,039,226 B → 774 B. Under the ceiling, and the next
// thin-side slice has almost nothing left: the number below is untouched, and
// a raise is Fable's call with Liam told afterwards. Fix round 2 (the stop's
// backoff bypass, the adaptive batch, the joined handoff) adds 146 B on top:
// en 129,868 · index 972,422 · vendor 937,082 = 2,039,372 B → 628 B.
//
// Report-only per ⚖ 8/25 describes the RAISE, and it is REVERSIBLE: Liam vetoes
// this line with one revert. The SCRIPT still gates — it runs in CI and exits
// non-zero against whatever ceiling stands here.
const BUDGET_BYTES = 2_040_000

let dir
try {
  dir = readdirSync(DIST)
} catch {
  console.error(`✗ no build output at ${DIST} — run \`vite build --config thin/vite.config.ts\` first`)
  process.exit(1)
}

const jsFiles = dir.filter((f) => f.endsWith('.js'))
let raw = 0
let gz = 0
for (const f of jsFiles) {
  const buf = readFileSync(join(DIST, f))
  raw += statSync(join(DIST, f)).size
  gz += gzipSync(buf).length
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`thin JS: ${kb(raw)} raw / ${kb(gz)} gzip across ${jsFiles.length} chunk(s)`)
// Budget verdict is deferred to the end: exiting here used to skip the
// purchase-exclusion check entirely, so a budget breach masked a §1.5 leak.
const overBudget = raw > BUDGET_BYTES
if (overBudget) {
  console.error(`✗ over budget: ${kb(raw)} > ${kb(BUDGET_BYTES)} — code-split or trim before merge`)
} else {
  console.log(`✓ within budget (${kb(BUDGET_BYTES)})`)
}

// ── Chunk provenance (Ruling B) ──
// Which output files are composed SOLELY of messages/*.json source modules,
// per the vite build manifest — never a filename guess. A dynamically
// imported JSON module with no imports of its own (messages/en.json today)
// always becomes its own isolated chunk, so every manifest entry mapping to
// that output file has a messages/*.json `src`. If anything else is ever
// folded into that chunk, this drops to false and the file goes back to full
// scanning — the exemption only ever narrows, never widens, by accident.
if (!existsSync(MANIFEST)) {
  console.error(
    `✗ no build manifest at ${MANIFEST} — chunk provenance can't be proven. ` +
      'thin/vite.config.ts must build with `manifest: true` (no filename-pattern guessing here).',
  )
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const fileToSrcs = new Map()
for (const entry of Object.values(manifest)) {
  if (!entry.file) continue
  const srcs = fileToSrcs.get(entry.file) ?? []
  srcs.push(entry.src)
  fileToSrcs.set(entry.file, srcs)
}
// Anchored to the repo-root messages/ catalog specifically (not any directory
// literally named "messages"): manifest `src` values are relative to Vite's
// root (thin/), so resolve against that before comparing — a third-party
// package's own messages/ folder resolves elsewhere and correctly fails this.
const REPO_MESSAGES_DIR = resolve('messages')
const isMessagesSrc = (src) =>
  typeof src === 'string' &&
  src.endsWith('.json') &&
  dirname(resolve('thin', src)) === REPO_MESSAGES_DIR
function isMessageOnlyChunk(file) {
  const srcs = fileToSrcs.get(`assets/${file}`)
  return !!srcs && srcs.length > 0 && srcs.every(isMessagesSrc)
}

// ── Purchase-exclusion proof (payments canon §1.5) ──
// Identifiers (pre-minification insurance) + one surviving string literal per
// excluded file. Keep in sync with PURCHASE_FILES in thin/vite.config.ts.
// Literal choice matters: bare t-keys ('staffUnlimited') exist as KEYS in the
// bundled messages/ja.json → guaranteed false positive. DOTTED useTranslations
// namespaces never appear in the nested JSON, only in component code — each one
// below is verified unique to its excluded file (StoresSection shares
// 'settings.stores.plan', so PlanComparisonDialog uses its unique className).
// These scan EVERY chunk, translation chunks included — none of them are
// prose, so none can legitimately appear as a messages/*.json value.
const FORBIDDEN_ALL_CHUNKS = [
  // identifiers
  'PlanComparisonGrid',
  'CancelConfirmDialog',
  'PaymentUpdateDialog',
  'AddStoreSubscriptionDialog',
  'PlanComparisonDialog',
  // minification-surviving literals, one per excluded file
  'settings.subscription.plans', // PlanComparisonGrid namespace
  'settings.subscription.cancel', // CancelConfirmDialog namespace
  'settings.subscription.paymentUpdate', // PaymentUpdateDialog namespace
  'settings.stores.addStoreSubscription', // AddStoreSubscriptionDialog namespace
  'sm:max-w-5xl', // PlanComparisonDialog className (verified unique to that file in src/ + thin/)
  // @synqed-kk/ui vendor copies (identifier = displayName literal, survives
  // minification; plus one copy literal each in case a package build drops it)
  'SubscriptionSummaryCard',
]
// Prose copy strings (Ruling B): real English sentences a translation JSON
// can legitimately carry once localized. Skipped on chunks whose sole
// manifest provenance is messages/*.json; scanned everywhere else.
const FORBIDDEN_PROSE = [
  "Your last charge failed", // subscription-summary-card DEFAULT_COPY
  'Downgrade to Free', // plan-comparison-grid DEFAULT_COPY (Greptile 4/5 backstop)
]
const TOTAL_MARKERS = FORBIDDEN_ALL_CHUNKS.length + FORBIDDEN_PROSE.length // 13, unchanged by Ruling B
const textFiles = dir.filter((f) => f.endsWith('.js') || f.endsWith('.css'))
const hits = []
for (const f of textFiles) {
  const text = readFileSync(join(DIST, f), 'utf8')
  const markers = isMessageOnlyChunk(f)
    ? FORBIDDEN_ALL_CHUNKS
    : [...FORBIDDEN_ALL_CHUNKS, ...FORBIDDEN_PROSE]
  for (const needle of markers) {
    if (text.includes(needle)) hits.push(`${f}: contains "${needle}"`)
  }
}
if (hits.length > 0) {
  console.error('✗ purchase-surface code leaked into the thin bundle (§1.5 payments canon):')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}
console.log(`✓ purchase exclusion: 0/${TOTAL_MARKERS} forbidden markers across ${textFiles.length} asset(s)`)
if (overBudget) process.exit(1)
