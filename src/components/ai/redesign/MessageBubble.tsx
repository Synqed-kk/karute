'use client'

import { useState } from 'react'
import { Check, Copy, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface AICitation {
  type: string
  label: string
}

export interface AIMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  timestamp: string
  citations?: AICitation[]
  /** 参照 note next to SYNQED AI — the server context_label when a chip pinned
   *  the slice (contracts #context-hint). Absent for free-form questions. */
  contextLabel?: string
  /** Real assistant replies show the 返答をコピー button; thinking/error don't. */
  copyable?: boolean
}

interface MessageBubbleProps {
  message: AIMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const t = useTranslations('askAi')
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op, honest silent failure */
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
        <Sparkles size={13} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            SYNQED AI
          </span>
          {message.contextLabel && (
            <span> · {t('reference', { label: message.contextLabel })}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap rounded-[4px_16px_16px_16px] border border-border bg-card px-3.5 py-3 text-sm text-foreground shadow-sm">
          {message.text}
        </div>
        {message.copyable && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{t('copyReply')}</span>
            </button>
          </div>
        )}
        {/* Dead citations path — never populated today (charter §4: stays as-is
            until RAG retrieval lands). */}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('sources')}
            </span>
            {message.citations.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px]"
              >
                <span className="text-muted-foreground">{c.type}</span>
                <span className="text-foreground">{c.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
