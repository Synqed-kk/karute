"use client"

import { cn } from "@/lib/utils"

export interface TranscriptSegment {
  text: string
  startTime: number
  endTime: number
  speakerLabel?: string | null
}

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
  className?: string
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function TranscriptPanel({ segments, className }: TranscriptPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card",
        className
      )}
    >
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-medium">文字起こし</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-3">
          {segments.map((segment, index) => (
            <div key={index} className="group text-sm">
              <div className="mb-0.5 flex items-center gap-2">
                {segment.speakerLabel && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      segment.speakerLabel === "スタッフ"
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {segment.speakerLabel}
                  </span>
                )}
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {formatTime(segment.startTime)}
                </span>
              </div>
              <p className="leading-relaxed text-foreground/80">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
