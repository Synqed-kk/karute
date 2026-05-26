'use client'

// ─────────────────────────────────────────────────────────────
// StoreFormDialog — shared add + edit form
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: inline in StoresSettings.tsx (extracted).
// Two modes share one body: 'add' (blank fields) and
// 'edit' (pre-filled from a Store). Parent merges the result.
//
// ANTHONY contracts:
//   - Add path runs after AddStoreSubscriptionDialog has confirmed
//     the seat addition. Real impl: INSERT into `stores` table
//     scoped to the org.
//   - Edit path is a simple UPDATE — does NOT change subscription
//     quantity (rename / re-address only).
//
// Schema sketch from karute's existing TODO at StoresSection.tsx:
//   stores(id PK, business_id FK, name_ja, name_en, address,
//          phone, is_primary, active, created_at)

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import type { Store, StoreFormValues } from './types'

export type StoreFormMode =
  | null
  | { kind: 'add' }
  | { kind: 'edit'; store: Store }

interface StoreFormDialogProps {
  mode: StoreFormMode
  onClose: () => void
  onSave: (values: StoreFormValues) => void
}

export function StoreFormDialog({
  mode,
  onClose,
  onSave,
}: StoreFormDialogProps) {
  // Mirror the last non-null mode so close animations don't snap
  // to fallback copy. Same pattern as the spike's CustomerDataActionDialogs.
  const [lastMode, setLastMode] = useState<NonNullable<StoreFormMode> | null>(
    null,
  )
  if (mode !== null && mode !== lastMode) {
    setLastMode(mode)
  }
  const displayMode = mode ?? lastMode
  const key = displayMode?.kind === 'edit' ? `edit-${displayMode.store.id}` : 'add'

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      {displayMode !== null && (
        <StoreFormDialogBody
          key={key}
          mode={displayMode}
          isEdit={displayMode.kind === 'edit'}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  )
}

function StoreFormDialogBody({
  mode,
  isEdit,
  onClose,
  onSave,
}: {
  mode: NonNullable<StoreFormMode>
  isEdit: boolean
  onClose: () => void
  onSave: (values: StoreFormValues) => void
}) {
  const t = useTranslations('settings.stores.form')

  const initial = mode.kind === 'edit' ? mode.store : null
  const [name, setName] = useState(initial?.name ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [saved, setSaved] = useState(false)

  const canSave = name.trim().length > 0 && !saved

  const handleSave = () => {
    onSave({ name, address, phone })
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      onClose()
    }, 900)
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{isEdit ? t('editTitle') : t('addTitle')}</DialogTitle>
        <DialogDescription>
          {isEdit ? t('editDescription') : t('addDescription')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <Field label={t('storeName')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('storeNamePlaceholder')}
            autoFocus
          />
        </Field>
        <Field label={t('address')}>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('addressPlaceholder')}
          />
        </Field>
        <Field label={t('phone')}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03-0000-0000"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saved}>
          {t('cancel')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="bg-sage-800 hover:bg-sage-900"
        >
          {saved ? t('saved') : isEdit ? t('saveEdit') : t('save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
