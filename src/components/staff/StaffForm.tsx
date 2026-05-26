'use client'

// SPIKE-ALIGNED REWRITE — was a wide 2-column dialog with avatar +
// phone field that looked cramped on mobile (Liam called it "a mess").
// Now matches the design spike's clean edit-staff dialog:
//
//   ✏️  スタッフ情報を編集
//   {name}さんの情報を更新します。変更内容は監査ログに記録されます。
//   ─────────────────────────────────────────
//   氏名 *
//   [Jon Chan]
//
//   メールアドレス *
//   [chanjm20@gmail.com]
//   変更するとメール確認が必要になります。
//
//   役職
//   [オーナー ▾]
//
//   ──────────
//   [        保存        ]
//   [      キャンセル      ]
//
// Spike source: spike/src/components/settings/StaffActionDialogs.tsx
// (the EditStaffDialog component inside).
//
// Single-column, sm:max-w-md (narrower than max-w-3xl), full-width
// stacked Save/Cancel buttons on mobile. Avatar editing happens on
// the row's avatar circle (existing wiring preserved) — not in
// this dialog. Phone field intentionally NOT included; the spike
// keeps the edit dialog scoped to identity + contact email + role.
// If we need to edit phone, that's a separate field row on the
// row card (which already shows it on the right side of the list).
//
// All existing server actions preserved:
//   - createStaff(input)
//   - updateStaff(id, input)
// Phone defaults to empty string in the payload to satisfy the
// existing zod schema's `.optional().or(z.literal(''))` shape.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, type UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
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
      // Phone preserved on submit even though it's not edited in this
      // dialog — keeps existing values intact rather than wiping them.
      phone: mode === 'edit' ? staff?.phone ?? '' : '',
    },
  })

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

  const titleText =
    mode === 'edit'
      ? ts('editStaffDialogTitle')
      : ts('addStaffMember')
  const subtitleText =
    mode === 'edit' && staff
      ? ts('editStaffDialogSubtitle', { name: staff.name })
      : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base font-semibold">
            <Pencil className="size-4 text-muted-foreground" aria-hidden />
            {titleText}
          </DialogTitle>
          {subtitleText && (
            <DialogDescription className="text-sm leading-relaxed">
              {subtitleText}
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          {/* 氏名 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-name" className="text-sm font-medium">
              {tc('name')} <span className="text-destructive">*</span>
            </label>
            <Input
              id="staff-name"
              type="text"
              placeholder={ts('fullName')}
              aria-invalid={!!errors.name}
              autoComplete="name"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* メールアドレス */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-email" className="text-sm font-medium">
              {tc('email')} <span className="text-destructive">*</span>
            </label>
            <Input
              id="staff-email"
              type="email"
              placeholder="staff@example.com"
              aria-invalid={!!errors.email}
              autoComplete="email"
              {...register('email')}
            />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ts('emailChangeNotice')}
              </p>
            )}
          </div>

          {/* 役職 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-position" className="text-sm font-medium">
              {ts('position')}
            </label>
            <PositionSelect
              register={register}
              defaultValue={mode === 'edit' ? staff?.position ?? '' : ''}
            />
          </div>

          {/* Footer — stacked buttons on mobile, side-by-side on desktop.
           *  Primary action at top so thumb-reach hits 保存 first on mobile
           *  (matches the spike's stack order). */}
          <div className="mt-2 flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? tc('saving') : tc('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full"
            >
              {tc('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Position selector — matches the spike's pattern of a curated
// dropdown with a "カスタム" escape hatch for non-standard titles.
// Same wiring as before; just narrower (single column, no flex gap).
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
        <Input
          id="staff-position"
          type="text"
          placeholder={ts('enterPosition')}
          {...register('position')}
        />
        <button
          type="button"
          onClick={() => setShowCustom(false)}
          className="shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
        >
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
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setShowCustom(true)}
        className="shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
        title={tc('custom')}
      >
        {tc('custom')}
      </button>
    </div>
  )
}
