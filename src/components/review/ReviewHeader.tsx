'use client'

import { Control, useController } from 'react-hook-form'

interface ReviewHeaderProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>
}

export function ReviewHeader({ control }: ReviewHeaderProps) {
  const { field } = useController({
    control,
    name: 'summary',
  })

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        AI Summary
      </label>
      <textarea
        {...field}
        rows={4}
        placeholder="AI-generated session summary..."
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:border-ring transition-colors leading-relaxed"
      />
    </div>
  )
}
