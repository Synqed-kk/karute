'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { BusinessProfile, ConsultationQuestion } from '@/lib/welcome/business-types'
import { AIPageHeader, type DataScopeItem } from './AIPageHeader'
import { BusinessProfileHint } from './BusinessProfileHint'
import { PromptTemplateCard } from './PromptTemplateCard'
import { MessageBubble, type AIMessage } from './MessageBubble'
import { AIInputBar } from './AIInputBar'

interface AIAssistantViewProps {
  scope: DataScopeItem[]
  profile: BusinessProfile | null
  prompts: ConsultationQuestion[]
  userName: string
  userInitials: string
  locale: string
}

function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function AIAssistantView({
  scope,
  profile,
  prompts,
  userName,
  userInitials,
  locale,
}: AIAssistantViewProps) {
  const t = useTranslations('askAi')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, loading])

  async function send() {
    const value = input.trim()
    if (!value || loading) return
    const ts = nowHHMM()
    const userMsg: AIMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: value,
      timestamp: ts,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await getDataPort().apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: value,
          locale,
          history: messages.map((m) => ({
            role: m.role === 'ai' ? 'assistant' : 'user',
            content: m.text,
          })),
        }),
      })
      const data = (await res.json()) as { reply?: string }
      // Non-ok responses and missing replies fall through to the (translated)
      // error bubble — previously they rendered hardcoded English filler.
      const reply = data.reply
      if (!res.ok || typeof reply !== 'string') throw new Error(`HTTP ${res.status}`)
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'ai',
          text: reply,
          timestamp: nowHHMM(),
          // Citations are stubbed — the current /api/ai/chat doesn't return
          // grounded-row citations. Will populate when RAG retrieval lands.
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'ai',
          text: t('error'),
          timestamp: nowHHMM(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 pb-0 md:p-6 md:pb-0">
      <AIPageHeader scope={scope} />
      <BusinessProfileHint profile={profile} />

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Recommended prompts</h2>
        {profile && (
          <span className="text-[11px] text-muted-foreground">
            Tuned for {profile.label}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {prompts.map((p) => (
          <PromptTemplateCard
            key={p.id}
            template={p}
            onPick={(example) => setInput(example)}
          />
        ))}
      </div>

      <h2 className="text-sm font-semibold text-foreground">Conversation</h2>
      <div className="flex flex-col gap-5 pb-2">
        {messages.length === 0 && !loading ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-xs text-muted-foreground">
            Tap a prompt above or type your own question to start a conversation.
          </p>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                userInitials={userInitials}
                userName={userName}
              />
            ))}
            {loading && (
              <MessageBubble
                message={{
                  id: 'thinking',
                  role: 'ai',
                  text: 'Thinking through your business data…',
                  timestamp: nowHHMM(),
                }}
                userInitials={userInitials}
                userName={userName}
              />
            )}
          </>
        )}
        <div ref={scrollRef} />
      </div>

      <AIInputBar
        value={input}
        onChange={setInput}
        onSend={send}
        disabled={loading}
      />
    </div>
  )
}
