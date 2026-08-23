'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useDebouncedCallback } from 'use-debounce'
import { Search } from 'lucide-react'

interface CustomerSearchInputProps {
  initialQuery: string
}

export function CustomerSearchInput({ initialQuery }: CustomerSearchInputProps) {
  const t = useTranslations('customers.search')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initialQuery)
  // The value this box last wrote to the URL. When initialQuery changes to
  // exactly that, it's our own debounced replace echoing back — keep local
  // state and focus. Anything else is external navigation (back/forward,
  // deep link) → re-seed so the box never shows a term the list isn't
  // filtered by.
  const lastWritten = useRef(initialQuery)

  const apply = useDebouncedCallback((v: string) => {
    const q = v.trim()
    lastWritten.current = q
    const params = new URLSearchParams(searchParams.toString())
    if (q) params.set('query', q)
    else params.delete('query')
    params.delete('page')
    const next = params.toString()
    router.replace(next ? `${pathname}?${next}` : pathname)
  }, 250)

  // A debounced write still pending from typing must not fire after an
  // external navigation — it would overwrite the restored URL with the
  // stale term.
  useEffect(() => {
    if (initialQuery !== lastWritten.current) {
      apply.cancel()
      lastWritten.current = initialQuery
      setValue(initialQuery)
    }
  }, [initialQuery, apply])

  return (
    <label className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 focus-within:border-sky-500">
      <Search size={16} className="text-muted-foreground" />
      <input
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => {
          setValue(e.target.value)
          apply(e.target.value)
        }}
        placeholder={t('placeholder')}
        className="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
      />
    </label>
  )
}
