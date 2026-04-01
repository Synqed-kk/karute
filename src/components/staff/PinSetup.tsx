'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { setStaffPin, removeStaffPin } from '@/actions/staff-pin'
import { PinPad } from './PinPad'

interface PinSetupProps {
  staffId: string
  staffName: string
  hasPin: boolean
  onClose: () => void
}

type Phase = 'enter' | 'confirm'

export function PinSetup({ staffId, staffName, hasPin, onClose }: PinSetupProps) {
  const t = useTranslations('pin')
  const [phase, setPhase] = useState<Phase>('enter')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(pin: string) {
    if (phase === 'enter') {
      setFirstPin(pin)
      setPhase('confirm')
      setError(null)
      return
    }

    // Confirm phase
    if (pin !== firstPin) {
      setError(t('pinsDoNotMatch'))
      setPhase('enter')
      setFirstPin('')
      return
    }

    setLoading(true)
    const result = await setStaffPin(staffId, pin)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    toast.success(hasPin ? t('pinUpdated', { name: staffName }) : t('pinSet', { name: staffName }))
    onClose()
  }

  async function handleRemove() {
    setLoading(true)
    const result = await removeStaffPin(staffId)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(t('pinRemoved', { name: staffName }))
    onClose()
  }

  const title = phase === 'enter'
    ? t('setNewPin', { name: staffName })
    : t('confirmPin')

  return (
    <>
      <PinPad
        key={phase}
        title={title}
        onSubmit={handleSubmit}
        onCancel={onClose}
        error={error}
        loading={loading}
      />
      {/* Remove PIN option — shown in enter phase if PIN already exists */}
      {hasPin && phase === 'enter' && (
        <div className="fixed inset-x-0 bottom-[calc(50%-200px)] z-[71] flex justify-center">
          <button
            type="button"
            onClick={handleRemove}
            disabled={loading}
            className="rounded-lg bg-red-500/10 px-4 py-2 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors"
          >
            {t('removePin')}
          </button>
        </div>
      )}
    </>
  )
}
