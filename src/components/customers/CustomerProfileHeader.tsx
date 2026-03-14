'use client'

import { useState } from 'react'
import { Phone, Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CustomerInlineEdit } from '@/components/customers/CustomerInlineEdit'
import { getAvatarColor, getInitials } from '@/lib/customers/utils'
import type { Customer } from '@/types/database'

interface CustomerProfileHeaderProps {
  customer: Customer
  visitCount: number
  lastVisit: string | null
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function CustomerProfileHeader({
  customer,
  visitCount,
  lastVisit,
}: CustomerProfileHeaderProps) {
  const t = useTranslations('customers')
  const [isEditing, setIsEditing] = useState(false)

  const avatarColor = getAvatarColor(customer.id)
  const initials = getInitials(customer.name)

  if (isEditing) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <CustomerInlineEdit
          customer={customer}
          onSave={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-start gap-4">
        {/* Large initials avatar */}
        <div
          className={`size-16 shrink-0 rounded-full flex items-center justify-center text-xl font-semibold ${avatarColor.bg} ${avatarColor.text}`}
        >
          {initials}
        </div>

        {/* Name and contact info */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">{customer.name}</h1>
          {customer.furigana && (
            <p className="text-sm text-muted-foreground mt-0.5">{customer.furigana}</p>
          )}

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="size-3.5 shrink-0" />
              <span>{customer.phone ?? '-'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-3.5 shrink-0" />
              <span>{customer.email ?? '-'}</span>
            </div>
          </div>
        </div>

        {/* Visit stats and Edit button */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            {t('profile.edit')}
          </Button>

          <div className="text-right mt-1">
            <p className="text-sm font-medium">
              {t('profile.visits', { count: visitCount })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lastVisit
                ? t('profile.lastVisit', { date: formatDate(lastVisit) })
                : t('profile.noVisits')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
