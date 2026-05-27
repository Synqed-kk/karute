'use client'

// LIFTED FROM SPIKE (simplified)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/AIOutreachCard.tsx
//
// AI-drafted follow-up message card. Always renders; shows an empty
// placeholder until Anthony wires the AI generator. Edit + Approve&Send
// buttons render but are stubbed (open Coming-Soon dialog) — replace
// the dialog with a real form + channel-send action when ready.
//
// CHANNEL STRATEGY (Liam's note):
//   The spike defaulted to LINE for the outreach channel. We're NOT
//   shipping a LINE integration in the first cut — Salesforce / SES
//   for email and Twilio for SMS are realistic; LINE Messaging API
//   requires a verified business account + per-recipient consent. The
//   simplest reliable path for now is "copy to clipboard" — staff
//   copies the AI draft and pastes it into whatever channel the
//   customer prefers (LINE, email, etc.). Email + SMS land as
//   automated channels once Anthony has the API keys.
//
// ANTHONY: see AI_PROMPTS.md §3 in the spike for the exact prompt
// template ("Outreach Message Draft"). Generator runs nightly on
// Sonnet from each customer's memory + most recent session record;
// result persisted on `karute_records.outreach_draft jsonb` or a
// separate `outreach_drafts` table.

import { useState } from 'react'
import { MessageSquare, Pencil, Send } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type OutreachChannel = 'sms' | 'email' | 'copy'

interface Props {
  customerName: string
  /** Channel that's expected to deliver the message. Defaults to
   *  'copy' (clipboard) since that's the simplest reliable path
   *  without API keys. */
  channel?: OutreachChannel
  /** AI-drafted message preview. Undefined = empty state. */
  preview?: string
}

export function AIOutreachCard({
  customerName,
  channel = 'copy',
  preview,
}: Props) {
  const t = useTranslations('karute.outreach')
  const [stubOpen, setStubOpen] = useState<'edit' | 'send' | null>(null)
  const isEmpty = !preview

  return (
    <>
      <div className="bg-card p-4 border-b border-black/5 dark:border-white/5 md:p-5 md:border-0 md:rounded-xl md:ring-1 md:ring-blue-100 md:dark:ring-blue-500/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:shadow-none">
        {/* Header */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <MessageSquare className="size-3.5" />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              {t('title')}
            </span>
          </div>
          <span className="truncate text-[11px] text-muted-foreground">
            {t('subscript', {
              customerName,
              channel: t(`channels.${channel}`),
            })}
          </span>
        </div>

        {/* Body — preview or empty state */}
        <div className="mb-4 rounded-lg bg-gray-50 p-3.5 dark:bg-white/[0.04]">
          {isEmpty ? (
            <p className="text-[12px] italic leading-relaxed text-muted-foreground">
              {t('emptyBody')}
            </p>
          ) : (
            <p className="text-[14px] leading-relaxed text-foreground/90">
              {preview}
            </p>
          )}
        </div>

        {/* Action buttons — disabled while empty */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isEmpty}
            onClick={() => setStubOpen('edit')}
            className="h-10 flex-1 gap-1.5"
          >
            <Pencil className="size-3.5" />
            {t('edit')}
          </Button>
          <Button
            size="sm"
            disabled={isEmpty}
            onClick={() => setStubOpen('send')}
            className="h-10 flex-1 gap-1.5 bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
          >
            <Send className="size-3.5" />
            {t('approveSend')}
          </Button>
        </div>
      </div>

      {/* Stubbed dialogs for edit + send. Replace with real flows
       *  when Anthony wires the AI generator + channel send. */}
      <Dialog
        open={stubOpen !== null}
        onOpenChange={(open) => !open && setStubOpen(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stubOpen === 'edit' ? t('edit') : t('approveSend')}
            </DialogTitle>
            <DialogDescription>
              {stubOpen === 'edit'
                ? t('comingSoonEdit')
                : t('comingSoonSend')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStubOpen(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
