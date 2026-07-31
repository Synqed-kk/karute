'use client'

import { getDataPort } from '@/lib/ports/data-port'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'

import { useEffect, useRef, useState } from 'react'
import { Clock, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { BusinessProfile, ConsultationQuestion } from '@/lib/welcome/business-types'
import type { ContextHint, TodaySignal } from '@/lib/karute/ai-signals'
import { AIPageHeader, type DataScopeItem } from './AIPageHeader'
import { BusinessProfileHint } from './BusinessProfileHint'
import { PromptTemplateCard } from './PromptTemplateCard'
import { SignalChips, TunedPromptPill } from './SignalChips'
import { MessageBubble, type AIMessage } from './MessageBubble'
import { AIInputBar } from './AIInputBar'

interface AIAssistantViewProps {
  scope: DataScopeItem[]
  profile: BusinessProfile | null
  prompts: ConsultationQuestion[]
  signals: TodaySignal[]
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
  signals,
  locale,
}: AIAssistantViewProps) {
  const t = useTranslations('askAi')
  const router = useRouter()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, loading])

  // `text`/`contextHint` are supplied when a signal chip fires; otherwise the
  // composer's current value is sent with no hint (byte-identical to before).
  async function send(text?: string, contextHint?: ContextHint) {
    const value = (text ?? input).trim()
    if (!value || loading) return
    const userMsg: AIMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: value,
      timestamp: nowHHMM(),
    }
    setMessages((prev) => [...prev, userMsg])
    if (text === undefined) setInput('')
    setLoading(true)

    try {
      // aiBase seam (F-9b): '/api/ai' on web, '/api/app/v1/ai' in the shell —
      // the cookie-only web route 401s on the Bearer path.
      const res = await getDataPort().apiFetch(`${getRecordingPipelinePort().aiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: value,
          locale,
          ...(contextHint ? { context_hint: contextHint } : {}),
          history: messages.map((m) => ({
            role: m.role === 'ai' ? 'assistant' : 'user',
            content: m.text,
          })),
        }),
      })
      const data = (await res.json()) as { reply?: string; context_label?: string }
      const reply = data.reply
      if (!res.ok || typeof reply !== 'string') throw new Error(`HTTP ${res.status}`)
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'ai',
          text: reply,
          timestamp: nowHHMM(),
          contextLabel: data.context_label,
          copyable: true,
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

  const hasSignals = signals.length > 0

  const tunedMeta = profile && (
    <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>
        {t('profileHint.tunedFor')}
        {profile.label}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => router.push('/settings')}
        className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-600 dark:text-amber-300"
        title={t('profileHint.changeTitle')}
      >
        <Settings size={11} />
        {t('profileHint.change')}
      </button>
    </span>
  )

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 pb-0 md:p-6 md:pb-0">
      <AIPageHeader scope={scope} />
      {!profile && <BusinessProfileHint profile={null} />}

      {hasSignals ? (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              <Clock size={16} className="text-amber-600 dark:text-amber-400" />
              {t('todayHints')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('todayHintsHint')}</p>
          </div>
          <SignalChips
            signals={signals}
            onPick={(s) => send(s.prompt, s.contextHint)}
          />

          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-foreground">
                {t('deepConsult')}
              </span>
              {tunedMeta}
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible [&::-webkit-scrollbar]:hidden">
              {prompts.map((p) => (
                <TunedPromptPill
                  key={p.id}
                  template={p}
                  onPick={(example) => setInput(example)}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {t('deepConsult')}
            </h2>
            {tunedMeta}
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
        </>
      )}

      <h2 className="text-sm font-semibold text-foreground">{t('conversation')}</h2>
      <div className="flex flex-col gap-5 pb-2">
        {messages.length === 0 && !loading ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-xs text-muted-foreground">
            {t('startHint')}
          </p>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {loading && (
              <MessageBubble
                message={{
                  id: 'thinking',
                  role: 'ai',
                  text: t('thinking'),
                  timestamp: nowHHMM(),
                }}
              />
            )}
          </>
        )}
        <div ref={scrollRef} />
      </div>

      <AIInputBar
        value={input}
        onChange={setInput}
        onSend={() => send()}
        disabled={loading}
      />
    </div>
  )
}
