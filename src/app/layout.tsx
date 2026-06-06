import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
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
      </body>
    </html>
  );
}
