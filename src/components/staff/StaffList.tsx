'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { deleteStaff, uploadStaffAvatar } from '@/actions/staff'
import { StaffForm } from './StaffForm'
import { PinSetup } from './PinSetup'

interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  position?: string | null
  email?: string | null
  phone?: string | null
  avatar_url?: string | null
  has_pin?: boolean
  created_at: string
}

interface StaffListProps {
  staffList: StaffMember[]
  activeStaffId: string | null
  /** The currently logged-in user's staff profile ID */
  currentUserId?: string | null
  /** Whether the current user is the account owner */
  isOwner?: boolean
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function StaffList({ staffList, activeStaffId, currentUserId, isOwner = false }: StaffListProps) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const tStaff = useTranslations('staff')
  const tPin = useTranslations('pin')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [pinSetupStaff, setPinSetupStaff] = useState<StaffMember | null>(null)

  async function handleDelete(staff: StaffMember) {
    const confirmed = window.confirm(
      tStaff('deleteConfirm', { name: staff.full_name ?? '' })
    )
    if (!confirmed) return

    try {
      await deleteStaff(staff.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tStaff('failedToDelete'))
    }
  }

  if (staffList.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{ts('staffMembers')}</h2>
        </div>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{ts('noStaff')}</p>
          <Button onClick={() => setShowCreateForm(true)} className="min-h-[44px]">{ts('addStaffMember')}</Button>
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
        <h2 className="text-lg font-medium">{ts('staffMembers')}</h2>
        {isOwner && (
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="min-h-[44px]">
            {tStaff('addStaff')}
          </Button>
        )}
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
                {/* Avatar with upload */}
                <label className="relative shrink-0 cursor-pointer group/avatar">
                  {(staff as StaffMember).avatar_url ? (
                    <img
                      src={(staff as StaffMember).avatar_url!}
                      alt={staff.full_name ?? ''}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {(staff.full_name ?? '?').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const fd = new FormData()
                      fd.append('file', file)
                      const result = await uploadStaffAvatar(staff.id, fd)
                      if ('error' in result) toast.error(result.error)
                      else toast.success(ts('avatarUploaded'))
                    }}
                  />
                </label>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {staff.full_name ?? '(No name)'}
                    </span>
                    {staff.display_role === 'owner' && (
                      <span title={ts('accountOwner')} className="text-amber-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 18.5l2-8 4.5 3 3-5 3 5 4.5-3 2 8z"/><circle cx="12" cy="4" r="2"/><circle cx="4" cy="9" r="1.5"/><circle cx="20" cy="9" r="1.5"/></svg>
                      </span>
                    )}
                    {isActive && (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                        {ts('active')}
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
                      <span>{tStaff('added', { date: formatDate(staff.created_at) })}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(isOwner || staff.id === currentUserId) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPinSetupStaff(staff)}
                    className="min-h-[44px]"
                  >
                    {staff.has_pin ? tPin('pin') : tPin('setPin')}
                  </Button>
                )}
                {(isOwner || staff.id === currentUserId) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingStaff(staff)}
                    className="min-h-[44px]"
                  >
                    {tc('edit')}
                  </Button>
                )}
                {isOwner && staff.display_role !== 'owner' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(staff)}
                    className="min-h-[44px]"
                  >
                    {tc('delete')}
                  </Button>
                )}
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
            avatarUrl: editingStaff.avatar_url ?? undefined,
          }}
          onClose={() => setEditingStaff(null)}
        />
      )}

      {pinSetupStaff && (
        <PinSetup
          staffId={pinSetupStaff.id}
          staffName={pinSetupStaff.full_name ?? 'Staff'}
          hasPin={!!pinSetupStaff.has_pin}
          onClose={() => setPinSetupStaff(null)}
        />
      )}
    </div>
  )
}
