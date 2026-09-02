'use client'

import type { ReactNode } from 'react'
import { PageHeader } from '@synqed-kk/ui'
import { SETTINGS_CONTENT_MAX_W } from './settings-frame'

interface SettingsPageChromeProps {
  title: string
  children: ReactNode
}

export function SettingsPageChrome({ title, children }: SettingsPageChromeProps) {
  return (
    <div className={`mx-auto ${SETTINGS_CONTENT_MAX_W} space-y-6 p-4 md:p-6`}>
      <PageHeader title={title} />
      {children}
    </div>
  )
}
