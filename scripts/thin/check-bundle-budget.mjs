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
// a raise is Fable's call with Liam told afterwards. Fix rounds 2–4 add 225 B
// on top of that — the stop's backoff bypass and the catch-up's adaptive batch
// (round 2), the fresh follow-up that WAITS for everything in flight and then
// runs one attempt of its own rather than joining (round 3), and the phone's
// segment mint answering its own door timeout as `upstream` so that belt can
// fire at all (round 4): en 129,868 · index 972,501 · vendor 937,082 =
// 2,039,451 B → 549 B of headroom.
//
// RAISED 2026-09-06 for THE PLAY BUTTON (build 23 slice ①) — one entry for the
// whole slice, ⚖ 8/25 + 9/4: 2,040,000 → 2,049,700. The method is unchanged
// from the 2026-09-02 entry above (release-length placeholder env, emptied
// thin/dist). Base 75ac94083 measured 2,039,663 B; this tip measures
// en 130,244 · index 981,158 · vendor 937,743 = 2,049,145 B, so the play button
// costs the phone +9,482 B in total — the feature plus six review rounds, three
// of which were correctness fixes rather than new surface. What the bytes
// bought: a staffer hears a session again from inside the same 文字起こし card
// the words live in (play/pause, ±15 s, 標準/1.5/2倍, a scrub bar) over a
// signed url the server mints on the FIRST tap and only after proving, by the
// same rule that governs the words, that this viewer may hear this take and
// that the bytes are really in the bucket; recording always wins, across the
// mint and the re-mint; one tap is one mint and one audit row; the element's own
// events drive the button so an outside pause cannot leave it lying; the chip
// states the rate the engine is actually running; the controls carry 44 pt hit
// areas without changing the look; the scrub commits on release, keeps the thumb
// under the finger while the audio plays, leaves vertical panning to the page,
// and an assistive adjust moves the audio too; an unknown total says –:––
// rather than claiming 0:00.
//
// The new ceiling leaves 555 B of headroom — the same margin the slice-five
// entry above left, and left for the same reason: the next thing to land here
// should have to come back and say what it is. The previous number for this
// slice left 55 B, which is not headroom, and correcting that is this entry's
// other job.
//
// RAISED 2026-09-06 for THE NIGHTLY RESCUE (build 23 slice ③) — one entry for
// the whole slice, ⚖ 8/25 + 9/4: 2,049,700 → 2,054,000. The method is unchanged
// from the 2026-09-02 entry above (release-length placeholder env, emptied
// thin/dist).
//
// What is in the phone for the bytes: 録音履歴 stops guessing about audio it
// cannot see. A recording whose device walked out of signal used to sit there
// saying 「この録音は保存されませんでした」 for as long as anyone looked at it —
// while the server was in fact holding most of it, and while a nightly job was
// on its way to rebuild the rest. Now the row says which of the two is true:
// 処理中「サーバーに音声が途中まで届いています（数日以内に保存できるように
// なります）」 while only the pieces are up there, and 復元可能「サーバーに音声が
// 残っています（未保存・途中までの場合があります）」 once the whole object is —
// with the same solid 保存する the staffer already knows, going through a new
// server-side door that derives the audio's location from the recording row
// itself (nothing on the wire names a file, ever), proves the bytes are really
// in the bucket — at the take's own key or at the nightly job's rescue of it —
// and then runs the ordinary transcription the phone would have run. A device
// that still holds the recording keeps winning: the complete copy is always the
// one offered, on the phone and in the bucket.
//
// Measured ON THE PRE-REBASE BASE (3ee1cdf8d), the CI/release way, after fix
// round 3 — kept for the history of where the bytes went, NOT as this tip's
// number; the REBASED block at the bottom is the live measurement:
// en 130,422 · index 984,398 · vendor 937,743 = 2,052,563 B. Every figure below
// came from a cold `rm -rf thin/dist` build under the env extracted from
// ci.yml's own gate step by
// evidence/assembler-20260906/extract-ci-bundle-env.py (no value retyped by
// hand), and each was reproduced twice:
//   · base 3ee1cdf8d on main — en 130,251 · index 981,263 · vendor 937,743
//     = 2,049,257 B
//   · fix round 1 (19db4c223) — en 130,422 · index 984,147 · vendor 937,743
//     = 2,052,312 B
//   · fix round 2 (c9faaee4e) — en 130,422 · index 984,321 · vendor 937,743
//     = 2,052,486 B
//   · fix round 3 (the last pre-rebase tip) — 2,052,563 B
// So on that base the PR cost the phone +3,306 B, of which fix round 3 is +77 B.
//
// ⚖ AND THE ENVIRONMENT IS PART OF THE MEASUREMENT (fix round 3, R6). These are
// the CI RECIPE run in ONE environment — this repo's own node_modules at this
// tip's lockfile. A build from another dependency tree can emit a different
// index chunk hash and land a few bytes apart without anything here moving: at
// 19db4c223 this environment emits index-C3F9hjgF.js at 984,147 B and a review
// worktree whose node_modules were symlinked from elsewhere emitted
// index-CIqb6iSh.js at 984,151 B. Four bytes, a different chunk, no defect —
// and re-measuring rather than re-typing is the only way to tell. So do not
// "correct" a figure here from another machine's build; re-run the recipe.
//
// Where those bytes went. The build itself was +2,080 B (2,051,337 B at the
// pre-review tip): two message strings in both catalogs, the fold's two new
// branches, the handler's server-save path with its own picker mount, and the
// phone port's entry for the new door. Fix round 1 added +975 B, and every one
// of them is a refusal the first cut did not make — the consent gate before the
// door, the discard guard the take flow already honoured, the in-flight latch
// that survives the reload, the row's button greying out while it does, the
// failed-job row keeping its 再試行, and the new door's own refusal codes
// reaching the phone. Fix round 2's +174 B is the same kind of thing, smaller:
// the save's latch moved to the tap and held across the consent round trip, the
// seal re-checked after it, the store handing a mid-flight caller a promise it
// can follow, and the greyed button losing its hover fill. Fix round 3's +77 B
// is three lines of the same: the discard fence refusing a ledger row it cannot
// read, every save arm on the card greying while any one save runs, and the
// seal re-read across the consent grant as well.
//
// The ceiling is sized for the WHOLE slice, not just this PR, because the other
// two land beside it: PR-A (the nightly assembler) adds +119 B of i18n labels
// its own totality gate demands, and PR-B (the store stamp) is server-side but
// for a few lines at the take doors. (The headroom this paragraph forecast was
// read off the PRE-REBASE tip; A and B have since merged, so the real number is
// measured in the REBASED block below and nowhere else.) Whatever is left after
// those three is the next thing's problem, and it should have to come back and
// say what it is.
//
// REBASED 2026-09-07 onto a main that now CARRIES A AND B (14666699b), and the
// ceiling does not move — 2,054,000 stands. Measured the same way, cold, twice,
// byte-identical both runs:
//   · base 14666699b (the merged nightly assembler + store stamp) — en 130,310 ·
//     index 981,323 · vendor 937,743 = 2,049,376 B
//   · the rebase tip (af9c95c24) — en 130,481 · index 984,458 · vendor 937,743
//     = 2,052,682 B
//   · fix round 4 — en 130,481 · index 984,505 · vendor 937,743 = 2,052,729 B
//   · THIS TIP, after fix round 6 — en 130,591 · index 984,821 · vendor 937,743
//     = 2,053,155 B
// So C costs the phone +3,779 B over the merged base, and 2,054,000 leaves
// 845 B of headroom at this tip — the live number, and the only one in this
// file that describes the code as it stands.
// The rebase itself moved two things in opposite directions and they cancelled:
// the door now asks the ONE resolver both PRs share instead of probing the
// pointer itself, and the duration stamp left the door altogether (a rescued
// take's length stays null until the phone that made it comes back and writes
// the real one — ADDENDUM 9.2 H3). A's +119 B of i18n labels are in the base
// above now rather than predicted. B is server-side and costs the phone
// nothing. Fix round 4 is +47 B, all of it in one place the phone can see: the
// port's refusal table now answers all three 403 codes as one terminal
// `forbidden` instead of letting two of them read as "try again". Everything
// else that round touched — the read's probe order and its guard, the door's
// store leg, the docs — is server-side or comment, and weighs nothing here.
// Fix round 6 is +426 B, and every byte of it is a refusal the phone can now
// read: the port's two new terminal arms (`no_audio`, `not_returning` — R3),
// and the pipeline's `discarded` arm with the card branch and the one new
// sentence it renders (R7 — the EN twin is what moves the `en` chunk; `vendor`
// does not move). R1, R2, R4, R5 and R6 are server-side or comment and weigh
// nothing here.
//
// Round-2 audit line-audit (F2) is +257 B over that ceiling — measured cold:
// en 130,918 · index 985,596 · vendor 937,743 = 2,054,257 B. Every byte of it
// is the 監査ログ page the phone can now read more of: the 警告 tile's server
// filter reaching the strip probes, the two 重大な記録 notice lines, and the
// 復元行 の担当 suffix — all three text/logic additions land in the `index`
// chunk (`en` and `vendor` are unmoved from the prior tip). 543 B headroom.
//
// Report-only per ⚖ 8/25 describes the RAISE, and it is REVERSIBLE: Liam vetoes
// this line with one revert. The SCRIPT still gates — it runs in CI and exits
// non-zero against whatever ceiling stands here.
//
// Round-4 Greptile-2 fix (G2/G3): G2 is a NET DELETION — the round-2/3 virtual
// 'warnings' filter, the second critical read, the merge, the 重大な記録 group
// and its two notice lines are gone; a single 重大 chip + criticalTotal replace
// them. CI measured 2007.0 KB raw on tip 9aa6817c2 (≈2,055,168 B) vs 2,054,751 B
// measured locally at that SAME tip — CI runs ≈ +417 B heavier than this
// machine on this branch (fonts/toolchain delta, not code). After G2, rebuilt
// and measured cold on this machine (twice, byte-identical both times):
// en 130,798 · index 985,698 · vendor 937,743 = 2,054,239 B — 512 B LIGHTER
// than the prior local measurement, matching a net deletion. The ceiling is
// set from THIS local number plus the observed CI delta, not the old
// ≤600 B-headroom convention alone: 2,054,239 + 1,000 = 2,055,239 (the
// ≤600 B convention's headroom plus the +417 B CI-vs-local delta measured
// above, rounded up) — enough for CI's own build of the exact same source to
// pass without masking a real regression on a future round.
// PR D2 (this packet, 2026-09-11): the 監査ログ page now ships Liam's own
// titles for the two new automation rows (カルテ未保存, 同じ録音連続文字起こし,
// replacing the earlier auto-worded lines), alongside the rest of D2's page
// work already on this tip — the automation names, three new sub-lines, the
// fold, the recording thread, and the scope line, with their ja/en keys and
// helpers. Measured cold on this machine (twice, byte-identical both times):
// en 131,664 · index 990,328 · vendor 937,743 = 2,059,735 B. The ceiling is
// set from THIS local number plus 1,000 B (the ≤600 B-headroom convention
// plus the +417 B CI-vs-local delta measured above, rounded up):
// 2,059,735 + 1,000 = 2,060,735 — within the 2,060,764 ceiling Liam accepted
// for this round.
//
// Report-only per ⚖ 8/25: this raise is REVERSIBLE, Liam vetoes it with one
// revert. The script still gates — it runs in CI and exits non-zero against
// whatever ceiling stands here.
//
// Raised 2026-09-12 at the discard one-tap fix round (F1–F7, blind-lens
// adjudicated, branch feat/discard-one-tap-below-floor) — the accidental-tap
// one-tap discard plus that round's own repairs: the recorder+banner-only
// predicate (review/pipeline-error keep their dialog fence unconditionally),
// the failure-fallback dialog, the one-tap success toast, and the try/catch
// that now wraps the whole discard body so a thrown server action fails
// closed instead of escaping as a silent unhandled rejection. Measured cold
// on this machine, byte-identical across three separate clean builds: en
// 131,802 · index 991,304 · vendor 937,743 = 2,060,849 B, against a
// merge-base (d5cd18f13) measurement — also twice byte-identical — of
// 2,059,860 B: feature cost +989 B. The ceiling is set from THIS local
// number plus 1,000 B, the same convention as every prior raise above:
// 2,060,849 + 1,000 = 2,061,849.
//
// Report-only per ⚖ 8/25: this raise is REVERSIBLE, Liam vetoes it with one
// revert. The script still gates — it runs in CI and exits non-zero against
// whatever ceiling stands here.
//
// C4 (PKT-GROUP-C, 2026-09-12) — THE MEASUREMENT RECIPE, so the next raise
// (or the next "are we still under budget" check) reproduces the number
// above byte-for-byte instead of guessing:
//   1. `rm -rf thin/dist` (a stale dist can carry a prior build's chunk).
//   2. `vite build --config thin/vite.config.ts`, with EXACTLY the CI job's
//      dummy env (.github/workflows/ci.yml, the "thin bundle budget" step):
//      VITE_SHELL_MODE=local, VITE_FACADE_URL=https://ci-dummy.invalid (24
//      chars), VITE_SUPABASE_URL=https://ci-dummy-xxxxxxxxxxx.supabase.co
//      (40 chars), VITE_SUPABASE_ANON_KEY=not-a-key-<x*198> (208 chars),
//      VITE_BUILD_COMMIT=cidummyx (8 chars), VITE_BUILD_NUMBER=00 (2
//      digits) — the LENGTHS matter (padded to match the real release
//      values' byte length), never the literal values.
//   3. Sum the raw byte size of every `thin/dist/assets/*.js` chunk (this
//      script's own `raw` total, or `stat -f %z` per file) — NOT the
//      gzip figure, and not the KB-rounded console line.
//   4. Run steps 1-3 TWICE from a clean dist; a real raise needs
//      byte-identical results both times before it means anything (content-
//      hashed filenames may differ; the SUM must not).
//   5. Ceiling = that measured sum + a ~1,000 B margin (the convention every
//      raise above this comment already follows) — never a bigger pad "to
//      be safe", and never smaller than the actual feature cost.
//   6. Node version used for the measurement this convention assumes: record
//      it in the raise's own dated comment (the 9/12 raise above did not,
//      and neither builder's local Node differs enough from CI's to matter
//      today — `node --version` at measurement time, going forward).
// Report-only per ⚖ 8/25, same as every entry above: reversible, one revert.
//
// Raised 2026-09-12 at the pack-prompt-total-25 fix round (p5, blind-lens
// adjudicated, branch feat/pack-prompt-total-25) — the p5 card change
// (blind-read finding N5) on TicketPackCard.tsx's 残りわずか hint: the card now runs the
// SAME resolveOutcomeMode total-balance rule the stop dialog already uses
// (otherRemaining computed per row, excluding cancelled packs) instead of
// its own "any newer active pack" check — genuine phone-bundle feature
// bytes, not bloat; the purchase-marker scan stays the real gate and
// remains 0 hits. Measured cold on this machine per the C4 recipe above,
// byte-identical across two separate clean builds (node v24.16.0): en
// 132,012 · index 992,101 · vendor 937,743 = 2,061,856 B, against
// origin/main (db9c58758) — also byte-identical across two clean builds —
// of 132,012 + 991,758 + 937,743 = 2,061,513 B: feature cost +343 B. The
// ceiling is set from THIS local number plus 1,000 B, the same convention
// as every prior raise above: 2,061,856 + 1,000 = 2,062,856.
//
// Report-only per ⚖ 8/25: this raise is REVERSIBLE, Liam vetoes it with one
// revert. The script still gates — it runs in CI and exits non-zero against
// whatever ceiling stands here.
//
// Raised 2026-09-12 at UPDATE 25 GROUP A (five pieces, branch
// feat/inbox-truth-25) — the 録音履歴 inbox now renders a row for a
// session the server never listed (d3), a quiet notice when a run's session
// id never resolved (d2), a refused take's own honest row with a safe
// re-save door (r), the same-day 手書き exit from an empty-transcript
// failure plus the repeated-failure line (c), and the red pill's
// reconciliation with the row's durable truth (b) — five new fields/reasons,
// two new components' worth of copy, and the 手書き door's navigation. Genuine
// phone-bundle feature bytes, not bloat; the purchase-marker scan stays the
// real gate and remains 0/13. Measured cold on this machine per the C4
// recipe above, byte-identical across two separate clean builds (node
// v24.16.0): en 132,508 · index 996,638 · vendor 937,743 = 2,066,889 B,
// against origin/main (0f2f75844) — also byte-identical across two clean
// builds — of 132,012 + 992,100 + 937,743 = 2,061,855 B: feature cost
// +5,034 B. The ceiling is set from THIS local number plus 1,000 B, the same
// convention as every prior raise above: 2,066,889 + 1,000 = 2,067,889.
//
// Report-only per ⚖ 8/25: this raise is REVERSIBLE, Liam vetoes it with one
// revert. The script still gates — it runs in CI and exits non-zero against
// whatever ceiling stands here.
//
// Raised 2026-09-13 at UPDATE 26 session 1 (three pieces, branch
// feat/update-26-owner-fixes) — labels + an actor word + a pack-resolver
// branch for the owner's two core-written 監査ログ rows (Piece 1), the
// sub-line 2-line-clamp/full-text split (Piece 2), and the DTO's pack
// status/source enum widen for CORE-12 (Piece 3): genuine phone-bundle
// feature bytes (new ja/en strings, a new resolver branch, a new render
// branch, a third status arm, a widened zod enum), not bloat; the
// purchase-marker scan stays the real gate and remains 0/13. Measured cold
// on this machine (node v24.16.0) per the C4 recipe above: the FIRST clean
// build of the session measured en 132,753 · index 998,285 · vendor 937,743
// = 2,068,781 B, then TWO FURTHER clean builds landed byte-identical at en
// 132,753 · index 998,286 · vendor 937,743 = 2,068,782 B (the first run's
// index chunk was 1 B lighter — a cold Vite dependency-optimize cache on the
// very first build of the process, not the feature; the two reproducible
// runs are the number this raise uses). Against origin/main — re-fetched
// mid-session and it had moved twice (last to 3af10723a, a Business
// 今日の運営 branch-B connect PR, unrelated to and disjoint from every file
// this PR touches — confirmed via `git show --stat`) — also byte-identical
// across two clean builds at both f02b48683 (this PR's actual merge-base)
// and 3af10723a: en 132,530 · index 997,604 · vendor 937,743 = 2,067,877 B:
// feature cost +905 B. The ceiling is set from THIS local number plus
// 1,000 B, the same convention as every prior raise above:
// 2,068,782 + 1,000 = 2,069,782.
//
// Report-only per ⚖ 8/25: this raise is REVERSIBLE, Liam vetoes it with one
// revert. The script still gates — it runs in CI and exits non-zero against
// whatever ceiling stands here.
//
// Raised 2026-09-13 at the Anthony #901/#905 repairs (R1 — the header's
// discarded-repair string, PKT-ANTHONY-901-905-REPAIRS-2026-09-13.md): two
// new message keys per locale (karute.recordList.statusLineDiscarded /
// statusLineNoMonthDiscarded, ja + en) so the カルテ tab's status line can
// name active+discarded once any record is discarded, without disturbing
// the existing statusLine/statusLineNoMonth strings byte-for-byte (F1 —
// 全件 must not read smaller than 表示中). Genuine phone-bundle copy, not
// bloat; the purchase-marker scan stays the real gate and remains 0/13.
// Measured cold on this machine per the C4 recipe above, byte-identical
// across two separate clean builds (node v24.16.0): en 132,756 · index
// 998,064 · vendor 937,743 = 2,068,563 B, against origin/main
// (3af10723a) — also byte-identical across two clean builds — of
// 132,530 + 997,597 + 937,743 = 2,067,870 B: feature cost +693 B. The
// ceiling is set from THIS local number plus 1,000 B, the same convention
// as every prior raise above: 2,068,563 + 1,000 = 2,069,563.
//
// merged with main (#907) 2026-09-13: measured 133,041 · index 999,001 ·
// vendor 937,743 = 2,069,785 B, byte-identical across two clean builds
// (node v24.16.0, C4 recipe, this merge tip) → ceiling 2,069,785 + 1,000 =
// 2,070,785.
//
// R8 discarded-record door (update-26 PR 3, ⚖ Liam 2026-09-13): measured
// cold on this machine per the C4 recipe, byte-identical across two clean
// builds WITHIN THIS WORKTREE (node v24.16.0): en 133,316 · vendor 937,743 ·
// index 1,001,494 = 2,072,553 B. origin/main
// (0d57b1cca0f7d7dba5b8f7e72f65e3eed11232fa) freshly measured the same way
// in a throwaway worktree, also byte-identical: en 133,041 · vendor 937,743
// · index 999,180 = 2,069,964 B — feature cost +2,589 B (the new i18n
// strings, the facts-block component, the DTO/screen threading). Ceiling =
// THIS measured number + 1,000 B, same convention as every prior raise:
// 2,072,553 + 1,000 = 2,073,553.
//
// (fix round 1 lens, 2026-09-13): a SEPARATE worktree measured the SAME tip
// at en 133,316 · vendor 937,743 · index 1,001,503 = 2,072,562 B — 9 B
// higher on `index` alone, a path-length-shaped hash difference, not a
// content difference. The bundle is byte-reproducible WITHIN one worktree,
// not necessarily across two different worktree paths.
//
// R8 fix round 1 (durationParts deduplication, §6a — one copy removed from
// the bundle instead of two identical five-line copies): measured cold on
// this machine per the C4 recipe, byte-identical across two clean builds
// WITHIN THIS WORKTREE (node v24.16.0): en 133,316 · vendor 937,743 · index
// 1,001,394 = 2,072,453 B — 100 B smaller than the pre-fix-round tip above.
// Ceiling = THIS measured number + 1,000 B: 2,072,453 + 1,000 = 2,073,453.
//
// PR-B fix round 3 (2026-09-14): recording sharing — the share proxy
// (thin/ports/actions.vite.ts), RecordingShareToggle, and six new catalog
// keys ×2 locales (transcript.share/sharing/shared/shareFailed +
// audit.share/unshare). Measured cold on this machine per the C4 recipe,
// byte-identical across two clean builds WITHIN THIS WORKTREE (node
// v24.16.0): plain recipe en 133,627 · index 1,003,257 · vendor 937,743 =
// 2,074,627 B; the CI recipe (same env ci.yml exports — the longer dummy
// stamps inline a few bytes larger) also byte-identical across two builds:
// en 133,627 · index 1,003,309 · vendor 937,743 = 2,074,679 B. origin/main
// (b6f2340819e3766a36dc159c2fbafe9e44522f1a) freshly measured the same way
// in a throwaway worktree, both recipes byte-identical across two builds:
// plain en 133,458 · index 1,001,559 · vendor 937,743 = 2,072,760 B; CI en
// 133,458 · index 1,001,611 · vendor 937,743 = 2,072,812 B — feature cost
// +1,867 B either way (the two recipes agree on the delta; only the
// baseline's env-stamp inlining differs). Ceiling is set from the LARGER of
// the two tip measurements (the CI recipe) plus 1,000 B, same convention as
// every prior raise: 2,074,679 + 1,000 = 2,075,679.
//
// PR-C fix round 1 (2026-09-14): the manager's 共有 list — the 「共有」 pill
// (computed filterKeys), the row chip (SharedChip, both slots), the shared
// list mode (its own row cache + fetch + さらに表示 continuation, shaped like
// 月ジャンプ), and one i18n string (filters.shared) ×2 locales. Measured cold
// on this machine per the C4 recipe, byte-identical across two clean builds
// WITHIN THIS WORKTREE (node v24.16.0): plain recipe en 133,643 · index
// 1,005,770 · vendor 937,743 = 2,077,156 B; the CI recipe (same env ci.yml
// exports — the longer dummy stamps inline a few bytes larger) also
// byte-identical across two builds: en 133,643 · index 1,005,847 · vendor
// 937,743 = 2,077,233 B. The base tip this fix round replants onto
// (9481219d195dc5c651695111d195819304056b11, PR-B's own final tip) freshly
// measured the same way in a throwaway detached worktree (~/karute-budgetbase2,
// removed after), both recipes byte-identical across two builds: plain en
// 133,627 · index 1,003,233 · vendor 937,743 = 2,074,603 B; CI en 133,627 ·
// index 1,003,310 · vendor 937,743 = 2,074,680 B — feature cost +2,553 B
// either way (the two recipes agree on the delta; only the baseline's
// env-stamp inlining differs, same pattern as every prior raise above).
// Ceiling is set from the LARGER of the two tip measurements (the CI recipe)
// plus 1,000 B, same convention as every prior raise:
// 2,077,233 + 1,000 = 2,078,233.
//
// RAISED 2026-09-14 for the 予約 date-jump panel, ⚖ 8/25: 2,078,233 →
// 2,093,051. A FEATURE raise, not a method correction — the method is
// unchanged from the 2026-09-02 entry above (release-length placeholder env,
// emptied thin/dist).
//
// What is in the phone for the bytes: the date chip 「9/14(月) ▾」 now opens
// the app's own calendar instead of calling showPicker() on a hidden native
// date input, which on a phone read to staff as "nothing there". The panel
// carries the 月 view's own cells (density dot + count) for ANY month, so
// 「来月どんな感じ？」 is answered without leaving the day; the month title
// opens the year's twelve chips for a far jump; a month that has not loaded
// shows its day numbers with a status line rather than a grid of zero counts.
// The month reads go through the screen GET this screen already calls
// (view=month + the day wanted) — no new endpoint and no new audit action.
//
// Measured at the FIX-ROUND-2 tip with the CI recipe, byte-identical across
// two clean builds from an emptied thin/dist (node v24.16.0, vite 6.4.3):
// en 133,757 · index 1,020,551 · vendor 937,743 = 2,092,051 B — 13,818 B over
// the ceiling above, which is the breach this raise answers. The base it sits
// on (origin/main c712c4d56c022c9fc5493b3cbca6dd99eae5e56d, measured the same
// way from a `git archive` of that tree in a scratch dir, also byte-identical
// across two clean builds) is en 133,643 · index 1,006,122 · vendor 937,743 =
// 2,077,508 B, so the panel costs the phone +14,543 B: +14,429 B of index
// (the panel, its pure state layer and the ja copy) and +114 B of the en
// chunk (that locale's three new lines). Vendor is untouched — no new
// dependency; the calendar is the MonthGrid the 月 view already ships.
//
// One honest caveat on precision: a blind review of the pre-fix tip measured
// its index chunk ONE byte larger than this recipe does here (2,091,351 vs
// 2,091,350) on another machine. The 1,000 B margin below swallows that
// comfortably; it is recorded so a future reader does not read these figures
// as exact to the byte across environments.
//
// Ceiling = the tip measurement + 1,000 B, same convention as every prior
// raise: 2,092,051 + 1,000 = 2,093,051.
//
// RE-MEASURED 2026-09-15 for the panel's motion repair (#921): 2,093,051 →
// 2,094,602. Same CI recipe as above (release-length placeholder env, emptied
// thin/dist), byte-identical across two clean builds on the final tip:
// en 133,757 · index 1,022,102 · vendor 937,743 = 2,093,602 B. Ceiling =
// 2,093,602 + 1,000.
//
// +1,551 B, all of it in the index chunk (en and vendor are unchanged to the
// byte — no new dependency; the spring is ~160 lines of the app's own code).
// HONEST CAVEAT ON WHAT THOSE BYTES ARE: this tip also merged origin/main
// (40fa7c4bff94b473b4ddba4629e9cc3cccf9fc95) on top of the tree the previous
// entry was measured at, so the +1,551 B covers the motion repair AND whatever
// main added to the phone's graph in between. The two were not measured apart
// — the gate is a tripwire for accidental bloat, and nothing here is one.
//
// What is in the phone for the bytes this time: the panel's open, close and
// month slide now run on src/lib/motion/spring.ts (the approved mock's own
// integrator) instead of CSS transitions plus a commit timer, which is what
// stopped the production build from animating the panel open at all.
//
// RE-MEASURED 2026-09-15 for fix round 1 on that repair (#921 R1-R4):
// 2,094,602 → 2,094,758. Same CI recipe, emptied thin/dist, byte-identical
// across two clean builds on the final tip, same content hashes both times:
// en 133,757 · index 1,022,258 · vendor 937,743 = 2,093,758 B. Ceiling =
// 2,093,758 + 1,000.
//
// +156 B, all in the index chunk (en and vendor unchanged to the byte). No new
// code path and no dependency: a pane's `inert` now answers to which month a
// pending shift is travelling toward rather than to a fixed flag, the wrapper
// takes the month as its key, and three easing utilities and two comments were
// added. The tip is otherwise the same tree the entry above measured.
//
// RE-MEASURED 2026-09-15 for fix round 3 on that repair (#921 R1-R5):
// 2,094,758 → 2,095,289. Same CI recipe, emptied thin/dist, byte-identical
// across two clean builds on the final tip, same content hashes both times:
// en 133,757 · index 1,022,789 · vendor 937,743 = 2,094,289 B. Ceiling =
// 2,094,289 + 1,000.
//
// +531 B, all in the index chunk (en and vendor unchanged to the byte). No new
// dependency and no new code path: the closing dialog takes an `inert`
// attribute and the scrim a conditional class, the pointer handlers gained an
// ownership guard and a settle, a commit that re-keys the panes puts keyboard
// focus back on the panel, and the spring's frame loop checks reduced motion.
// Comments are most of it. The tip is otherwise the same tree as above.
//
// RE-MEASURED 2026-09-15 for fix round 4 on that repair (#921 R4-1…R4-4):
// 2,095,289 → 2,095,631. Same CI recipe, emptied thin/dist, byte-identical
// across two clean builds on the final tip, same content hashes both times:
// en 133,757 · index 1,023,074 · vendor 937,800 = 2,094,631 B. Ceiling =
// 2,094,631 + 1,000.
//
// CORRECTION TO THE ENTRY ABOVE, so this delta is honest: the fix-round-3 tip
// actually produced index 1,022,790 / total 2,094,290 — the figures written
// there were one byte short (caught by that round's delta-verify, re-measured
// twice). The real change here is therefore +341 B, not +342.
//
// Where those bytes went, measured per chunk rather than assumed:
//   index  1,022,790 → 1,023,074 (+284 B) — ours. The month grid became a
//     memoized `Pane` with its two stable props, a month's skeleton cells are
//     cached per month, the anchor gained `mb-0` and the dialog/scrim their
//     `will-change` classes; against that, the unreachable non-x settle branch
//     was deleted. Comments are stripped by the bundler and cost nothing here.
//   vendor   937,743 → 937,800 (+57 B) — NOT ours: @synqed-kk/ui 0.3.1 → 0.3.2.
//     The lock already pinned 0.3.2; this worktree's node_modules was a patch
//     behind it until this round ran `npm install`. The lockfile is untouched.
//   en      133,757 → 133,757 — unchanged to the byte. No new Japanese string
//     anywhere in the round.
// RE-MEASURED 2026-09-15 for PKT-1b-WIRE (the week page + the day line go
// live): 2,095,631 → 2,104,241. Same CI recipe, emptied thin/dist,
// byte-identical across two clean builds on the final tip, same content hashes
// both times (node v24.16.0, @synqed-kk/ui 0.3.2 — installed == lock, checked
// after this branch merged main in):
//   en 134,148 · index 1,031,302 · vendor 937,791 = 2,103,241 B.
// Ceiling = 2,103,241 + 1,000.
//
// Where the +8,610 B went, measured per chunk rather than assumed:
//   index  1,023,074 → 1,031,302 (+8,228 B) — ours, and the bulk of it is the
//     WeekRows/DayNumbersLine pair entering the bundle for the first time:
//     until this PR nothing imported either file, so the thin shell shipped
//     neither. Against that, @synqed-kk/ui's WeekDayCard import, the
//     WeekGridSection wrapper and its hand-rolled formatOpenDuration all
//     leave. The JA message block rides in this chunk too (the summary keys
//     split, 稼働時間, the longer failed line).
//   en       133,757 → 134,148 (+391 B) — the EN half of the same message
//     changes: summaryRange + sep replacing summary/summaryNew/
//     summaryReturning, and "Please try again" on the failed line.
//   vendor   937,800 → 937,791 (−9 B) — NOT ours: same package version, one
//     import fewer reaching it now that WeekDayCard is gone.
// RE-MEASURED 2026-09-15 for FIXLIST-1b-WIRE-R1 (the grid placement + the
// truncated week signal): 2,104,241 → 2,104,545. Same CI recipe, emptied
// thin/dist, byte-identical across two clean builds on the final code tip,
// same content hashes both times (node v24.16.0, @synqed-kk/ui 0.3.2,
// installed == lock):
//   en 134,148 · index 1,031,606 · vendor 937,791 = 2,103,545 B.
// Ceiling = 2,103,545 + 1,000. The previous ceiling still passed (696 B of
// headroom left); re-measured anyway so the ceiling keeps tracking the build.
//
// Where the +304 B went, measured per chunk:
//   index  1,031,302 → 1,031,606 (+304 B) — ours, all of it: `placeForGrid`
//     and its isDuration helper in metric-menu.ts, and the view's `truncated`
//     prop + the `weekFailed` expression it feeds. No new string.
//   en       134,148 → 134,148 — unchanged to the byte.
//   vendor   937,791 → 937,791 — unchanged to the byte.
// RE-MEASURED 2026-09-15 for FIXLIST-1b-WIRE-R2 (one measure per row + the
// 130 px column): 2,104,545 → 2,104,588. Same CI recipe, emptied thin/dist,
// byte-identical across two clean builds on the final code tip, same content
// hashes both times (node v24.16.0, @synqed-kk/ui 0.3.2, installed == lock):
//   en 134,148 · index 1,031,649 · vendor 937,791 = 2,103,588 B.
// Ceiling = 2,103,588 + 1,000. The previous ceiling still passed (957 B of
// headroom left); re-measured anyway so the ceiling keeps tracking the build.
//
// Where the +43 B went, measured per chunk:
//   index  1,031,606 → 1,031,649 (+43 B) — ours, all of it: the one-line
//     R2-1 guard in pickNext, and 130px_100px in place of 120px_100px. No
//     new string, no new component.
//   en       134,148 → 134,148 — unchanged to the byte.
//   vendor   937,791 → 937,791 — unchanged to the byte.
// RE-MEASURED 2026-09-15 for FIXLIST-1b-WIRE-R3 (the four-lens fix round:
// one capacity predicate, the 予約時間 label, the row's full accessible name,
// the press curve + pointerdown, the mock's greys, the shimmer sweep, the day
// line's pending state and the shared 新規 spark): 2,104,588 → 2,105,946.
// Same CI recipe, thin/dist emptied each lap, byte-identical across two clean
// builds on the final code tip, same content hashes both times (node
// v24.16.0, @synqed-kk/ui 0.3.2, installed == lock):
//   en 134,204 · index 1,032,951 · vendor 937,791 = 2,104,946 B.
// Ceiling = 2,104,946 + 1,000. The previous ceiling did NOT pass this time
// (2,104,946 > 2,104,588 by 358 B), so this entry is the round's re-measure,
// not a formality.
//
// Where the +1,358 B went, measured per chunk:
//   index  1,031,649 → 1,032,951 (+1,302 B) — ours, all of it: NewSpark.tsx
//     (the mock's two-star glyph, which also DROPPED lucide's Sparkles from
//     this chunk), the row's accessible-name builder, the two pointer press
//     handlers and their four JSX props, the countLine/countValue split, the
//     day line's pending branch, and the JA/EN key additions (countLine,
//     ariaSep, ariaLoading) — JA rides in this chunk. Class strings account
//     for the rest: the focus-visible ring, the minmax track, the three zinc
//     greys, the shimmer class and the chevron ease.
//   en       134,148 → 134,204 (+56 B) — the three new EN keys plus the
//     trailing period on `failed`.
//   vendor   937,791 → 937,791 — unchanged to the byte.
// RE-MEASURED 2026-09-15 for FIXLIST-1b-MONTH-4a-R2 (the eight-fix round:
// R2-1 the month arrows step by MONTH KEY not `setMonth`, R2-2 aria-current
// moved to TODAY with aria-pressed added for the selection, R2-3 the
// out-of-month day number's contrast (zinc-500 / dark zinc-400), R2-4
// onPickMonth as a plain named function instead of an inline JSX arrow,
// R2-5 the adapter's stale "inert" comment, R2-6 the shared border-zinc-200/70
// hair token on both calendars, R2-7 the pending pill's margin — now ONE
// exported LinePill (WeekRows.tsx) instead of a local copy in MonthPage.tsx
// plus two duplicated literal spans in DayNumbersLine.tsx). Two now-dead
// entries (4a D-13) sat above this one: the standalone 4a measurement and the
// standalone R3c measurement, each already folded into R1's merged figure —
// pruned here rather than carried forward a second round; this file's
// convention is ONE live entry.
//
// Same CI recipe — the workflow's own six VITE_* values, copied verbatim
// from the checked-in step. thin/dist emptied before each lap, two clean
// laps, byte-identical with matching content hashes both times (node
// v24.16.0, @synqed-kk/ui 0.3.2, installed == lock):
//   en 134,204 · index 1,038,436 · vendor 937,791 = 2,110,431 B.
// Ceiling = 2,110,431 + 1,000. The previous (R1) ceiling was 2,111,495 — this
// tip measures SMALLER, not larger.
//
// Where the bytes went, measured per chunk against R1's own figure:
//   index  1,038,500 → 1,038,436 (−64 B) — net of a few small moves, not one
//     line: the shared LinePill collapses four call sites (two in
//     MonthPage.tsx, two duplicated literal spans in DayNumbersLine.tsx) onto
//     one exported component, which is a net REMOVAL of duplicated class
//     string bytes larger than what R2 added (the new `mr-3` class, the new
//     `aria-pressed` attribute and its string, and `border-zinc-200/70`
//     replacing `border-zinc-100` at three call sites, +3 B each). The
//     zinc-300→zinc-500 / zinc-600→zinc-400 contrast swap is byte-neutral
//     (same string lengths). Every other R2 change is a comment or a
//     function-declaration-shape change — comments do not ship; production
//     minification strips them.
//   en       134,204 → 134,204 — unchanged to the byte: R2 added no string,
//     JA or EN.
//   vendor   937,791 → 937,791 — unchanged to the byte.
// RE-MEASURED 2026-09-15 for PKT-1b-MONTH PIECE 4b (tap a day = stay: the
// selected-day card under the 月 grid, the card's 120 ms fade, and the
// optimistic ring). The R2 entry above is kept as the immediately preceding
// tip's figure — the one comparison this number is read against; everything
// older stays pruned, per this file's ONE-live-entry convention.
//
// Same CI recipe — the workflow's own six VITE_* values, copied verbatim from
// the checked-in step. thin/dist emptied before each lap, two clean laps,
// byte-identical with matching content hashes both times (node v24.16.0,
// @synqed-kk/ui 0.3.2, installed == lock):
//   en 134,294 · index 1,041,374 · vendor 937,791 = 2,113,459 B.
// Ceiling = 2,113,459 + 1,000. The previous (R2) ceiling was 2,111,431, and
// this tip genuinely passes it: the card is new code.
//
// Where the bytes went, measured per chunk against R2's own figure:
//   index  1,038,436 → 1,041,374 (+2,938 B) — ours, all of it: the new
//     SelectedDayCard.tsx (its four states, the row loop, the door and every
//     class string on them), the compact row lifted out of
//     ReservationMobileAgenda as the exported CompactRowContent +
//     COMPACT_ROW / COMPACT_ROW_TAG (a small net ADD here — the extraction
//     removes one inline copy but adds a component, its props and two
//     exported constants), the view's held-tap pair and its month-cell tap
//     handler, and DayNumbersLine's className passthrough.
//   en       134,204 → 134,294 (+90 B) — the three NEW English strings:
//     moreRows, openDay, noBookings. The thin bundle ships EN only (boot-
//     frozen locale), so the three Japanese strings cost this bundle nothing.
//   vendor   937,791 → 937,791 — unchanged to the byte: no dependency moved.
// RE-MEASURED 2026-09-15 on 4b's FINAL tip, after the two proof fixes the
// production build caught (the card's 8 px seam to the grid card; the header
// chip following the ring in 月 mode so the selected day is named the whole
// time). The entry above is 4b's first measurement, kept as the figure this
// one is read against.
//
// Same CI recipe, thin/dist emptied before each of two laps, byte-identical
// with matching content hashes both times:
//   en 134,294 · index 1,041,400 · vendor 937,791 = 2,113,485 B  (+26 B).
// Ceiling = 2,113,485 + 1,000.
//
// +26 B, all in index: the chip's month-mode ternary and its one call into
// the existing jstWallTimeToDate. The seam fix is a wrapper <div> with no
// class at all, so it costs nothing measurable. en and vendor unchanged to
// the byte.
// RE-MEASURED 2026-09-16 on the 4b FIX-ROUND R1 tip (R1-1 … R1-6 + the 23:4x
// type ruling). The entry above is 4b's own final measurement, which is the
// figure this one is read against.
//
// Same CI recipe, thin/dist emptied before each of two laps, byte-identical
// both times (matching content hashes, node v24.16.0):
//   en 134,294 · index 1,042,174 · vendor 937,791 = 2,114,259 B  (+774 B).
// Ceiling = 2,114,259 + 1,000.
//
// +774 B, all in index; en and vendor unchanged to the byte. The card's fade
// window (a second piece of state, the painted snapshot and its effect), the
// pending branch, the counted-rows filter, the region name, the month branch's
// own wrapper, and the type-scale class swaps. Real behaviour, not weight: the
// round REMOVED a dead `gap-[5px]` and the `from` half of the held-tap pair.
// RE-MEASURED 2026-09-16 on PIECE 4c's tip (先月同期間比: the number on both
// doors, the clause on the month line, the switch ON). The entry above is 4b's
// R1 measurement, which is the figure this one is read against.
//
// Same CI recipe — CI's own six VITE_* values, the 208-char anon-key
// placeholder included (a shorter one inflates index and reads as a false
// mismatch), thin/dist emptied before each of two laps, byte-identical both
// times (matching content hashes and md5s, node v24.16.0, @synqed-kk/ui 0.3.2
// installed == lock):
//   en 134,342 · index 1,042,546 · vendor 937,791 = 2,114,679 B  (+420 B).
// Ceiling = 2,114,679 + 1,000.
//
// Where the 420 B went:
//   index  1,042,174 → 1,042,546 (+372 B) — the clause itself: the sign
//     helper, the switch-gated LineItem with its tone choice and its
//     `countValue` call, the new prop on MonthPage and on AppointmentsView,
//     and the thin screen's own pass-through. month-compare.ts is SERVER-side
//     and never enters this bundle; the DTO key is one line of schema.
//   en       134,294 → 134,342 (+48 B) — one new English string,
//     `lastMonthSamePeriod`. The thin bundle ships EN only (boot-frozen
//     locale), so the Japanese term costs this bundle nothing.
//   vendor   937,791 → 937,791 — unchanged to the byte: no dependency moved.
// ── THE LIVE ENTRY ────────────────────────────────────────────────────────
// RE-MEASURED 2026-09-16 on PIECE 4c's FIX-ROUND R1 tip (R1-1 … R1-7). The
// entry above is 4c's own final measurement, which is the figure this one is
// read against.
//
// Same CI recipe — CI's own six VITE_* values, the 208-char anon-key
// placeholder included (a shorter one inflates index and reads as a false
// mismatch), thin/dist emptied before each of two laps, byte-identical both
// times (matching content hashes and md5s, node v24.16.0, @synqed-kk/ui 0.3.2
// installed == lock):
//   en 134,342 · index 1,042,726 · vendor 937,791 = 2,114,859 B  (+180 B).
// Ceiling = 2,114,859 + 1,000.
//
// Where the 180 B went:
//   index  1,042,546 → 1,042,726 (+180 B) — the month line's two `sr-only`
//     separators and their `ariaSep` lookups, so a screen reader hears two
//     facts instead of one run-on string. Everything else this round is
//     SERVER-side (the whole-vs-whole arithmetic, both doors' catch, the
//     clamp) or test-only, and none of it reaches this bundle.
//   en       134,342 → 134,342 — unchanged: the separator reuses a key the
//     bundle already shipped, so the round adds NO new string.
//   vendor   937,791 → 937,791 — unchanged to the byte: no dependency moved.
//
// RE-MEASURED 2026-09-16 after merging origin/main into feat/booking-week-face
// (PR #929, merge commit 320ec111f234b48cb6562ecb2820db8f68dee31a) — this
// constant was one of the merge's six ruled conflicts (union of both chains,
// re-measure after). Same CI recipe, thin/dist emptied between two clean
// builds, byte-identical both times (node v24.16.0, @synqed-kk/ui 0.3.2,
// installed == lock): en 134,223 · index 1,033,464 · vendor 937,791 =
// 2,105,478 B. Ceiling = 2,105,478 + 1,000.
//
// RE-MEASURED 2026-09-16 after merging origin/main into feat/booking-month-grid
// (PR #931) — union of both chains above (this branch's own #931 history plus
// the #929-into-main re-measure entry it had not yet seen). Same CI recipe,
// thin/dist emptied between two clean builds, byte-identical both times (node
// v24.16.0, @synqed-kk/ui 0.3.2, installed == lock): en 134,223 · index
// 1,038,559 · vendor 937,791 = 2,110,573 B. Ceiling = 2,110,573 + 1,000.
//
// RE-MEASURED 2026-09-16 (two-hunks correction) — the two remaining #931
// conflicts landed: DayNumbersLine.tsx's shims (LinePill → main's explicit
// 11px spans, font-bold → font-semibold) and DateJumpPanel.tsx's open effect
// (main's `drawn`/`setDrawn` progressive-draw feature + this branch's
// `defaultLevel === 2` dispatch, both). Same CI recipe, thin/dist emptied
// between two clean builds, byte-identical both times (node v24.16.0,
// @synqed-kk/ui 0.3.2, installed == lock): en 134,223 · index 1,039,146 ·
// vendor 937,791 = 2,111,160 B. Ceiling = 2,111,160 + 1,000.
// RE-MEASURED 2026-09-16 after merging origin/main into feat/booking-month-card
// (PR #932) — union of both chains above (this branch's own 4b/FIX-ROUND R1
// history plus the #929/#931-into-main re-measure entries it had not yet
// seen). The merge also restored DayNumbersLine.tsx's `className` passthrough
// (SelectedDayCard.tsx's own call site) on top of main's flat 13px wrapper —
// dropped by the raw three-way and put back by hand so the card's own padding
// override still applies. Same CI recipe, thin/dist emptied between two clean
// builds, byte-identical both times (node v24.16.0, @synqed-kk/ui 0.3.2,
// installed == lock): en 134,452 · index 1,043,010 · vendor 937,791 =
// 2,115,253 B. Ceiling = 2,115,253 + 1,000.
// RE-MEASURED 2026-09-16 after merging origin/main into feat/booking-month-compare
// (PR #935) — union of both chains above (this branch's own PIECE-4c/FIX-ROUND-R1
// history plus main's #929/#931/#932-into-main re-measure entries it had not yet
// seen). Same CI recipe — CI's own six VITE_* values, the 208-char anon-key
// placeholder included, thin/dist emptied before each of two laps,
// byte-identical both times (matching content hashes, node v24.16.0,
// @synqed-kk/ui 0.3.2 installed == lock):
//   en 134,544 · index 1,044,145 · vendor 937,791 = 2,116,480 B.
// Ceiling = 2,116,480 + 1,000.
//
// Raised 2026-09-16 (Greptile fold, feat/cross-branch-search, P3 cross-branch
// customer search) — the booking/record pickers' new company-wide search tier
// (CustomerCombobox's useRemoteCustomerSearch hook + 他店舗 chip/section
// rendering, RecordCustomerPickerDialog's matching remote-row split, the
// searchCustomersCompanyWide notWired port entry) plus two new ja/en string
// pairs (otherStoreChip, otherStoreSection). Same CI recipe, thin/dist
// emptied between two clean builds, byte-identical both times (node
// v24.16.0, @synqed-kk/ui 0.3.2, installed == lock): en 134,437 · index
// 1,041,362 · vendor 937,791 = 2,113,590 B. Ceiling = 2,113,590 + 1,000.
//
// Where the +2,430 B went, measured per chunk against the prior entry's own
// figure: en 134,223 → 134,437 (+214 B, the two new i18n keys) · index
// 1,039,146 → 1,041,362 (+2,216 B, the remote-search tier's real runtime
// code: the debounced hook, the own-store/other-store split and its two
// render paths, the chip markup) · vendor 937,791 → 937,791 (unchanged — no
// new dependency). Genuine new-feature volume, not bloat — already trimmed
// once (a duplicated SearchRow render path merged into one .map() call)
// before raising this; same class as every prior raise on this line.
const BUDGET_BYTES = 2_117_480

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
