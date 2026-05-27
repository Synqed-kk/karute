'use client'

import { useTranslations } from 'next-intl'
import { Mic } from 'lucide-react'
import type { StaffMember } from '@/lib/staff'
import { StaffList } from '@/components/staff/StaffList'

interface StaffSectionProps {
  staffList: StaffMember[]
  activeStaffId: string | null
  isOwner: boolean
}

export function StaffSection({
  staffList,
  activeStaffId,
  isOwner,
}: StaffSectionProps) {
  const t = useTranslations('settings')

  // No own `<h3>スタッフ管理</h3>` title — the SettingsShell's DrillInView
  // (mobile) and SectionPanel (desktop) already render the section
  // heading with icon. Adding another here is what caused the triple
  // "スタッフ管理" / "スタッフ管理" / "スタッフメンバー" stack Liam called out.
  // StaffList owns its own "スタッフメンバー" header row (with the +追加
  // button on the right, matching the spike's pattern).
  return (
    <div className="space-y-6">
      <StaffList
        staffList={staffList}
        activeStaffId={activeStaffId}
        currentUserId={activeStaffId}
        isOwner={isOwner}
      />

      <div className="border-t border-border/30 pt-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-card/40 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('enrollVoice')}</p>
              <p className="text-xs text-muted-foreground">
                {t('voiceEnrollmentSoon')}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled
            title={t('voiceEnrollmentSoon')}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
          >
            {t('enrollVoice')}
          </button>
        </div>
      </div>
    </div>
  )
}
