'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useSession, type StaffItem } from '@/providers/session-provider'
import { setActiveStaff, clearActiveStaff } from '@/actions/active-staff'
import { hasStaffPin } from '@/actions/staff-pin'
import { PinPad } from './PinPad'
import { PinSetup } from './PinSetup'

type Phase = 'grid' | 'pin' | 'setpin'

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function StaffSwitcher({ onClose }: { onClose: () => void }) {
  const t = useTranslations('switcher')
  const { staffList, activeStaffId } = useSession()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('grid')
  const [selected, setSelected] = useState<StaffItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleTileClick(staff: StaffItem) {
    setSelected(staff)
    setError(null)
    setLoading(true)
    const has = await hasStaffPin(staff.id)
    setLoading(false)
    setPhase(has ? 'pin' : 'setpin')
  }

  async function handlePin(pin: string) {
    if (!selected) return
    setLoading(true)
    const r = await setActiveStaff(selected.id, pin)
    setLoading(false)
    if (r.ok) {
      onClose()
      router.refresh()
    } else {
      setError(t('incorrectPin'))
    }
  }

  async function handleSwitchOut() {
    await clearActiveStaff()
    onClose()
    router.refresh()
  }

  if (phase === 'pin' && selected) {
    return (
      <PinPad
        title={t('enterPinFor', { name: selected.name })}
        onSubmit={handlePin}
        onCancel={() => { setPhase('grid'); setError(null) }}
        error={error}
        loading={loading}
      />
    )
  }

  if (phase === 'setpin' && selected) {
    return (
      <PinSetup
        staffId={selected.id}
        staffName={selected.name}
        hasPin={false}
        onClose={() => { setPhase('pin'); setError(null) }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t('switchStaff')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Title */}
        <h2 className="mb-6 text-center text-lg font-semibold text-foreground">
          {t('switchStaff')}
        </h2>

        {/* Staff grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
          {staffList.map((staff) => {
            const isActive = staff.id === activeStaffId
            return (
              <button
                key={staff.id}
                type="button"
                onClick={() => handleTileClick(staff)}
                disabled={loading}
                className="flex flex-col items-center gap-2 rounded-xl p-3 transition-colors hover:bg-muted disabled:opacity-50"
              >
                {/* Avatar */}
                <div
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                    isActive
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                      : ''
                  } ${
                    staff.avatarUrl
                      ? ''
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {staff.avatarUrl ? (
                    <img
                      src={staff.avatarUrl}
                      alt={staff.name}
                      className="h-14 w-14 rounded-full object-cover"
                    />
                  ) : (
                    getInitials(staff.name)
                  )}
                  {isActive && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-primary" />
                  )}
                </div>

                {/* Name */}
                <span className="max-w-full truncate text-center text-xs font-medium text-foreground">
                  {staff.name}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleSwitchOut}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('switchOut')}
          </button>
        </div>
      </div>
    </div>
  )
}
