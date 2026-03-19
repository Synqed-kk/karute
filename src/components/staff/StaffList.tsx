'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { deleteStaff } from '@/actions/staff'
import { StaffForm } from './StaffForm'

interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  position?: string | null
  email?: string | null
  phone?: string | null
  created_at: string
}

interface StaffListProps {
  staffList: StaffMember[]
  activeStaffId: string | null
}

function formatAddedDate(dateString: string): string {
  const date = new Date(dateString)
  return `Added ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}

export function StaffList({ staffList, activeStaffId }: StaffListProps) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)

  async function handleDelete(staff: StaffMember) {
    const confirmed = window.confirm(
      `Delete ${staff.full_name ?? 'this staff member'}? This action cannot be undone.`
    )
    if (!confirmed) return

    try {
      await deleteStaff(staff.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete staff member.')
    }
  }

  if (staffList.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Staff Members</h2>
        </div>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">No staff members yet</p>
          <Button onClick={() => setShowCreateForm(true)} className="min-h-[44px]">Add Staff Member</Button>
        </div>
        {showCreateForm && (
          <StaffForm
            mode="create"
            onClose={() => setShowCreateForm(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Staff Members</h2>
        <Button size="sm" onClick={() => setShowCreateForm(true)} className="min-h-[44px]">
          Add Staff
        </Button>
      </div>

      <ul className="space-y-2">
        {staffList.map((staff) => {
          const isActive = staff.id === activeStaffId
          return (
            <li
              key={staff.id}
              className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {staff.full_name ?? '(No name)'}
                    </span>
                    {isActive && (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </div>
                  {(staff as { position?: string }).position && (
                    <p className="text-xs text-muted-foreground">{(staff as { position: string }).position}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {(staff as { email?: string }).email && <span>{(staff as { email: string }).email}</span>}
                    {(staff as { phone?: string }).phone && <span>{(staff as { phone: string }).phone}</span>}
                    {!(staff as { email?: string }).email && !(staff as { phone?: string }).phone && (
                      <span>{formatAddedDate(staff.created_at)}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingStaff(staff)}
                  className="min-h-[44px]"
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(staff)}
                  className="min-h-[44px]"
                >
                  Delete
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {showCreateForm && (
        <StaffForm
          mode="create"
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {editingStaff && (
        <StaffForm
          mode="edit"
          staff={{
            id: editingStaff.id,
            name: editingStaff.full_name ?? '',
            position: (editingStaff as { position?: string }).position ?? '',
            email: (editingStaff as { email?: string }).email ?? '',
            phone: (editingStaff as { phone?: string }).phone ?? '',
          }}
          onClose={() => setEditingStaff(null)}
        />
      )}
    </div>
  )
}
