'use client'

import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'

interface KaruteSearchInputProps {
  value: string
  onChange: (value: string) => void
}

export function KaruteSearchInput({ value, onChange }: KaruteSearchInputProps) {
  const t = useTranslations('karuteList')
  return (
    <label className="flex h-11 items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5">
      <Search size={16} className="text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  )
}
