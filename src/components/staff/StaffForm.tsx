'use client'

// スタッフ情報を編集 — identity (name / email / 役職 job-title) PLUS the
// authority switchboard: a Role preset + per-staff capability toggles. 役職 is a
// label (what they're called); the Role + toggles are what they can DO. Both
// save with the single 保存 button.
//
// The role section only renders in EDIT mode, behind NEXT_PUBLIC_FEATURE_STAFF_INVITES
// (the staff-management-v2 flag), and only for non-owner rows — the account owner
// shows a read-only "full access". Server actions enforce the real gates
// (staff.manage, no-owner-edit, no privilege escalation); this UI is convenience.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, type UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Pencil, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createStaff, updateStaff } from '@/actions/staff'
import { getStaffPermissions, setStaffPermissions } from '@/actions/permissions'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'
import {
  CAPABILITIES,
  PERMISSION_ROLES,
  presetCapabilities,
  type Capability,
  type PermissionRole,
} from '@/lib/auth/permissions'

const POSITION_OPTIONS = [
  'Stylist', 'Manager', 'Assistant', 'Therapist', 'Esthetician',
  'Nail Technician', 'Receptionist', 'Teacher', 'Trainer', 'Doctor', 'Nurse', 'Other',
]

// Roles assignable here — never 'owner' (that's the account owner / ownership transfer).
const ASSIGNABLE_ROLES = PERMISSION_ROLES.filter((r) => r !== 'owner')

const RBAC_ENABLED = process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES === 'true'

interface StaffFormProps {
  mode: 'create' | 'edit'
  staff?: {
    id: string
    name: string
    position?: string
    email?: string
    phone?: string
    avatarUrl?: string
  }
  onClose: () => void
}

export function StaffForm({ mode, staff, onClose }: StaffFormProps) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const tp = useTranslations('permissions')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffProfileInput>({
    resolver: zodResolver(staffProfileSchema),
    defaultValues: {
      name: mode === 'edit' ? staff?.name ?? '' : '',
      position: mode === 'edit' ? staff?.position ?? '' : '',
      email: mode === 'edit' ? staff?.email ?? '' : '',
      phone: mode === 'edit' ? staff?.phone ?? '' : '',
    },
  })

  // Authority state — 'off' (flag off / create), 'loading', 'owner' (read-only),
  // or 'ready' (editable role + toggles).
  const [permsState, setPermsState] = useState<'off' | 'loading' | 'owner' | 'ready'>(
    RBAC_ENABLED && mode === 'edit' ? 'loading' : 'off',
  )
  const [role, setRole] = useState<PermissionRole>('practitioner')
  const [caps, setCaps] = useState<Set<Capability>>(new Set())

  const staffId = staff?.id
  useEffect(() => {
    if (!(RBAC_ENABLED && mode === 'edit' && staffId)) return
    let cancelled = false
    getStaffPermissions(staffId).then((res) => {
      if (cancelled) return
      if ('error' in res) {
        setPermsState('off')
        return
      }
      if (res.isOwner) {
        setPermsState('owner')
        return
      }
      setRole(res.permissionRole === 'owner' ? 'practitioner' : res.permissionRole)
      setCaps(new Set(res.capabilities))
      setPermsState('ready')
    })
    return () => {
      cancelled = true
    }
  }, [mode, staffId])

  function onRoleChange(next: PermissionRole) {
    setRole(next)
    setCaps(new Set(presetCapabilities(next))) // role reset → toggles default to its preset
  }
  function toggleCap(c: Capability) {
    setCaps((prev) => {
      const n = new Set(prev)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })
  }

  async function onSubmit(data: StaffProfileInput) {
    try {
      if (mode === 'create') {
        await createStaff(data)
        toast.success(ts('staffAdded'))
      } else if (mode === 'edit' && staff) {
        await updateStaff(staff.id, data)
        if (permsState === 'ready') {
          const res = await setStaffPermissions(staff.id, role, [...caps])
          if ('error' in res) {
            toast.error(res.error) // keep the dialog open so they can adjust
            return
          }
        }
        toast.success(ts('staffUpdated'))
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('somethingWentWrong'))
    }
  }

  const titleText = mode === 'edit' ? ts('editStaffDialogTitle') : ts('addStaffMember')
  const subtitleText =
    mode === 'edit' && staff ? ts('editStaffDialogSubtitle', { name: staff.name }) : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base font-semibold">
            <Pencil className="size-4 text-muted-foreground" aria-hidden />
            {titleText}
          </DialogTitle>
          {subtitleText && (
            <DialogDescription className="text-sm leading-relaxed">{subtitleText}</DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* 氏名 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-name" className="text-sm font-medium">
              {tc('name')} <span className="text-destructive">*</span>
            </label>
            <Input id="staff-name" type="text" placeholder={ts('fullName')} aria-invalid={!!errors.name} autoComplete="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          {/* メールアドレス */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-email" className="text-sm font-medium">
              {tc('email')} <span className="text-destructive">*</span>
            </label>
            <Input id="staff-email" type="email" placeholder="staff@example.com" aria-invalid={!!errors.email} autoComplete="email" {...register('email')} />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{ts('emailChangeNotice')}</p>
            )}
          </div>

          {/* 役職 (job-title label) */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-position" className="text-sm font-medium">{ts('position')}</label>
            <PositionSelect register={register} defaultValue={mode === 'edit' ? staff?.position ?? '' : ''} />
          </div>

          {/* Authority — role preset + capability toggles (what they can DO) */}
          {permsState !== 'off' && (
            <div className="flex flex-col gap-2 border-t border-border/40 pt-4">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">{tp('roleLabel')}</span>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">{tp('roleHint')}</p>

              {permsState === 'loading' && (
                <p className="text-xs text-muted-foreground">{tc('loading')}</p>
              )}

              {permsState === 'owner' && (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                  {tp('ownerFullAccess')}
                </div>
              )}

              {permsState === 'ready' && (
                <>
                  <select
                    value={role}
                    onChange={(e) => onRoleChange(e.target.value as PermissionRole)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{tp(`role_${r}`)}</option>
                    ))}
                  </select>

                  <div className="mt-1 flex max-h-52 flex-col gap-2 overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {tp('permissionsLabel')}
                    </p>
                    {CAPABILITIES.map((c) => (
                      <label key={c} className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                        <span className="text-foreground/90">{tp(`cap_${c.replace('.', '_')}`)}</span>
                        <input
                          type="checkbox"
                          checked={caps.has(c)}
                          onChange={() => toggleCap(c)}
                          className="size-4 shrink-0 accent-sky-600"
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-col gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? tc('saving') : tc('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="w-full">
              {tc('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PositionSelect({
  register,
  defaultValue,
}: {
  register: UseFormRegister<StaffProfileInput>
  defaultValue: string
}) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const isCustom = defaultValue && !POSITION_OPTIONS.includes(defaultValue)
  const [showCustom, setShowCustom] = useState(isCustom)

  if (showCustom) {
    return (
      <div className="flex gap-2">
        <Input id="staff-position" type="text" placeholder={ts('enterPosition')} {...register('position')} />
        <button type="button" onClick={() => setShowCustom(false)} className="shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground">
          {tc('list')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <select
        id="staff-position"
        {...register('position')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">{ts('selectPosition')}</option>
        {POSITION_OPTIONS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button type="button" onClick={() => setShowCustom(true)} className="shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground" title={tc('custom')}>
        {tc('custom')}
      </button>
    </div>
  )
}
