import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronLeft } from 'lucide-react'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { StaffList } from '@/components/staff/StaffList'

export default async function SettingsPage() {
  const [staffList, activeStaffId, t] = await Promise.all([
    getStaffList(),
    getActiveStaffId(),
    getTranslations('settings'),
  ])

  return (
    <div className="space-y-8">
      <Link
        href={'/dashboard' as Parameters<typeof Link>[0]['href']}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Dashboard
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {/* Staff Members section */}
      <section className="space-y-4">
        <StaffList staffList={staffList} activeStaffId={activeStaffId} />
      </section>
    </div>
  )
}
