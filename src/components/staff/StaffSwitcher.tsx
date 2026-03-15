'use client'

import { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActiveStaff, createStaff } from '@/actions/staff'

type StaffItem = {
  id: string
  name: string
}

type StaffSwitcherProps = {
  staffList: StaffItem[]
  activeStaff: StaffItem | null
}

export function StaffSwitcher({ staffList, activeStaff }: StaffSwitcherProps) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // If server picked a default staff but no cookie exists, persist it on mount
  useEffect(() => {
    if (activeStaff && !document.cookie.includes('active_staff_id=')) {
      setActiveStaff(activeStaff.id)
    }
  }, [activeStaff])

  async function handleAddStaff() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createStaff({ name: newName.trim() })
      setNewName('')
      setAdding(false)
    } catch {
      // Error handled by server action
    } finally {
      setSaving(false)
    }
  }

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
    <DropdownMenu onOpenChange={(open) => { if (!open) { setAdding(false); setNewName('') } }}>
      <DropdownMenuTrigger className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-1 text-sm font-medium hover:bg-white/10 dark:hover:bg-white/10 transition-colors">
        {activeStaff?.name ?? 'Select Staff'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
        <DropdownMenuSeparator />
        {adding ? (
          <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') handleAddStaff() }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Staff name..."
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-1.5 mt-1.5">
              <button
                type="button"
                onClick={() => { setAdding(false); setNewName('') }}
                className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddStaff}
                disabled={saving || !newName.trim()}
                className="flex-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? '...' : 'Add'}
              </button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem
            onClick={(e) => { e.preventDefault(); setAdding(true) }}
            className="flex items-center gap-2 cursor-pointer text-muted-foreground"
          >
            <Plus className="h-4 w-4" />
            Add Staff
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
