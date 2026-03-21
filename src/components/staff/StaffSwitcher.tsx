'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LogOut, ChevronDown, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActiveStaff, createStaff } from '@/actions/staff'
import { createClient } from '@/lib/supabase/client'

type StaffItem = {
  id: string
  name: string
  displayRole?: string
}

type StaffSwitcherProps = {
  staffList: StaffItem[]
  activeStaff: StaffItem | null
  /** The auth user's profile ID — first staff created via signup trigger (OWNER) */
  authProfileId?: string | null
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function StaffSwitcher({ staffList, activeStaff, authProfileId }: StaffSwitcherProps) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (activeStaff && !document.cookie.includes('active_staff_id=')) {
      setActiveStaff(activeStaff.id)
    }
  }, [activeStaff])

  async function handleAddStaff() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createStaff({ name: newName.trim(), position: '', email: '', phone: '' })
      setNewName('')
      setAdding(false)
    } catch {
      // handled
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (staffList.length === 0) {
    return (
      <button type="button" disabled className="text-sm font-medium text-muted-foreground px-2 py-1">
        No Staff
      </button>
    )
  }

  const activeInitials = activeStaff ? getInitials(activeStaff.name) : '??'

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) { setAdding(false); setNewName('') } }}>
      <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-[44px]">
        {/* Active staff avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          {activeInitials}
        </div>
        <span className="text-sm font-medium">{activeStaff?.name ?? 'Select Staff'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-0">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-border/30">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Switch Staff</p>
        </div>

        {/* Staff list */}
        <div className="py-1">
          {staffList.map((staff) => {
            const isActive = activeStaff?.id === staff.id
            const initials = getInitials(staff.name)
            const role = (staff.displayRole === 'owner' ? 'OWNER' : 'STYLIST')

            return (
              <DropdownMenuItem
                key={staff.id}
                onClick={() => setActiveStaff(staff.id)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
              >
                {/* Avatar circle */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {initials}
                </div>
                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>{staff.name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{role}</p>
                </div>
                {/* Active indicator — green dot */}
                {isActive && (
                  <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                )}
              </DropdownMenuItem>
            )
          })}
        </div>

        <DropdownMenuSeparator className="my-0" />

        {/* Add staff */}
        {adding ? (
          <div className="px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') handleAddStaff() }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Staff name..."
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setAdding(false); setNewName('') }}
                className="flex-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddStaff}
                disabled={saving || !newName.trim()}
                className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? '...' : 'Add'}
              </button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem
            onClick={(e) => { e.preventDefault(); setAdding(true) }}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer text-muted-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm">Add Staff</span>
          </DropdownMenuItem>
        )}

        {/* Manage staff in settings */}
        <DropdownMenuItem
          onClick={() => router.push('/settings')}
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer text-muted-foreground"
        >
          <Settings className="h-4 w-4" />
          <span className="text-sm">Manage Staff</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-0" />

        {/* Logout */}
        <DropdownMenuItem
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer text-red-400 hover:text-red-300"
        >
          <LogOut className="h-4 w-4" />
          <span className="text-sm">Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
