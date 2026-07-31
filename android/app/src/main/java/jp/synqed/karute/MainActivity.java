package jp.synqed.karute;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
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
//
// MARK: - Local mode (code 6+)
//
// When the binary is built with KARUTE_SHELL_MODE=local, the baked
// capacitor.config.json has NO server.url (webDir points at the thin bundle)
// — detected at runtime as CapConfig.getServerUrl() == null. Everything
// documented above is REMOTE-mode plumbing: local-mode auth is a bearer-token
// session in WebView localStorage (thin/auth/session.ts), no sb-* cookies
// exist, and the app must never navigate to or read the remote origin. The
// localMode flag makes every remote path inert while leaving the code intact,
// so rebuilding with KARUTE_SHELL_MODE=remote restores shipped code-5
// behavior unchanged (the rollback story). Upgrading code-5 devices carry
// remote-origin cookies in the native jar plus an EncryptedSharedPreferences
// snapshot: local mode CLEARS BOTH on launch. They are dead credentials no
// legitimate local-mode path ever uses again — but Capacitor's always-on
// CapacitorHttp/CapacitorCookies core plugins are JS-callable native HTTP
// paths (no CORS, shared native cookie jar), so a stale sb-* refresh token
// left in the jar would remain one JS call away from riding to the old
// origin. Clearing costs a hypothetical rollback build one re-login; keeping
// live credentials at rest for that convenience is the wrong trade.
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

    // Local mode (see the class comment): no server.url in the baked config.
    // Set once at the top of load(), before any cookie work; guards every
    // remote-mode path in this file.
    private boolean localMode = false;

    // Audit F3: promoted from a load()-local variable to a field so
    // onDestroy() can cancel everything already queued (watchdog, bounce
    // checks). A setCookie completion that fires AFTER onDestroy re-posts
    // fresh past that purge — the isFinishing/isDestroyed guard inside
    // `proceed` is the second half of this protection.
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Code 8: lock-screen recording. The recording itself is WebView
    // getUserMedia (shared web code, untouched); the OS mutes mic input for a
    // non-visible app unless a microphone-type foreground service is running
    // (see RecordingForegroundService). This callback is the native start/stop
    // signal that costs zero web-code changes: AudioManager reports recording
    // configurations for OUR OWN app only (UID-scoped by the platform's
    // privacy design), so a non-empty list == our WebView capture is live.
    // Registered for the Activity's whole lifetime — recording can never
    // outlive the Activity, because the WebView that owns the MediaRecorder
    // dies with it (enforced in onDestroy by an unconditional stopService).
    private AudioManager.AudioRecordingCallback recordingCallback;
    private boolean recordingServiceStarted = false;

    // Fix B2: Android 12+ (API 31) auto-dismisses the SYSTEM splash screen on
    // this Activity's first drawn frame — which fires well before the WebView
    // has painted anything — so every cold launch showed a blank white WebView
    // for a beat instead of the splash drawable. iOS doesn't have this gap: its
    // WKWebView shell holds its splash explicitly through viewDidLoad (see
    // ios/App/App/AppDelegate.swift). The androidx.core.splashscreen keep-on-
    // screen predicate installed in onCreate() reads this field on every frame
    // until it flips; releaseSplash() is the only thing allowed to flip it, from
    // whichever of the two release points below fires first.
    private boolean splashReleased = false;

    // Ceiling failsafe for the splash hold — mirrors iOS's 8s splash failsafe
    // (same file, same rationale: a dropped completion must never stand
    // between the user and a working app). See the unconditional postDelayed
    // in onCreate() for why this has to be scheduled there and not in load().
    private static final long SPLASH_CEILING_MS = 6000;

    // Second, separate splash hold (code 6+): the @capacitor/splash-screen
    // plugin (arrived with the main merge; config launchAutoHide:false) holds
    // the SAME Android-12 system splash behind its own keep-condition until
    // the page calls SplashScreen.hide() — indefinitely, no ceiling of its
    // own (verified in the vendored plugin: autoHide=false never clears
    // isVisible). src/lib/app-root/splash.ts explicitly relies on a native
    // failsafe existing ("CookieVC's +8s failsafe covers a missed call") —
    // that failsafe is iOS-native; this constant is its Android counterpart.
    private static final long SPLASH_PLUGIN_FAILSAFE_MS = 8000;

    // Fix B1: hardware/gesture back navigates the WebView's own history instead
    // of closing the app. This is a remote-shell WebView with no @capacitor/app
    // (or any other) plugin registered to handle it — verified nothing in this
    // app or in the vendored Capacitor BridgeActivity touches onBackPressed /
    // OnBackPressedCallback / KEYCODE_BACK — so without this, the platform
    // default finishes the Activity from ANY navigation depth, on the very
    // first back-press. Registering here makes back behave like every
    // browser-based Android app: walk the WebView history first, only leave
    // the app once there's nowhere left to go back to.
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Google's documented order, and the order MATTERS on both sides:
        // installSplashScreen() must run BEFORE super.onCreate() (it hooks the
        // splash before the first frame), but setKeepOnScreenCondition() must
        // run AFTER it. The keep-condition call does
        // findViewById(android.R.id.content), which on an AppCompat activity
        // forces the sub-decor to build — and at this point the theme is still
        // Theme.SplashScreen (BridgeActivity only swaps to AppTheme.NoActionBar
        // inside super.onCreate()), so calling it early throws the fatal
        // "You need to use a Theme.AppCompat theme" IllegalStateException.
        // Build 3 shipped with the two calls adjacent, pre-super.onCreate —
        // crashed every launch on-device; reproduced in the emulator
        // (SplashScreen$Impl31.setKeepOnScreenCondition → AppCompatDelegateImpl
        // .createSubDecor) and fixed by this split.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        splashScreen.setKeepOnScreenCondition(() -> !splashReleased);

        // Scheduled here, unconditionally, rather than inside load(): if
        // setContentView(capacitor_bridge_layout_main) throws, BridgeActivity's
        // onCreate() catch branch falls back to R.layout.no_webview and RETURNS
        // without ever calling load() — so scheduleSplashRelease()'s WebView
        // release point (below) would never run on that path. This ceiling is
        // the only release point that's guaranteed to fire regardless.
        mainHandler.postDelayed(this::releaseSplash, SPLASH_CEILING_MS);

        // Code 8: start/stop the mic foreground service in lockstep with the
        // app's own audio capture. The service MUST start while the app is
        // still foregrounded (that's what grants continued while-in-use mic
        // access after the screen locks) — guaranteed here because capture can
        // only begin from an in-app tap on 録音開始, and this callback fires on
        // mainHandler within that same foreground window.
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        recordingCallback = new AudioManager.AudioRecordingCallback() {
            @Override
            public void onRecordingConfigChanged(List<AudioRecordingConfiguration> configs) {
                boolean recording = !configs.isEmpty();
                if (recording == recordingServiceStarted) return;
                recordingServiceStarted = recording;
                Intent service = new Intent(MainActivity.this, RecordingForegroundService.class);
                if (recording) {
                    Log.d(TAG, "recording started — raising mic foreground service");
                    // startForegroundService is the API 26+ contract (the
                    // service has 5s to call startForeground — it does so
                    // immediately); plain startService below that.
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        startForegroundService(service);
                    } else {
                        startService(service);
                    }
                } else {
                    Log.d(TAG, "recording stopped — dropping mic foreground service");
                    stopService(service);
                }
            }
        };
        audioManager.registerAudioRecordingCallback(recordingCallback, mainHandler);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                // Background instead of finishing — keeps the Bridge, WebView, and
                // this file's restored session cookies warm in memory so the next
                // launch (recents tap) is instant instead of a fresh cold start.
                moveTaskToBack(true);
            }
        });
    }

    // Extension point BridgeActivity exposes specifically for this: onCreate()
    // does its own setup (theme, plugin loading, contentView) then calls
    // this.load() last, and load() is where the Bridge — and its WebView, and
    // the WebView's FIRST navigation (webView.loadUrl(appUrl), synchronous
    // inside Bridge construction) — actually gets created. Overriding it lets
    // us re-inject cookies and delay that first navigation exactly the way
    // CookieVC.viewDidLoad() delays super.viewDidLoad() on iOS.
    @Override
    protected void load() {
        // Local-mode gate — decided from the BAKED config before any cookie
        // machinery runs. getBridge() is still null here (BridgeActivity only
        // constructs the Bridge inside super.load()), so read the config the
        // same way the Bridge itself will: CapConfig.loadDefault() parses
        // assets/capacitor.config.json.
        localMode = CapConfig.loadDefault(this).getServerUrl() == null;
        if (localMode) {
            Log.d(TAG, "local mode: baked bundle, localStorage auth — cookie machinery inert");
            // Cleanse stale remote-era credentials (see the class comment):
            // the code-5 sb-* cookies and the encrypted snapshot are dead
            // data in local mode, but the jar copy stays reachable by
            // Capacitor's ungated CapacitorHttp/CapacitorCookies plugins —
            // remove both. Idempotent; local mode uses no cookies at all.
            CookieManager jar = CookieManager.getInstance();
            jar.removeAllCookies(ignored -> jar.flush());
            SessionCookieStore.clear(this);
            super.load();
            scheduleSplashRelease();
            return;
        }

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
            scheduleSplashRelease();
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
            scheduleSplashRelease();
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
        // Belt over the load()-branch guard: this is the single gateway to
        // both remote-origin loadUrl sites (here and checkLoginBounce, which
        // only this method schedules) — local mode must never reach either.
        if (localMode) return;
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

    // Fix B2 release point (a): the WebView's first real content paint. Called
    // from BOTH load() branches, after super.load() and after aimAtDashboard()
    // has had a chance to run — arming this any earlier would let the splash
    // drop on the wrong URL's first frame (the transient root/marketing load
    // that aimAtDashboard() immediately supersedes, rather than the actual
    // destination).
    private void scheduleSplashRelease() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return; // SPLASH_CEILING_MS in onCreate() covers this

        // Failsafe for the PLUGIN's splash hold (see SPLASH_PLUGIN_FAILSAFE_MS):
        // the hide-call proxy is bridge-injected, so this releases a stuck
        // splash even when the app bundle itself failed to boot; if the page
        // already called hide() it no-ops. Purged with everything else by
        // onDestroy()'s removeCallbacksAndMessages.
        mainHandler.postDelayed(
            () -> webView.evaluateJavascript(
                "window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen"
                    + " && window.Capacitor.Plugins.SplashScreen.hide()",
                null),
            SPLASH_PLUGIN_FAILSAFE_MS);

        webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                // android.webkit.WebView's public contract for
                // postVisualStateCallback only guarantees the POSTING call runs on
                // the WebView's origin thread (checkThread() enforces that on the
                // way in); it does not document which thread onComplete lands on.
                // Route through mainHandler unconditionally so releaseSplash() —
                // which flips the field the keep-on-screen predicate reads — only
                // ever runs on the main thread, whichever thread actually delivers
                // this callback.
                mainHandler.post(MainActivity.this::releaseSplash);
            }
        });
    }

    // Idempotent — whichever of the two release points (the WebView paint
    // above, or SPLASH_CEILING_MS in onCreate()) fires first is the one that
    // matters; setKeepOnScreenCondition just re-reads this field on every
    // frame until it flips.
    private void releaseSplash() {
        splashReleased = true;
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
        // Code 8: the WebView (and any recording in it) dies with this
        // Activity, but the unregister below also removes the only stop
        // signal — so stop the service unconditionally here or a 録音中
        // notification could outlive the recording it describes.
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (recordingCallback != null) {
            audioManager.unregisterAudioRecordingCallback(recordingCallback);
        }
        recordingServiceStarted = false;
        stopService(new Intent(this, RecordingForegroundService.class));
    }

    // Snapshot the sb-* cookies to EncryptedSharedPreferences; clear on
    // logout — same behavior as iOS's capture(): an empty session clears the
    // store rather than leaving a stale entry behind. ALSO flushes
    // CookieManager here: Android batches native cookie-jar writes to disk,
    // and a process death before that flush is a plausible root cause on its
    // own, independent of whether our own snapshot exists — so this hook
    // fixes both the batching bug and feeds the belt-and-braces backup.
    private void captureSessionCookies(String reason) {
        // Local mode has no cookie session to capture — and must never write
        // a snapshot (captureArmed also stays false in local mode, but that is
        // incidental; this guard is the explicit contract).
        if (localMode) return;
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
