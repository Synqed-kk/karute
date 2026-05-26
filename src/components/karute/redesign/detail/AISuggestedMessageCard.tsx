'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Edit3, MessageCircle, Send } from 'lucide-react'

import { MessageComposeDialog } from '@/components/messaging/MessageComposeDialog'
import type { MessageChannel } from '@/lib/customer-messaging/types'

export interface SuggestedMessage {
  channel: 'LINE' | 'Email' | 'SMS'
  body: string
}

interface AISuggestedMessageCardProps {
  customerName: string
  /** Customer id — needed so the compose dialog can scope the
   *  send-log row. When absent (older karutes without a linked
   *  customer), the Send + Edit buttons are disabled. */
  customerId?: string | null
  draft: SuggestedMessage | null
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const CHANNEL_MAP: Record<SuggestedMessage['channel'], MessageChannel> = {
  LINE: 'line',
  SMS: 'sms',
  Email: 'email',
}

export function AISuggestedMessageCard({
  customerName,
  customerId,
  draft,
}: AISuggestedMessageCardProps) {
  const t = useTranslations('karuteDetail.suggestedMessage')
  const [composeOpen, setComposeOpen] = useState(false)
  if (!draft) return null

  const customer = customerId
    ? { id: customerId, name: customerName, initials: deriveInitials(customerName) }
    : null
  const canCompose = customer !== null

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-sky-500/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          <MessageCircle size={14} className="text-sky-500" />
          <span>{t('title')}</span>
          <span className="ml-auto text-[12px] font-medium normal-case tracking-normal">
            <span>{customerName}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{t('scheduledVia')}</span>{' '}
            <span className="text-emerald-400">{draft.channel}</span>
          </span>
        </header>
        <div className="flex flex-col gap-3 p-5">
          <p className="text-[14px] leading-relaxed text-foreground/85">{draft.body}</p>
          <div className="mt-1 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              disabled={!canCompose}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Edit3 size={13} />
              <span>{t('edit')}</span>
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              disabled={!canCompose}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              <Send size={14} />
              <span>{t('approveSend')}</span>
            </button>
          </div>
        </div>
      </section>

      <MessageComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        customer={customer}
        initialBody={draft.body}
        defaultChannel={CHANNEL_MAP[draft.channel] ?? 'line'}
        source="karute_followup"
        aiDrafted
      />
    </>
  )
}
