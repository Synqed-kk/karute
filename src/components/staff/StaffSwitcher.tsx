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
import { verifyStaffPin } from '@/actions/staff-pin'
import { createClient } from '@/lib/supabase/client'
import { PinPad } from './PinPad'

type StaffItem = {
  id: string
  name: string
  displayRole?: string
  avatarUrl?: string
  hasPin?: boolean
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

  // PIN state
  const [pinTarget, setPinTarget] = useState<StaffItem | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinLoading, setPinLoading] = useState(false)

  // Ensure the cookie is always in sync with the server-resolved active staff.
  useEffect(() => {
    if (!activeStaff) return
    const match = document.cookie.match(/active_staff_id=([^;]+)/)
    const cookieValue = match ? match[1] : null
    if (cookieValue !== activeStaff.id) {
      setActiveStaff(activeStaff.id)
    }
  }, [activeStaff])

  async function handleSwitchStaff(staff: StaffItem) {
    if (staff.id === activeStaff?.id) return

    if (staff.hasPin) {
      // Show PIN pad
      setPinTarget(staff)
      setPinError(null)
      return
    }

    // No PIN — switch directly
    await setActiveStaff(staff.id)
  }

  async function handlePinSubmit(pin: string) {
    if (!pinTarget) return
    setPinLoading(true)
    setPinError(null)

    const result = await verifyStaffPin(pinTarget.id, pin)

    if (result.error) {
      setPinError(result.error)
      setPinLoading(false)
      return
    }

    if (!result.valid) {
      setPinError('Wrong PIN')
      setPinLoading(false)
      return
    }

    // PIN correct — switch
    await setActiveStaff(pinTarget.id)
    setPinTarget(null)
    setPinLoading(false)
  }

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
    <>
      <DropdownMenu onOpenChange={(open) => { if (!open) { setAdding(false); setNewName('') } }}>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-[44px]">
          {/* Active staff avatar */}
          {activeStaff?.avatarUrl ? (
            <img src={activeStaff.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
              {activeInitials}
            </div>
          )}
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
                  onClick={() => handleSwitchStaff(staff)}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                >
                  {/* Avatar */}
                  {staff.avatarUrl ? (
                    <img src={staff.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {initials}
                    </div>
                  )}
                  {/* Name + role */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>{staff.name}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{role}</p>
                  </div>
                  {/* Lock icon if PIN protected */}
                  {staff.hasPin && !isActive && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/60"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  )}
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

      {/* PIN pad modal */}
      {pinTarget && (
        <PinPad
          title={`Enter PIN for ${pinTarget.name}`}
          onSubmit={handlePinSubmit}
          onCancel={() => { setPinTarget(null); setPinError(null) }}
          error={pinError}
          loading={pinLoading}
        />
      )}
    </>
  )
}
