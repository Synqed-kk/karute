import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { getLocale } from "next-intl/server";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang MUST follow the locale. `lang="en"` made browsers render Japanese with
  // Latin glyph hints (the spike used lang="ja" and read cleaner). The font
  // family is identical (Inter + Noto Sans JP) — this, display:swap, and the
  // font vars living on <html> (matching the spike) are the actual root fix.
  const locale = await getLocale();
  return (
    <html
      lang={locale}
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
