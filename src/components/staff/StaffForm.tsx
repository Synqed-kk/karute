'use client'

import { useState } from 'react'
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
import { createStaff, updateStaff } from '@/actions/staff'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

const POSITION_OPTIONS = [
  'Stylist',
  'Manager',
  'Assistant',
  'Therapist',
  'Esthetician',
  'Nail Technician',
  'Receptionist',
  'Teacher',
  'Trainer',
  'Doctor',
  'Nurse',
  'Other',
]

interface StaffFormProps {
  mode: 'create' | 'edit'
  staff?: { id: string; name: string; position?: string; email?: string; phone?: string }
  onClose: () => void
}

export function StaffForm({ mode, staff, onClose }: StaffFormProps) {
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

  async function onSubmit(data: StaffProfileInput) {
    try {
      if (mode === 'create') {
        await createStaff(data)
        toast.success('Staff member added.')
      } else if (mode === 'edit' && staff) {
        await updateStaff(staff.id, data)
        toast.success('Staff member updated.')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const title = mode === 'create' ? 'Add Staff Member' : 'Edit Staff Member'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                placeholder="Full name"
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Position</label>
              <PositionSelect register={register} defaultValue={mode === 'edit' ? (staff?.position ?? '') : ''} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="staff@example.com"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Phone</label>
              <Input
                type="tel"
                placeholder="090-1234-5678"
                {...register('phone')}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PositionSelect({ register, defaultValue }: { register: UseFormRegister<StaffProfileInput>; defaultValue: string }) {
  const isCustom = defaultValue && !POSITION_OPTIONS.includes(defaultValue)
  const [showCustom, setShowCustom] = useState(isCustom)

  if (showCustom) {
    return (
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Enter position..."
          {...register('position')}
        />
        <button
          type="button"
          onClick={() => setShowCustom(false)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2"
        >
          List
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <select
        {...register('position')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Select position...</option>
        {POSITION_OPTIONS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setShowCustom(true)}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2"
        title="Type custom position"
      >
        Custom
      </button>
    </div>
  )
}
