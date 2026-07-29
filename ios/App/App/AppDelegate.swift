import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Session cookie persistence
//
// Fixes the forced re-login on every cold launch. WKWebView evicts the
// persistent Supabase sb-* auth cookies across app restarts (Capacitor #6809),
// so the first request after relaunch is unauthenticated and the server gate
// redirects to /login. We mirror the sb-* cookies into the Keychain on every
// change and RE-INJECT them into the WebView BEFORE the first navigation, so the
// session survives a true cold launch. The storyboard's root scene points at
// this subclass (customClass="CookieVC"). Restore-only: covers cold launches
// within the access-token TTL; a >1h-idle launch may still re-login (documented
// tail — add a native pre-navigation refresh later only if it shows in testing).
final class CookieVC: CAPBridgeViewController, WKHTTPCookieStoreObserver, UIScrollViewDelegate {
    private var didLoadOnce = false
    // Status-bar-tap catcher. The app's content scrolls an inner <main>, so the
    // WKWebView's own scrollView never leaves offset 0 — iOS then never fires
    // its scroll-to-top machinery for it. This 1pt off-screen scroll view is
    // made the ONLY scrollsToTop-eligible candidate; a status-bar tap asks its
    // delegate (scrollViewShouldScrollToTop below), which forwards the tap to
    // the web layer as a `karute:status-tap` event and declines the scroll.
    private let statusTapCatcher = UIScrollView()
    // Captured once at launch so handleLaunchNavigation never does a synchronous
    // Keychain read on the main thread per url-change event: did we cold-launch
    // with a restored session?
    private var hasRestoredSession = false
    // One-shot guards + KVO handle for the cold-launch entry redirect and the
    // auth-redirect recovery (both scoped to the launch window only).
    private var didAimAtApp = false   // redirected the restored session to the dashboard once
    private var didRetryAuth = false  // reloaded the gated route once after a /login bounce
    private var urlObservation: NSKeyValueObservation?

    // Mirrors next-intl routing.locales — distinguishes a bare-locale landing
    // path ("/ja") from a single-segment app route ("/dashboard").
    private static let locales: Set<String> = ["ja", "en"]

    override func viewDidLoad() {
        setupStandardIOSGestures()
        guard
            let store = webView?.configuration.websiteDataStore.httpCookieStore,
            let saved = SessionCookieStore.load(), !saved.isEmpty
        else {
            NSLog("[CookieVC] restore: nothing saved (first launch / logged out) — loading normally")
            super.viewDidLoad()
            scheduleSplashFailsafe()
            startObservers()
            return
        }

        hasRestoredSession = true
        NSLog("[CookieVC] restore: re-injecting \(saved.count): " + saved.map { "\($0.name)[len=\($0.value.count) dom=\($0.domain) path=\($0.path) secure=\($0.isSecure) exp=\(Int($0.expiresDate?.timeIntervalSinceNow ?? -1))s]" }.joined(separator: " "))
        // Re-inject saved cookies, THEN navigate. super.viewDidLoad() (which
        // triggers webView.load) is deferred until every async setCookie
        // completes, so the very first request to the site carries the session.
        let group = DispatchGroup()
        for cookie in saved {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        // Implicit self capture (no capture list) — required so `super` is usable
        // inside the closure.
        let proceed: () -> Void = {
            guard !self.didLoadOnce else { return }
            self.didLoadOnce = true
            NSLog("[CookieVC] restore: loading web")
            super.viewDidLoad()
            self.scheduleSplashFailsafe()
            self.startObservers()
        }
        // setCookie's completion means the cookie is IN THE STORE — but NOT that
        // the WKWebView network process has it for the FIRST request. That sync
        // lags, so the first request can fire WITHOUT the cookie even though
        // restore-verify shows it present → the server gate redirects to /login
        // (the exact symptom). A getAllCookies round-trip barrier + a short beat
        // lets the network process pick it up before we navigate.
        group.notify(queue: .main) {
            store.getAllCookies { all in
                let sb = all.filter { $0.name.hasPrefix("sb-") }
                NSLog("[CookieVC] restore-verify: store has \(sb.count) sb-* — loading after sync beat")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: proceed)
            }
        }
        // Watchdog: never block the load forever if a setCookie completion is
        // dropped (documented) — a missed completion must not white-screen.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: proceed)
    }

    // Standard iOS behaviors (Liam 7/29): edge-swipe back/forward across the
    // SPA's pushState history, and status-bar tap → scroll-to-top (forwarded
    // to the web layer, which owns the actual scroll container).
    private func setupStandardIOSGestures() {
        webView?.allowsBackForwardNavigationGestures = true

        // See statusTapCatcher above: park a 1pt scrollable view off the layout
        // and make it the only scroll-to-top candidate. Fully eligible: visible
        // alpha (transparent background — nothing renders), interactive,
        // scrollable content, offset off the top.
        webView?.scrollView.scrollsToTop = false
        statusTapCatcher.frame = CGRect(x: 0, y: 120, width: 1, height: 1)
        statusTapCatcher.contentSize = CGSize(width: 1, height: 3)
        statusTapCatcher.contentOffset = CGPoint(x: 0, y: 1)
        statusTapCatcher.backgroundColor = .clear
        statusTapCatcher.isUserInteractionEnabled = true
        statusTapCatcher.contentInsetAdjustmentBehavior = .never
        statusTapCatcher.scrollsToTop = true
        statusTapCatcher.delegate = self
        view.addSubview(statusTapCatcher)
        NSLog("[CookieVC] gesture setup: backForward=%d catcher eligible (frame=%@ offset=%@)",
              webView?.allowsBackForwardNavigationGestures == true ? 1 : 0,
              NSCoder.string(for: statusTapCatcher.frame),
              NSCoder.string(for: statusTapCatcher.contentOffset))
    }

    // Status-bar tap lands here (the catcher is the only eligible scroll view).
    // Forward to the web layer and decline the native scroll so the catcher
    // stays scrolled (eligible for the next tap either way).
    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        NSLog("[CookieVC] status-bar tap (catcher=%d) — forwarding to web",
              scrollView === statusTapCatcher ? 1 : 0)
        guard scrollView === statusTapCatcher else { return false }
        bridge?.eval(js: "window.dispatchEvent(new Event('karute:status-tap'))")
        return false
    }

    // Belt-and-braces observability while smoking this in the sim: if the
    // system scrolls the catcher instead of asking, this still fires.
    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
        NSLog("[CookieVC] didScrollToTop fired")
    }

    // Splash failsafe. launchAutoHide=false (capacitor.config.ts) keeps the
    // launch screen up until the site hydrates and calls SplashScreen.hide()
    // (the web app's SplashHide component). If that call never comes — site JS
    // crashed, hydration failed — force-hide through the bridge so nobody is
    // stranded on the splash. Scheduled where navigation actually STARTS (both
    // viewDidLoad paths), not at viewDidLoad entry, so the cookie-restore beat
    // never eats into the 8s page-load budget on slow networks. Ceiling: if the
    // page never loaded AT ALL there is no JS context to eval into and the
    // splash stays up — the same terminal state as today's endless white
    // screen, now branded. (A pure-native hide would need a CAPPluginCall,
    // which has no public initializer in Cap 8.)
    private func scheduleSplashFailsafe() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
            NSLog("[CookieVC] splash failsafe (8s) — force-hiding if still up")
            self?.bridge?.eval(js: "window.Capacitor?.Plugins?.SplashScreen?.hide()")
        }
    }

    private func startObservers() {
        // The WK observer fires for HTTP Set-Cookie (e.g. token refresh) but NOT
        // for cookies written via JS document.cookie — which is exactly how
        // @supabase/ssr writes the session on login. So the RELIABLE capture is on
        // background/resign (which always precedes a cold-launch kill): snapshot
        // the live store to the Keychain then.
        webView?.configuration.websiteDataStore.httpCookieStore.add(self)
        NotificationCenter.default.addObserver(
            self, selector: #selector(captureSessionCookies),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(captureSessionCookies),
            name: UIApplication.willResignActiveNotification, object: nil)

        // Cold-launch entry + auth-redirect recovery, scoped to the launch window.
        // The shell's server.url is the site ROOT, which resolves to the PUBLIC
        // landing page — it never forwards a restored session to the dashboard, so
        // a valid session would just sit unused on the marketing page. With a
        // restored session we therefore (1) redirect the landing page to the
        // dashboard (a gated route that actually consumes the session). If that
        // gated load 302s to /login — setCookie's completion only proves the
        // cookie is in the UI-process store, not that the network process has it
        // for the FIRST request, and that sync lags — we (2) reload the dashboard
        // exactly once; by then a full round-trip has elapsed so the network
        // process has the cookie. Both actions are one-shot. A timeout then
        // detaches the observer so a later logout or manual /login navigation can
        // never re-trigger them.
        urlObservation = webView?.observe(\.url, options: [.new]) { [weak self] webView, _ in
            self?.handleLaunchNavigation(webView.url)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
            guard let self, self.urlObservation != nil else { return }
            NSLog("[CookieVC] launch window closed — detaching url observer")
            self.urlObservation = nil
        }
    }

    // Drives the launch window when a session was restored: redirect the public
    // landing page to the dashboard, and recover once from a /login bounce. Inert
    // without a restored session (logged-out launches are untouched) and after the
    // observer has been detached.
    private func handleLaunchNavigation(_ url: URL?) {
        guard
            let url,
            hasRestoredSession,
            let dashboard = dashboardURL(from: url)
        else { return }
        let path = url.path

        // (2) Gated load bounced to /login — network-process cookie-sync lag, or a
        // genuinely rejected token. Reload the gated route exactly once; if the
        // token is truly dead the next /login simply stays put (no loop).
        if path.hasSuffix("/login") {   // matches /login and locale-prefixed /ja/login
            guard !didRetryAuth else { return }
            didRetryAuth = true
            NSLog("[CookieVC] auth-recover: /login bounce with a restored session — reloading \(dashboard) once (network-process cookie sync)")
            webView?.load(URLRequest(url: dashboard))
            return
        }

        // (1) Restored session sitting on the public landing page (root or a bare
        // /<locale>) — send it to the dashboard so the session is actually used.
        if !didAimAtApp, isLandingOrRoot(path) {
            didAimAtApp = true
            NSLog("[CookieVC] entry: restored session on landing \(path) — loading \(dashboard)")
            webView?.load(URLRequest(url: dashboard))
        }
    }

    // <scheme>://<host>/dashboard — no locale prefix; next-intl resolves /dashboard
    // to the default-locale dashboard (/ja/dashboard). The origin is read from the
    // live URL so nothing hardcodes the deploy host.
    private func dashboardURL(from url: URL) -> URL? {
        guard
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = comps.scheme, let host = comps.host
        else { return nil }
        return URL(string: "\(scheme)://\(host)/dashboard")
    }

    // Root ("/") or a bare locale segment ("/ja", "/en") — the public landing
    // page. A single NON-locale segment ("/dashboard") is not landing, so match
    // the locale explicitly rather than by segment count; app routes carry a
    // locale + a second segment (/ja/dashboard) and never match. /login is
    // handled before this is consulted.
    private func isLandingOrRoot(_ path: String) -> Bool {
        let segments = path.split(separator: "/")
        return segments.isEmpty || (segments.count == 1 && Self.locales.contains(String(segments[0])))
    }

    @objc private func captureSessionCookies() { capture(reason: "background") }

    // HTTP Set-Cookie changes (e.g. token refresh) — may not fire for JS writes.
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) { capture(reason: "observer") }

    // Snapshot the sb-* session cookies to the Keychain; clear on logout.
    private func capture(reason: String) {
        guard let store = webView?.configuration.websiteDataStore.httpCookieStore else { return }
        store.getAllCookies { cookies in
            let session = cookies.filter { $0.name.hasPrefix("sb-") }
            NSLog("[CookieVC] capture(\(reason)): \(cookies.count) total, \(session.count) sb-*: " + session.map { "\($0.name)[len=\($0.value.count)]" }.joined(separator: " "))
            if session.isEmpty {
                SessionCookieStore.clear()
            } else {
                SessionCookieStore.save(session)
            }
        }
    }
}

// Keychain-backed store for the session cookies (device-only, after-first-unlock
// — appropriate for auth tokens / customer data; survives WKWebView eviction).
enum SessionCookieStore {
    private static let account = "jp.synqed.karute.session-cookies"

    static func save(_ cookies: [HTTPCookie]) {
        let props = cookies.compactMap { $0.properties }
        guard
            !props.isEmpty,
            let data = try? NSKeyedArchiver.archivedData(withRootObject: props, requiringSecureCoding: false)
        else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> [HTTPCookie]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard
            SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data,
            let props = (try? NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(data)) as? [[HTTPCookiePropertyKey: Any]]
        else { return nil }
        return props.compactMap { HTTPCookie(properties: $0) }
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
