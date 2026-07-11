# Handoff — iOS forces re-login on every cold launch

**Problem:** The Karute iOS app (Capacitor remote-URL shell over `karute-omega.vercel.app`) makes the user log in again on every cold launch. It should stay logged in.

**Where:** branch `feat/ios-capacitor-shell` → `ios/App/App/AppDelegate.swift` (the `CookieVC` class). Native-only change; web/prod is untouched.

**Root cause (established):** WKWebView evicts the persistent Supabase `sb-*` auth cookie across a cold launch (Capacitor #6809). The first request after relaunch is unauthenticated, so the server gate 302s to `/login`.

**What's already in place:** `CookieVC` mirrors the `sb-*` cookies to the Keychain on background/resign, and re-injects them before the first navigation on launch.

**Verified working:** both capture and restore. On launch the cookie is re-injected complete (2535 B, `dom=karute-omega.vercel.app`, `path=/`, not expired), and a `getAllCookies` round-trip confirms it's in the store *before* the page loads.

**Still fails** even with a fresh login → immediate force-quit → reopen.
Tried: background-capture, `getAllCookies` barrier + 0.6 s beat before `load`. No change.
Ruled out: expiry, cookie corruption/chunking, wrong domain/path.

**Two hypotheses — one Safari Web Inspector network trace settles it:**
1. The cookie is in `webView.configuration.websiteDataStore` but not on the **first request** (WK cookie-store → network-process sync lag). → fix: reload once after cookies are confirmed synced.
2. The cookie **is** sent but the server rejects the token. → different fix.

On the first cold-launch request, check: is `Cookie: sb-...` present, and is the response 200 or 302→`/login`? That picks the branch.

**Not a launch blocker** — everything else (login, recording, sync, UI) works. This is re-login convenience only.
