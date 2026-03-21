'use client'

import { ThemeToggle } from './theme-toggle'
import { LocaleToggle } from './locale-toggle'

export function TopBar() {
  return (
    <div className="flex items-center gap-1 mr-2">
      <LocaleToggle />
      <ThemeToggle />
      {/* StaffSwitcher is rendered here by the dashboard layout -- see 05-03 */}
    </div>
  )
}
