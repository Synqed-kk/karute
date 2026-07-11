import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SplashHide } from "@/components/shell/SplashHide";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  display: "swap",
  // Include 600 — components calling `font-semibold` resolve to weight
  // 600. Without it loaded, the browser synthesizes bold from 500 or
  // interpolates, which renders less crisp than the actual cut.
  // Matches the design spike's font loader.
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "Karute",
  description: "AI-assisted digital karute for service businesses",
};

// `viewport-fit=cover` is what activates env(safe-area-inset-*). The mobile
// header already pads with `pt-[env(safe-area-inset-top)]` and the bottom nav
// with `pb-[env(safe-area-inset-bottom)]`, but Next's default viewport meta
// omits viewport-fit, so those insets resolve to 0 — fine in Safari (its own
// chrome covers the notch/home-bar) but in a bare WKWebView (the iOS TestFlight
// shell) the header jams under the notch and the nav under the home indicator.
// Adding cover is a no-op for normal browser usage and is the standard PWA /
// standalone-display setup, so it is safe for the production web app too.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang="ja": the app is Japanese-primary, and `lang="en"` was making browsers
  // render Japanese with Latin glyph hints (the spike used lang="ja" and read
  // cleaner). The <html> lives in this root layout — ABOVE the [locale] segment —
  // and there's no next-intl middleware / setRequestLocale, so getLocale() here
  // would resolve to the default ('ja') for every locale regardless; hardcoding
  // it is the honest equivalent. (Truly per-locale lang would need next-intl
  // middleware — a separate change.) Font family is identical (Inter + Noto Sans
  // JP); this + display:swap + the font vars on <html> (matching the spike) fix it.
  return (
    <html
      lang="ja"
      data-theme="karute"
      suppressHydrationWarning
      className={`${inter.variable} ${notoSansJP.variable} font-sans antialiased`}
    >
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster />
        <SplashHide />
      </body>
    </html>
  );
}
