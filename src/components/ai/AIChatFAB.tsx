'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AIChatPanel } from './AIChatPanel'

export function AIChatFAB({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#5cbfcf] text-white shadow-lg shadow-[#5cbfcf]/30 transition-all hover:scale-105 hover:shadow-xl hover:shadow-[#5cbfcf]/40 active:scale-95 animate-in fade-in-0 zoom-in-50 duration-300"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && <AIChatPanel locale={locale} onClose={() => setOpen(false)} />}
    </>
  )
}
