'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      // 'slate' = soft-slate dark (globals.css .slate). Tailwind dark:
      // styles cover it via the extended @custom-variant.
      themes={['light', 'dark', 'slate']}
    >
      {children}
    </NextThemesProvider>
  )
}
