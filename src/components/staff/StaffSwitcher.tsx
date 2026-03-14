'use client'

import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActiveStaff } from '@/actions/staff'

type StaffItem = {
  id: string
  name: string
}

type StaffSwitcherProps = {
  staffList: StaffItem[]
  activeStaff: StaffItem | null
}

/**
 * Header dropdown for switching the active staff member.
 *
 * - Displays active staff name only (no role, no avatar, no initials).
 * - Lists all staff members including the current active one.
 * - Clicking a staff member calls setActiveStaff Server Action immediately (no confirmation).
 * - Visual checkmark on the currently active staff member.
 * - Shows disabled "No Staff" button when staffList is empty.
 *
 * Dark theme styled to match the dashboard header.
 */
export function StaffSwitcher({ staffList, activeStaff }: StaffSwitcherProps) {
  if (staffList.length === 0) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="text-sm font-medium text-muted-foreground"
      >
        No Staff
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-1 text-sm font-medium hover:bg-white/10 dark:hover:bg-white/10 transition-colors">
        {activeStaff?.name ?? 'Select Staff'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {staffList.map((staff) => {
          const isActive = activeStaff?.id === staff.id
          return (
            <DropdownMenuItem
              key={staff.id}
              onClick={() => setActiveStaff(staff.id)}
              className="flex items-center justify-between cursor-pointer"
            >
              <span className={isActive ? 'font-semibold' : undefined}>
                {staff.name}
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
