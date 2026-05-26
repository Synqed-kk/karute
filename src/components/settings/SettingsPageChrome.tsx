'use client'

import type { ReactNode } from 'react'
import { PageHeader } from '@synqed-kk/ui'

interface SettingsPageChromeProps {
  title: string
  children: ReactNode
}

export function SettingsPageChrome({ title, children }: SettingsPageChromeProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader title={title} />
      {children}
    </div>
  )
}
