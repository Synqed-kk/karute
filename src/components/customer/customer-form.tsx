'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createCustomerSchema, type CreateCustomerInput } from '@/lib/validations/customer'

interface CustomerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function CustomerForm({ open, onOpenChange, onSaved }: CustomerFormProps) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState<CreateCustomerInput>({
    name: '',
    nameKana: '',
    phone: '',
    email: '',
    notes: '',
  })

  useEffect(() => {
    if (!open) {
      setForm({ name: '', nameKana: '', phone: '', email: '', notes: '' })
      setErrors({})
    }
  }, [open])

  function updateField(field: keyof CreateCustomerInput, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})

    const result = createCustomerSchema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        const key = issue.path[0]
        if (key) fieldErrors[String(key)] = issue.message
      })
      setErrors(fieldErrors)
      return
    }

    setSaving(true)
    try {
      // TODO: replace with API call
      await new Promise((r) => setTimeout(r, 500))
      onOpenChange(false)
      onSaved?.()
    } catch {
      // TODO: surface error to user
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新規顧客</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">名前 *</Label>
            <Input
              id="name"
              placeholder="山田 花子"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              autoFocus
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nameKana">フリガナ</Label>
            <Input
              id="nameKana"
              placeholder="ヤマダ ハナコ"
              value={form.nameKana}
              onChange={(e) => updateField('nameKana', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">電話番号</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="090-1234-5678"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">メール</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@email.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">メモ</Label>
            <Textarea
              id="notes"
              placeholder="お客様に関するメモ..."
              rows={3}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
