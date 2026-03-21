'use client'

import { useState } from 'react'
import { Phone, Mail, Calendar, AlertTriangle } from 'lucide-react'
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

function daysSinceLastVisit(dateStr: string): number {
  const last = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))
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

      {/* Additional details */}
      <div className="mt-4 pt-4 border-t border-border space-y-3">
        {/* Registration date */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="size-3.5 shrink-0" />
          <span>Registered {formatDate(customer.created_at)}</span>
        </div>

        {/* Churn risk alert */}
        {lastVisit && daysSinceLastVisit(lastVisit) > 90 && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Last visit was {daysSinceLastVisit(lastVisit)} days ago</span>
          </div>
        )}

        {/* Notes */}
        {customer.notes && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{customer.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
