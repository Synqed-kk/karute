'use client'

import { Sparkles } from 'lucide-react'
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
}

interface MessageBubbleProps {
  message: AIMessage
  userInitials: string
  userName: string
}

export function MessageBubble({
  message,
  userInitials,
  userName,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const t = useTranslations('askAi')
  return (
    <div
      className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          isUser
            ? 'bg-muted text-foreground'
            : 'bg-sky-500/15 text-sky-300'
        }`}
      >
        {isUser ? userInitials : <Sparkles size={12} />}
      </span>
      <div className={`flex max-w-[80%] flex-col gap-1.5 ${isUser ? 'items-end' : ''}`}>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={isUser ? 'text-foreground' : 'text-sky-300'}>
            {isUser ? userName : 'SYNQED AI'}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {message.timestamp}
          </span>
        </div>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? 'bg-sky-500 text-white'
              : 'bg-card text-foreground ring-1 ring-border'
          }`}
        >
          {message.text}
        </div>
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
