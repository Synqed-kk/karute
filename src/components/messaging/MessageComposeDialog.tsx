'use client'

// ─────────────────────────────────────────────────────────────
// MessageComposeDialog — AI draft + copy-paste workflow
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/components/messaging/MessageComposeDialog.tsx
// (~446 lines). Visual + flow preserved with two intentional
// differences:
//
//   • Channel picker → button group (no shadcn Select primitive
//     in karute; the button group is simpler + matches the
//     project's existing inline-toggle pattern). Same 4 channels:
//     LINE / SMS / Email / Other.
//   • Customer prop simplified to `{ id, name, initials }` —
//     the karute project's Customer shape is shallower than the
//     spike's mock, and the dialog only reads those three fields.
//
// WHY COPY-PASTE, NOT DIRECT SEND
// ────────────────────────────────
// Spike header comment lines 7-26 (preserved verbatim below for
// Anthony):
//
// SYNQED has a customers table. The store's LINE Official Account
// has a friends list (line_user_ids). There's no reliable way for
// the software to know which LINE friend IS a given customer —
// LINE doesn't expose phone numbers, display names are unreliable,
// and a wrong match sends Tanaka-san's private reminder to some
// other Misaki.
//
// Solving the linkage (QR-code self-identification flow, manual
// one-by-one pairing UI, fuzzy match with confirmation, etc.) is
// a multi-week project with real customer-facing rollout. It's a
// separate initiative, not a spike handover item.
//
// Copy-paste sidesteps the entire linkage problem: the STAFF is
// the linkage layer (they know which friend is Tanaka-san in their
// own LINE app). The software focuses on drafting the right
// message with the right context + logs the send for audit; the
// human handles delivery.
//
// FLOW
// ────
// 1. Dialog opens with AI-drafted body editable
// 2. Staff reviews + tweaks if needed
// 3. Staff picks the channel they'll send through (defaults to
//    LINE — JP salon norm)
// 4. Two primary actions:
//    - 「コピー」 — copies to clipboard, flashes confirmation,
//      stays open
//    - 「コピーして送信済みにする」 — copies + logs a message
//      record with markedSentAt set + auto-closes after 1.3s
// 5. A subtle "送信後にチェック" hint reminds staff that the log
//    doesn't observe delivery — they're asserting it.

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Sparkles,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useMessagingMutations } from '@/lib/customer-messaging/hooks'
import type {
  MessageChannel,
  MessageSource,
} from '@/lib/customer-messaging/types'

const SOFT_WARN_CHARS = 500

export interface MessageComposeCustomer {
  id: string
  name: string
  initials: string
}

interface MessageComposeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: MessageComposeCustomer | null
  /** Initial draft body — typically an AI-drafted preview. */
  initialBody?: string
  /** Default channel. Usually "line" for Japanese salons. */
  defaultChannel?: MessageChannel
  /** Tag the source so the log + audit row can distinguish origins. */
  source: MessageSource
  /** True when initialBody is AI-drafted. Surfaces an "AI draft" badge. */
  aiDrafted?: boolean
  /** Optional — links back to a dashboard AI action so it can
   *  auto-resolve when the staff hits "mark sent." */
  aiActionId?: string
  /** Called after a successful "copy + mark sent". Parent uses
   *  it for side-effects like dismissing the originating card. */
  onMarkedSent?: () => void
}

export function MessageComposeDialog({
  open,
  onOpenChange,
  customer,
  initialBody = '',
  defaultChannel = 'line',
  source,
  aiDrafted = false,
  aiActionId,
  onMarkedSent,
}: MessageComposeDialogProps) {
  const t = useTranslations('messageCompose')
  const locale = useLocale()
  const isEn = locale === 'en'
  const { logMessage } = useMessagingMutations()

  const [body, setBody] = useState(initialBody)
  const [channel, setChannel] = useState<MessageChannel>(defaultChannel)
  const [copyFlash, setCopyFlash] = useState<'idle' | 'copied'>('idle')
  const [done, setDone] = useState(false)

  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Reset on open — keeps draft separate per customer / per launch.
  useEffect(() => {
    if (open) {
      setBody(initialBody)
      setChannel(defaultChannel)
      setCopyFlash('idle')
      setDone(false)
    }
  }, [open, initialBody, defaultChannel])

  // Auto-close after the success panel.
  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => onOpenChange(false), 1300)
    return () => window.clearTimeout(id)
  }, [done, onOpenChange])

  const copyToClipboard = async (): Promise<boolean> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(body)
        return true
      }
    } catch {
      // Fall through to execCommand fallback.
    }
    try {
      const ta = bodyRef.current
      if (!ta) return false
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      return ok
    } catch {
      return false
    }
  }

  const handleCopyOnly = async () => {
    if (!canCopy) return
    const ok = await copyToClipboard()
    if (!ok) return
    setCopyFlash('copied')
    window.setTimeout(() => setCopyFlash('idle'), 1600)
  }

  const handleCopyAndMarkSent = async () => {
    if (!canCopy || !customer) return
    const ok = await copyToClipboard()
    if (!ok) return
    logMessage({
      customerId: customer.id,
      channel,
      body: body.trim(),
      source,
      aiDrafted,
      aiActionId,
      markSent: true,
    })
    onMarkedSent?.()
    setDone(true)
  }

  const canCopy = body.trim().length > 0 && !!customer
  const close = () => onOpenChange(false)
  const honorific = !isEn ? '様' : ''

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              {aiDrafted ? (
                <Sparkles className="size-3.5" aria-hidden />
              ) : (
                <MessageSquare className="size-3.5" aria-hidden />
              )}
            </span>
            {t('title')}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-[12px]">
            {customer ? (
              <>
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-gray-100 text-[9px] font-semibold text-gray-700 dark:bg-white/[0.06] dark:text-gray-300">
                  {customer.initials}
                </span>
                <span className="font-medium text-foreground/80">
                  {customer.name}
                </span>
                {honorific && (
                  <span className="text-muted-foreground">{honorific}</span>
                )}
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-muted-foreground">
                  {t('copyPasteHint')}
                </span>
              </>
            ) : (
              t('noCustomer')
            )}
          </DialogDescription>
        </DialogHeader>

        {!done && (
          <div className="space-y-3 py-1">
            {aiDrafted && (
              <div className="inline-flex h-6 items-center gap-1.5 rounded-full bg-blue-50 px-2 text-[11px] font-medium text-blue-800 ring-1 ring-blue-200/70 dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-500/20">
                <Sparkles className="size-3" aria-hidden />
                {t('aiDraftedBadge')}
              </div>
            )}

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
                if (copyFlash === 'copied') setCopyFlash('idle')
              }}
              placeholder={t('bodyPlaceholder')}
              rows={6}
              className="w-full resize-y rounded-md bg-card px-3 py-2 text-[14px] leading-relaxed text-foreground outline-none ring-1 ring-black/10 focus:ring-2 focus:ring-blue-400/40 dark:ring-white/15 dark:focus:ring-blue-400/30"
              autoFocus
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
              <span
                className={
                  body.length > SOFT_WARN_CHARS
                    ? 'text-amber-700 dark:text-amber-300'
                    : ''
                }
              >
                {t('charCount', { n: body.length })}
                {body.length > SOFT_WARN_CHARS && (
                  <span className="ml-1">{t('softLimitHint')}</span>
                )}
              </span>
              <ChannelPicker channel={channel} onChange={setChannel} t={t} />
            </div>

            <div className="flex items-start gap-2 rounded-md bg-blue-50/60 px-3 py-2 text-[11px] leading-relaxed text-blue-900 ring-1 ring-blue-200/70 dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-500/20">
              <ClipboardCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div>{t('workflowExplainer')}</div>
            </div>
          </div>
        )}

        {done && (
          <div className="flex flex-col items-center gap-2 py-6">
            <CheckCircle2
              className="size-10 text-green-600 dark:text-green-400"
              aria-hidden
            />
            <div className="text-[14px] font-semibold text-foreground">
              {t('markedSentTitle')}
            </div>
            <div className="max-w-[320px] text-center text-[11px] leading-relaxed text-muted-foreground">
              {t('markedSentDesc', { name: customer?.name ?? '' })}
            </div>
          </div>
        )}

        {!done && (
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyOnly}
              disabled={!canCopy}
              className="gap-1.5"
            >
              {copyFlash === 'copied' ? (
                <>
                  <CheckCircle2
                    className="size-3.5 text-green-600 dark:text-green-400"
                    aria-hidden
                  />
                  {t('copied')}
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden />
                  {t('copyOnly')}
                </>
              )}
            </Button>
            <Button
              onClick={handleCopyAndMarkSent}
              disabled={!canCopy}
              className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <ClipboardCheck className="size-3.5" aria-hidden />
              {t('copyAndMarkSent')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────
// Channel picker — 4-button toggle group
// ─────────────────────────────────────────────────────────────
// Spike used a shadcn Select primitive; karute doesn't have one
// installed. The 4-button group is simpler + matches the
// project's other inline toggle patterns (e.g., profile page
// language toggle, reservation Self/All filter).

function ChannelPicker({
  channel,
  onChange,
  t,
}: {
  channel: MessageChannel
  onChange: (c: MessageChannel) => void
  t: ReturnType<typeof useTranslations>
}) {
  const channels: Array<{
    id: MessageChannel
    label: string
    icon: React.ReactNode
  }> = [
    {
      id: 'line',
      label: 'LINE',
      icon: (
        <span className="inline-flex size-3.5 items-center justify-center rounded-sm bg-[#06C755] text-white">
          <MessageSquare className="size-2" aria-hidden />
        </span>
      ),
    },
    { id: 'sms', label: 'SMS', icon: <Phone className="size-3" aria-hidden /> },
    {
      id: 'email',
      label: t('channelEmail'),
      icon: <Mail className="size-3" aria-hidden />,
    },
    {
      id: 'other',
      label: t('channelOther'),
      icon: <MessageCircle className="size-3" aria-hidden />,
    },
  ]
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{t('channelLabel')}</span>
      <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-100 p-0.5 ring-1 ring-black/10 dark:bg-white/[0.04] dark:ring-white/15">
        {channels.map((c) => {
          const active = channel === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              aria-pressed={active}
              className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-card text-foreground shadow-sm dark:ring-1 dark:ring-white/10'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c.icon}
              {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
