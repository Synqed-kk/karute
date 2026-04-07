'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, type UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { createStaff, updateStaff, uploadStaffAvatar } from '@/actions/staff'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

const POSITION_OPTIONS = [
  'Stylist', 'Manager', 'Assistant', 'Therapist', 'Esthetician',
  'Nail Technician', 'Receptionist', 'Teacher', 'Trainer', 'Doctor', 'Nurse', 'Other',
]

interface StaffFormProps {
  mode: 'create' | 'edit'
  staff?: { id: string; name: string; position?: string; email?: string; phone?: string; avatarUrl?: string }
  onClose: () => void
}

export function StaffForm({ mode, staff, onClose }: StaffFormProps) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(staff?.avatarUrl ?? null)
  const [uploading, setUploading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffProfileInput>({
    resolver: zodResolver(staffProfileSchema),
    defaultValues: {
      name: mode === 'edit' ? (staff?.name ?? '') : '',
      position: mode === 'edit' ? (staff?.position ?? '') : '',
      email: mode === 'edit' ? (staff?.email ?? '') : '',
      phone: mode === 'edit' ? (staff?.phone ?? '') : '',
    },
  })

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !staff?.id) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadStaffAvatar(staff.id, fd)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      setAvatarPreview(result.url)
      toast.success(ts('avatarUploaded'))
    }
    setUploading(false)
  }

  async function onSubmit(data: StaffProfileInput) {
    try {
      if (mode === 'create') {
        await createStaff(data)
        toast.success(ts('staffAdded'))
      } else if (mode === 'edit' && staff) {
        await updateStaff(staff.id, data)
        toast.success(ts('staffUpdated'))
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('somethingWentWrong'))
    }
  }

  const title = mode === 'create' ? ts('addStaffMember') : ts('editStaffMember')

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
          <div className={mode === 'edit' && staff ? 'flex gap-5' : ''}>
            {/* Avatar upload — left-aligned, side by side with inputs */}
            {mode === 'edit' && staff && (
              <label className="relative cursor-pointer group w-32 h-32 shrink-0">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-full w-full rounded-2xl object-cover" />
                ) : (
                  <div className="h-full w-full rounded-2xl bg-muted flex items-center justify-center text-3xl font-bold text-muted-foreground">
                    {(staff.name ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                {uploading && (
                  <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center">
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            )}

          {/* Form fields */}
          <div className="flex flex-1 flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  {tc('name')} <span className="text-destructive">*</span>
                </label>
                <Input type="text" placeholder={ts('fullName')} aria-invalid={!!errors.name} {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{ts('position')}</label>
                <PositionSelect register={register} defaultValue={mode === 'edit' ? (staff?.position ?? '') : ''} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{tc('email')}</label>
                <Input type="email" placeholder="staff@example.com" aria-invalid={!!errors.email} {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{tc('phone')}</label>
                <Input type="tel" placeholder="090-1234-5678" {...register('phone')} />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>{tc('cancel')}</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? tc('saving') : tc('save')}</Button>
            </DialogFooter>
          </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PositionSelect({ register, defaultValue }: { register: UseFormRegister<StaffProfileInput>; defaultValue: string }) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const isCustom = defaultValue && !POSITION_OPTIONS.includes(defaultValue)
  const [showCustom, setShowCustom] = useState(isCustom)

  if (showCustom) {
    return (
      <div className="flex gap-2">
        <Input type="text" placeholder={ts('enterPosition')} {...register('position')} />
        <button type="button" onClick={() => setShowCustom(false)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2">{tc('list')}</button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <select {...register('position')} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
        <option value="">{ts('selectPosition')}</option>
        {POSITION_OPTIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
      </select>
      <button type="button" onClick={() => setShowCustom(true)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2" title={tc('custom')}>{tc('custom')}</button>
    </div>
  )
}
