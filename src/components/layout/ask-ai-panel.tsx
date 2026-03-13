'use client'

import { useRef, useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, Sparkles, Loader2 } from 'lucide-react'
import { useAskAiPanel } from '@/components/providers/ask-ai-panel-provider'

const AI_ICON_PATH =
  'M12 3.2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 10.8c4.9 0 8.6 2.8 9.7 7.1.2.7-.3 1.3-1 1.3H3.3c-.7 0-1.2-.6-1-1.3C3.4 16.8 7.1 14 12 14Z'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const MOCK_RESPONSES_JA: Record<string, string> = {
  default:
    'ご質問ありがとうございます。現在、AIアシスタント機能は開発中です。近日中にカルテデータを活用した回答が可能になります。',
  カルテ:
    '山田太郎様の直近のカルテを確認しました。3月5日の施術では、肩甲骨周りの緊張が見られ、指圧とストレッチを中心に施術を行いました。',
  来店:
    '今月の来店数上位の顧客は以下の通りです：\n1. 佐藤花子様 - 4回\n2. 田中一郎様 - 3回\n3. 鈴木美咲様 - 3回',
}

const MOCK_RESPONSES_EN: Record<string, string> = {
  default:
    'Thank you for your question. The AI assistant feature is currently under development. Soon it will be able to provide answers using your karute data.',
  karute:
    "I've checked the most recent karute. The session on March 5th showed tension around the shoulder blades, and treatment focused on acupressure and stretching.",
  visits:
    'Top visitors this month:\n1. Customer A - 4 visits\n2. Customer B - 3 visits\n3. Customer C - 3 visits',
}

function getMockResponse(message: string, locale: string): string {
  const responses = locale === 'en' ? MOCK_RESPONSES_EN : MOCK_RESPONSES_JA
  for (const [keyword, response] of Object.entries(responses)) {
    if (keyword !== 'default' && message.toLowerCase().includes(keyword)) {
      return response
    }
  }
  return responses.default
}

function ChatUI() {
  const t = useTranslations('askAi')
  const locale = useLocale()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    await new Promise((resolve) => setTimeout(resolve, 1500))

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: getMockResponse(content, locale),
    }

    setMessages((prev) => [...prev, assistantMessage])
    setIsLoading(false)
    inputRef.current?.focus()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        <Sparkles className="h-4 w-4 text-teal-500" />
        <span className="text-sm font-semibold text-gray-700 dark:text-white/80">
          {t('title')}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Sparkles className="mb-3 h-8 w-8 text-gray-300 dark:text-white/20" />
            <p className="text-xs text-gray-400 dark:text-white/40">
              {t('emptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-teal-500 text-white'
                      : 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/80'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3 py-2 dark:bg-white/10">
                  <Loader2 className="h-3 w-3 animate-spin text-gray-400 dark:text-white/40" />
                  <span className="text-xs text-gray-400 dark:text-white/40">
                    {t('thinking')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 pb-4 pt-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('inputPlaceholder')}
          disabled={isLoading}
          className="h-9 flex-1 rounded-full border border-gray-200 bg-white px-3 text-xs text-gray-700 placeholder:text-gray-400 focus:border-teal-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:placeholder:text-white/30"
          autoFocus
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500 text-white transition hover:bg-teal-600 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}

export function AskAiPanelBackdrop() {
  const { open, setOpen } = useAskAiPanel()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40 rounded-[28px] bg-black/20 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setOpen(false)}
        />
      )}
    </AnimatePresence>
  )
}

export function AskAiPanel() {
  const { open, setOpen } = useAskAiPanel()
  const [introDone, setIntroDone] = useState(false)

  return (
    <AnimatePresence onExitComplete={() => setIntroDone(false)}>
      {open && (
        <motion.div
          className="absolute inset-y-0 left-full z-50 ml-2 flex w-[340px] flex-col overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-50 via-gray-100 to-slate-200 shadow-2xl dark:from-[#1a1a2e] dark:via-[#16213e] dark:to-[#0f3460]"
          initial={{ x: -40, opacity: 0, scale: 0.95 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: -40, opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        >
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/10 blur-[60px] dark:bg-teal-500/10" />
          </div>

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-20 rounded-full p-1.5 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Morph & Pulse intro */}
          {!introDone && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border-2 border-teal-400/40"
                  initial={{ width: 40, height: 40, opacity: 0.6 }}
                  animate={{ width: 300, height: 300, opacity: 0 }}
                  transition={{ duration: 1, delay: i * 0.15, ease: 'easeOut' }}
                />
              ))}
              <motion.div
                initial={{ opacity: 1, scale: 1, rotate: 0 }}
                animate={{ opacity: 0, scale: 0, rotate: 180 }}
                transition={{ delay: 0.25, duration: 0.4, ease: [0.76, 0, 0.24, 1] }}
                onAnimationComplete={() => setIntroDone(true)}
              >
                <svg className="h-12 w-12 text-teal-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d={AI_ICON_PATH} />
                </svg>
              </motion.div>
            </div>
          )}

          {/* Chat UI */}
          <motion.div
            className="relative z-10 flex h-full flex-col pt-10"
            initial={{ opacity: 0, scale: 0.3 }}
            animate={introDone ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <ChatUI />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
