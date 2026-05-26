'use client'

import { useState } from 'react'
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

  const apply = useDebouncedCallback((v: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (v.trim()) params.set('query', v.trim())
    else params.delete('query')
    params.delete('page')
    const next = params.toString()
    router.replace(next ? `${pathname}?${next}` : pathname)
  }, 250)

  return (
    <label className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 focus-within:border-sky-500">
      <Search size={16} className="text-muted-foreground" />
      <input
        type="text"
        value={value}
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
