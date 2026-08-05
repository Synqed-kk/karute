'use client'

import { useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface AIInputBarProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled?: boolean
}

export function AIInputBar({ value, onChange, onSend, disabled }: AIInputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const t = useTranslations('askAi')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) onSend()
    }
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/80 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-foreground">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t('inputPlaceholder')}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!value.trim() || disabled}
          aria-label={t('sendAria')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </div>
      <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
        {t('inputHint')}
      </div>
    </div>
  )
}
