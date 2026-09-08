# CORE-4 web consent wiring

[CORE-4](https://linear.app/synqed-jp/issue/CORE-4) uses the Core API to verify the
human actor on every request. This web change depends on
[Core PR 97](https://github.com/Synqed-kk/synqed-core/pull/97): apply its manual
migration and deploy the consent routes **before releasing this UI**.

The coaching dashboard and transparency page both load and save the current
login's consent through server actions. The existing session-scoped client forwards
the human bearer token and business to Core. No browser-provided staff ID, selected
shared-device staff card, or localStorage grant can authorize consent. Managers
receive no individual consent information through these actions.

The dialog stays open until a write succeeds, prevents repeated submissions, and
resets the checkbox after every attempt. Opening it to review the disclosure no
longer resets or withdraws an existing decision. A policy conflict reloads current
state and requires another deliberate decision. Failed reads/saves stay visible with
a retry path. Login changes clear the previous state and invalidate outstanding
responses; tab focus rechecks the current server decision. State is local to each
mounted view, not a global cache or localStorage. Existing browser-only decisions
are deliberately not imported. The dialog remounts on login or current-policy
changes so neither can retain an earlier checked acknowledgement. Agreement is
enforced by both the server action and UI only for the disclosure version this UI actually displays (v1.0-2026-05).
Other versions show a message and keep withdrawal available until the dynamic
policy-template work is built.

The existing SDK fetch method carries the new routes, so this PR needs no package
version bump. Core remains authoritative even if the browser state is stale.
No AI generation is activated. The provider adapter's before/after consent checks,
L1 deletion and persistence, scoped grants, counts dashboard, dynamic policy-template
configuration, and the native/mobile facade remain separate CORE-4 work. The
existing raw-recording permission boundary remains as documented by the ticket.

Verification: action tests cover the session-scoped factory, strict input and
failure handling; the existing actor-bearer-forwarding suite verifies its actual
headers. Hook tests cover server-only grants, delayed/duplicate/failed saves,
policy conflict/reload failure, and account changes. Dialog tests verify checkbox
and close-on-success behavior. All 29 focused tests, typecheck, changed-file lint,
and the dark-interactive audit pass. No live-stack Playwright run: this checkout
has no configured Synqed services or usable runtime environment.
