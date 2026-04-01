'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useRouter } from '@/i18n/navigation'

export function MiniRecorder() {
  const t = useTranslations('miniRecorder')
  const { state, startedAt, pauseRecording, resumeRecording, stopRecording } = useGlobalRecorder()
  const pathname = usePathname()
  const router = useRouter()
  const [elapsed, setElapsed] = useState(() => startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0)

  const isOnSessionsPage = pathname.includes('/sessions')
  const isActive = state === 'recording' || state === 'paused'
  const show = isActive && !isOnSessionsPage

  useEffect(() => {
    if (state !== 'recording' || !startedAt) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [state, startedAt])

  if (!show) return null

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-2 rounded-full bg-red-500 text-white pl-4 pr-2 py-2 shadow-lg shadow-red-500/30">
        {/* Pulsing dot */}
        <div className="relative">
          <div className="h-3 w-3 rounded-full bg-white" />
          {state === 'recording' && (
            <div className="absolute inset-0 h-3 w-3 rounded-full bg-white animate-ping" />
          )}
        </div>

        {/* Timer */}
        <span className="text-sm font-mono font-semibold tabular-nums">{timeStr}</span>

        {/* State */}
        <span className="text-xs font-medium opacity-80">
          {state === 'paused' ? t('paused') : t('recording')}
        </span>

        {/* Pause/Resume */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); state === 'paused' ? resumeRecording() : pauseRecording() }}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
        >
          {state === 'paused' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="6,3 20,12 6,21" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          )}
        </button>

        {/* Stop */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); stopRecording(); router.push('/sessions' as Parameters<typeof router.push>[0]) }}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
        </button>

        {/* Go back */}
        <button
          type="button"
          onClick={() => router.push('/sessions' as Parameters<typeof router.push>[0])}
          className="text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity ml-1 pr-2"
        >
          {t('open')}
        </button>
      </div>
    </div>
  )
}
