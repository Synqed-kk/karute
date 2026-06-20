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
final class CookieVC: CAPBridgeViewController, WKHTTPCookieStoreObserver {
    private var didLoadOnce = false

    override func viewDidLoad() {
        guard
            let store = webView?.configuration.websiteDataStore.httpCookieStore,
            let saved = SessionCookieStore.load(), !saved.isEmpty
        else {
            NSLog("[CookieVC] restore: nothing saved (first launch / logged out) — loading normally")
            super.viewDidLoad()
            startObservers()
            return
        }

        NSLog("[CookieVC] restore: re-injecting \(saved.count) saved cookie(s) before first load")
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
            NSLog("[CookieVC] restore: cookies set — loading web")
            super.viewDidLoad()
            self.startObservers()
        }
        group.notify(queue: .main, execute: proceed)
        // Watchdog: WKHTTPCookieStore.setCookie's completion handler is not
        // always called (documented). Never block the load forever, or a missed
        // completion would leave a permanent white screen.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: proceed)
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
    }

    @objc private func captureSessionCookies() { capture(reason: "background") }

    // HTTP Set-Cookie changes (e.g. token refresh) — may not fire for JS writes.
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) { capture(reason: "observer") }

    // Snapshot the sb-* session cookies to the Keychain; clear on logout.
    private func capture(reason: String) {
        guard let store = webView?.configuration.websiteDataStore.httpCookieStore else { return }
        store.getAllCookies { cookies in
            let session = cookies.filter { $0.name.hasPrefix("sb-") }
            if session.isEmpty {
                NSLog("[CookieVC] capture(\(reason)): no sb-* cookies — clearing Keychain")
                SessionCookieStore.clear()
            } else {
                NSLog("[CookieVC] capture(\(reason)): saved \(session.count) sb-* cookie(s) to Keychain")
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
