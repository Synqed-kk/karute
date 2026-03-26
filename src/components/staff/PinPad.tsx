'use client'

import { useState, useCallback } from 'react'

interface PinPadProps {
  /** Title shown above the dots */
  title: string
  /** Called when 4 digits are entered */
  onSubmit: (pin: string) => void
  onCancel: () => void
  /** Error message to display (e.g. "Wrong PIN") */
  error?: string | null
  /** Show loading state on submit */
  loading?: boolean
}

export function PinPad({ title, onSubmit, onCancel, error, loading }: PinPadProps) {
  const [digits, setDigits] = useState<string[]>([])

  const handleDigit = useCallback((d: string) => {
    setDigits((prev) => {
      if (prev.length >= 4) return prev
      const next = [...prev, d]
      if (next.length === 4) {
        // Auto-submit when 4 digits entered
        setTimeout(() => onSubmit(next.join('')), 100)
      }
      return next
    })
  }, [onSubmit])

  const handleBackspace = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1))
  }, [])

  const handleClear = useCallback(() => {
    setDigits([])
  }, [])

  const buttons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[320px] rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {/* Title */}
        <p className="text-center text-sm font-semibold text-foreground mb-4">{title}</p>

        {/* PIN dots */}
        <div className="flex justify-center gap-3 mb-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-colors ${
                digits[i]
                  ? 'bg-foreground border-foreground'
                  : 'border-muted-foreground/40 bg-transparent'
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-center text-xs text-red-500 mt-1 mb-1">{error}</p>
        )}

        {/* Loading */}
        {loading && (
          <p className="text-center text-xs text-muted-foreground mt-1 mb-1">Verifying...</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {buttons.map((btn) => {
            if (btn === 'clear') {
              return (
                <button
                  key={btn}
                  type="button"
                  onClick={handleClear}
                  disabled={loading}
                  className="flex h-14 items-center justify-center rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Clear
                </button>
              )
            }
            if (btn === 'back') {
              return (
                <button
                  key={btn}
                  type="button"
                  onClick={handleBackspace}
                  disabled={loading}
                  className="flex h-14 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/><path d="m14 9-4 4m0-4 4 4"/></svg>
                </button>
              )
            }
            return (
              <button
                key={btn}
                type="button"
                onClick={() => handleDigit(btn)}
                disabled={loading || digits.length >= 4}
                className="flex h-14 items-center justify-center rounded-xl text-lg font-semibold text-foreground hover:bg-muted active:bg-muted/80 transition-colors"
              >
                {btn}
              </button>
            )
          })}
        </div>

        {/* Cancel */}
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
