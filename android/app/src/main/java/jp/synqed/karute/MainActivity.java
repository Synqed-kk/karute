package jp.synqed.karute;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.BridgeActivity;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONException;
import org.json.JSONObject;

// MARK: - Session cookie persistence
//
// Android port of the iOS CookieVC fix (ios/App/App/AppDelegate.swift). Fixes
// the same forced re-login on every cold launch: this is a Capacitor REMOTE
// shell (server.url loads the live site — see capacitor.config.ts), and auth
// is Supabase SSR sb-* cookies sitting in the WebView's cookie jar. On Android
// the risk is different from iOS's WKWebView-per-launch eviction: the stock
// android.webkit.CookieManager DOES persist cookies to its own on-disk store
// across launches, but (a) it batches writes and a process kill before a
// flush() is a plausible loss vector, and (b) MainActivity/BridgeActivity had
// ZERO handling of either side, so any loss — batching or otherwise — showed
// up identically as "forced re-login". The fix mirrors iOS's two-sided
// approach: explicit flush() at the same lifecycle points iOS captures at,
// PLUS a belt-and-braces EncryptedSharedPreferences snapshot that we
// re-inject before the WebView's first navigation, so a cold launch is
// covered even if the native cookie jar itself came back empty.
//
// Cookie scope: sb-* only, same filter as iOS. @supabase/ssr writes these via
// document.cookie on login (see the capture() comment below) — a fact that
// also proves they are NOT HttpOnly (HttpOnly cookies can only ever be set by
// a Set-Cookie response header, never by JS), which matters here because
// android.webkit.CookieManager.getCookie() cannot see HttpOnly cookies at
// all. If these cookies were HttpOnly this whole approach would silently
// capture nothing; they are not, so it works.
public class MainActivity extends BridgeActivity {

    private static final String TAG = "CookiePersist";

    // The one server origin this remote shell ever talks to (capacitor.config.ts
    // server.url / server.allowNavigation) — capture and re-injection are
    // scoped to it, same single-origin assumption the iOS port makes.
    private static final String SERVER_ORIGIN = "https://karute-omega.vercel.app";
    private static final String COOKIE_PREFIX = "sb-";

    // Watchdog ceiling — mirrors iOS's 2.0s fallback in viewDidLoad. A dropped
    // setCookie completion callback must never block the app on a permanent
    // blank screen; this guarantees super.load() eventually runs.
    private static final long INJECT_WATCHDOG_MS = 2000;

    // android.webkit.CookieManager.getCookie(url) — unlike iOS's
    // WKHTTPCookieStore.getAllCookies() — returns ONLY "name=value" pairs; the
    // original Expires/Max-Age attribute set by the server is not recoverable
    // through this API. Without re-supplying SOME Max-Age, Android treats a
    // freshly-set cookie with no expiry as a non-persistent session cookie
    // that dies with this process — silently defeating the whole fix. We
    // can't restore the true expiry, so — same "restore-only, don't invent
    // new expiry logic" spirit as iOS — we mark the restored copy persistent
    // for a generous window and leave the SERVER as the sole authority on
    // whether the token inside it is still valid: a stale value just 401s and
    // bounces to /login same as it would on iOS.
    private static final long REINJECT_MAX_AGE_SECONDS = 60L * 60 * 24 * 30; // 30 days

    // Guards against super.load() running twice if the watchdog and the real
    // completion race (same role as iOS's didLoadOnce).
    private boolean didLoadOnce = false;

    // Audit F2: capture only starts doing anything once the restore path has
    // settled (load() has reached super.load()). Mirrors iOS registering its
    // capture observers only inside `proceed` — a background event firing
    // during the async restore window must never snapshot a half-injected
    // jar over the only good backup; that wipe recreates the exact forced
    // re-login this file exists to fix.
    private boolean captureArmed = false;

    // Audit F4: one-shot guard for the /login-bounce recovery retry — port
    // of iOS's didRetryAuth. A genuinely dead session must bounce to /login
    // and STAY there, not loop.
    private boolean didRetryAuth = false;

    // Audit F3: promoted from a load()-local variable to a field so
    // onDestroy() can cancel everything already queued (watchdog, bounce
    // checks). A setCookie completion that fires AFTER onDestroy re-posts
    // fresh past that purge — the isFinishing/isDestroyed guard inside
    // `proceed` is the second half of this protection.
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Extension point BridgeActivity exposes specifically for this: onCreate()
    // does its own setup (theme, plugin loading, contentView) then calls
    // this.load() last, and load() is where the Bridge — and its WebView, and
    // the WebView's FIRST navigation (webView.loadUrl(appUrl), synchronous
    // inside Bridge construction) — actually gets created. Overriding it lets
    // us re-inject cookies and delay that first navigation exactly the way
    // CookieVC.viewDidLoad() delays super.viewDidLoad() on iOS.
    @Override
    protected void load() {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        Map<String, String> saved = SessionCookieStore.load(this);
        Map<String, String> live = parseSessionCookies(cookieManager.getCookie(SERVER_ORIGIN));

        // Audit F1: jar-first — the saved snapshot is disaster recovery, not
        // the authority. Android's native CookieManager jar normally
        // persists across launches on its own; injecting a possibly-stale
        // snapshot over a jar that's already healthy can clobber a rotated
        // refresh token (and mix stale/live cookie chunks, since the live
        // jar may hold a newer sb-* value than the snapshot for the same
        // name). Only re-inject when the jar came back genuinely empty AND
        // a snapshot exists to recover from. This also keeps the common
        // launch path fully synchronous again — no deferred-bridge window.
        if (!live.isEmpty() || saved.isEmpty()) {
            if (!live.isEmpty()) {
                Log.d(TAG, "restore: live jar already has " + live.size() + " sb-* cookies — loading normally, snapshot not used");
            } else {
                Log.d(TAG, "restore: nothing saved (first launch / logged out) — loading normally");
            }
            captureArmed = true;
            super.load();
            if (!live.isEmpty() || !saved.isEmpty()) {
                aimAtDashboard();
            }
            return;
        }

        Log.d(TAG, "restore: jar empty, re-injecting " + saved.size() + " sb-* cookies before first navigation");

        Runnable proceed = () -> {
            // isFinishing/isDestroyed: onDestroy()'s removeCallbacksAndMessages
            // only purges what is ALREADY queued — a setCookie ValueCallback
            // lives in CookieManager's native layer and can post this Runnable
            // fresh AFTER teardown. Without this guard that late post would
            // build a zombie Bridge+WebView on the dead Activity and navigate
            // it with the session cookie.
            if (didLoadOnce || isFinishing() || isDestroyed()) return;
            didLoadOnce = true;
            cookieManager.flush();
            Log.d(TAG, "restore: cookies flushed — loading web");
            captureArmed = true;
            super.load();
            aimAtDashboard();
        };
        // Watchdog first, so a dropped completion still resolves in bounded time.
        mainHandler.postDelayed(proceed, INJECT_WATCHDOG_MS);

        // setCookie's completion means the cookie is in CookieManager's
        // in-memory store — same "in the store" vs "network process has it
        // yet" distinction iOS's comment calls out. Waiting for every
        // completion before navigating is the same barrier iOS builds with
        // its DispatchGroup; there's no equivalent extra "sync beat" here
        // because CookieManager (unlike WKWebView) shares one process-wide
        // native cookie store with the WebView that's about to load, so
        // there's no separate network-process handoff to wait out.
        AtomicInteger pending = new AtomicInteger(saved.size());
        for (Map.Entry<String, String> cookie : saved.entrySet()) {
            String setCookieString = cookie.getKey() + "=" + cookie.getValue()
                + "; Max-Age=" + REINJECT_MAX_AGE_SECONDS + "; Path=/; Secure";
            cookieManager.setCookie(SERVER_ORIGIN, setCookieString, ignored -> {
                if (pending.decrementAndGet() == 0) {
                    mainHandler.removeCallbacks(proceed);
                    mainHandler.post(proceed);
                }
            });
        }
    }

    // Audit F4: port of iOS handleLaunchNavigation, simplified. SERVER_ORIGIN's
    // root is the public marketing page — it never forwards an authenticated
    // visitor to the dashboard (verified in src/proxy.ts, which only refreshes
    // the auth cookie and never redirects, and src/app/[locale]/page.tsx,
    // which renders unconditionally; iOS learned this the hard way on-device,
    // commit 85a4d56c). So a session that survived restore would otherwise sit
    // unused on the marketing page — supersede the just-started root load with
    // the dashboard, which actually consumes it. /dashboard carries no locale
    // prefix on purpose — next-intl resolves it, same as iOS's dashboardURL.
    private void aimAtDashboard() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        webView.loadUrl(SERVER_ORIGIN + "/dashboard");

        // One-shot bounce recovery — port of iOS's auth-redirect recovery
        // (commit 36d4e365). iOS empirically hit a first-gated-load bounce to
        // /login because setCookie's completion only proves the cookie reached
        // WKWebView's UI-process store, not that the network process has it
        // yet for the first request. Android's CookieManager is a single
        // process-wide native store shared directly with the WebView about to
        // load, so that specific lag shouldn't apply here — but it's unproven
        // on-device, and one bounded, one-shot retry is cheap: a genuinely
        // dead session just lands back on /login and stays (didRetryAuth
        // blocks a second attempt, so no loop).
        mainHandler.postDelayed(() -> checkLoginBounce(webView), 2500);
        mainHandler.postDelayed(() -> checkLoginBounce(webView), 5000);
    }

    // Checked at +2500ms and +5000ms after aimAtDashboard(). Path-suffix match
    // (not full-URL) so a locale-prefixed bounce (/ja/login) still matches.
    private void checkLoginBounce(WebView webView) {
        if (didRetryAuth) return;
        String url = webView.getUrl();
        String path = url == null ? null : Uri.parse(url).getPath();
        if (path != null && path.endsWith("/login")) {
            didRetryAuth = true;
            Log.d(TAG, "auth-recover: /login bounce with a restored session — reloading dashboard once");
            webView.loadUrl(SERVER_ORIGIN + "/dashboard");
        }
    }

    // Reliable capture points. iOS captures on didEnterBackground /
    // willResignActive because those always precede a cold-launch kill and a
    // WKHTTPCookieStoreObserver alone isn't enough (JS-written cookies don't
    // fire it). onPause/onStop are Android's equivalents — onPause fires
    // first, onStop when the Activity is no longer visible; capturing on both
    // matches iOS capturing on both of its analogous hooks, and is cheap
    // (idempotent snapshot-replace, not an append).
    @Override
    public void onPause() {
        super.onPause();
        captureSessionCookies("onPause");
    }

    @Override
    public void onStop() {
        super.onStop();
        captureSessionCookies("onStop");
    }

    // Audit F3: a Back-press/teardown during the inject window must not let
    // the watchdog or a late setCookie completion run super.load() (Bridge +
    // WebView construction) against a destroyed Activity. This purge covers
    // the already-queued half; `proceed`'s isFinishing/isDestroyed guard
    // covers a native callback that posts after this ran.
    @Override
    public void onDestroy() {
        super.onDestroy();
        mainHandler.removeCallbacksAndMessages(null);
    }

    // Snapshot the sb-* cookies to EncryptedSharedPreferences; clear on
    // logout — same behavior as iOS's capture(): an empty session clears the
    // store rather than leaving a stale entry behind. ALSO flushes
    // CookieManager here: Android batches native cookie-jar writes to disk,
    // and a process death before that flush is a plausible root cause on its
    // own, independent of whether our own snapshot exists — so this hook
    // fixes both the batching bug and feeds the belt-and-braces backup.
    private void captureSessionCookies(String reason) {
        if (!captureArmed) {
            Log.d(TAG, "capture(" + reason + "): skipped — restore not settled");
            return;
        }
        CookieManager cookieManager = CookieManager.getInstance();
        String all = cookieManager.getCookie(SERVER_ORIGIN);
        Map<String, String> session = parseSessionCookies(all);
        Log.d(TAG, "capture(" + reason + "): " + session.size() + " sb-* cookies");
        if (session.isEmpty()) {
            SessionCookieStore.clear(this);
        } else {
            SessionCookieStore.save(this, session);
        }
        cookieManager.flush();
    }

    // CookieManager.getCookie(url) returns cookies in Set-Cookie's
    // "name=value; name2=value2" pairing (no domain/path/expiry attributes —
    // that read-back richness is exactly what WKHTTPCookieStore has and
    // android.webkit.CookieManager does not expose).
    private static Map<String, String> parseSessionCookies(String cookieHeader) {
        Map<String, String> result = new HashMap<>();
        if (cookieHeader == null || cookieHeader.isEmpty()) return result;
        for (String pair : cookieHeader.split(";")) {
            String trimmed = pair.trim();
            int eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            String name = trimmed.substring(0, eq);
            String value = trimmed.substring(eq + 1);
            if (name.startsWith(COOKIE_PREFIX)) {
                result.put(name, value);
            }
        }
        return result;
    }

    // Encrypted, device-only backup of the sb-* cookies (androidx.security
    // security-crypto / EncryptedSharedPreferences) — the Keychain analog of
    // iOS's SessionCookieStore enum. Falls back to plain MODE_PRIVATE
    // SharedPreferences if the crypto provider can't initialize (sandboxed /
    // unusual devices), per the 7/25 personal-device ruling: this app has no
    // multi-tenant device-sharing model, so a plain-prefs fallback for a
    // session cookie (not a raw password) is an acceptable degrade rather than
    // a hard failure.
    private static final class SessionCookieStore {
        private static final String PREFS_FILE = "session_cookies";
        private static final String KEY_COOKIES = "sb_cookies";

        static void save(Context context, Map<String, String> cookies) {
            prefs(context).edit().putString(KEY_COOKIES, new JSONObject(cookies).toString()).apply();
        }

        static Map<String, String> load(Context context) {
            Map<String, String> result = new HashMap<>();
            String raw = prefs(context).getString(KEY_COOKIES, null);
            if (raw == null || raw.isEmpty()) return result;
            try {
                JSONObject json = new JSONObject(raw);
                Iterator<String> keys = json.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    result.put(key, json.getString(key));
                }
            } catch (JSONException e) {
                Log.e(TAG, "corrupt saved cookie snapshot — discarding", e);
            }
            return result;
        }

        static void clear(Context context) {
            prefs(context).edit().remove(KEY_COOKIES).apply();
        }

        private static SharedPreferences prefs(Context context) {
            try {
                MasterKey masterKey = new MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
                return EncryptedSharedPreferences.create(
                    context,
                    PREFS_FILE,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
            } catch (Exception e) {
                Log.e(TAG, "EncryptedSharedPreferences unavailable — falling back to plain prefs", e);
                return context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            }
        }
    }
}
