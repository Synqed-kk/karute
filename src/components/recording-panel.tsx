'use client'
import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Mic, Square, Pause, Play } from 'lucide-react'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { useRecordingTimer } from '@/hooks/use-recording-timer'
import { StaffSelector, type StaffMember } from '@/components/staff-selector'

interface RecordingPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecordingComplete?: (blob: Blob, mimeType: string, staffMember: StaffMember) => void
}

export function RecordingPanel({ open, onOpenChange, onRecordingComplete }: RecordingPanelProps) {
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const {
    state,
    result,
    error,
    stream,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
  } = useMediaRecorder()

  // Waveform bars: active only during 'recording' — flat when idle or paused
  const bars = useWaveformBars(stream, state === 'recording')

  // Timer: runs only during 'recording' — freezes (does not reset) when paused
  const { formatted: timerDisplay } = useRecordingTimer(state === 'recording')

  function handleDiscard() {
    discardRecording()
  }

  function handleUseRecording() {
    if (result && selectedStaff) {
      onRecordingComplete?.(result.blob, result.mimeType, selectedStaff)
      onOpenChange(false)
      discardRecording()
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    // Prevent closing mid-recording or paused
    if (state === 'recording' || state === 'paused') return
    if (!nextOpen) {
      discardRecording()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="left"
        className="w-full max-w-md p-0 border-r border-border/50 bg-background"
      >
        <div className="rounded-2xl border border-border/50 bg-card/50 px-8 py-12 backdrop-blur-sm mx-4 my-6">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-center text-lg font-semibold">
              {state === 'idle' && 'New Recording'}
              {state === 'recording' && 'Recording in progress'}
              {state === 'paused' && 'Recording paused'}
              {state === 'recorded' && 'Recording complete'}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6">
            {/* Staff selector — shown in idle and recorded states */}
            {(state === 'idle' || state === 'recorded') && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center">Select staff member</p>
                <StaffSelector
                  selected={selectedStaff}
                  onSelect={setSelectedStaff}
                  disabled={state === 'recorded'}
                />
              </div>
            )}

            {/* Waveform: 30 CSS pill bars — shown during recording and paused states */}
            {(state === 'recording' || state === 'paused') && (
              <div className="flex flex-col items-center gap-4">
                {/* 30 pill bars — heights from useWaveformBars, flat at 8px when paused */}
                <div className="flex items-center justify-center gap-0.5 h-[100px]">
                  {bars.map((height, i) => (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-primary/40 transition-all duration-150 ease-out"
                      style={{ height: `${height}px` }}
                    />
                  ))}
                </div>

                {/* Timer: text-4xl font-light tracking-widest per CONTEXT spec */}
                <span className="text-4xl font-light tracking-widest font-mono tabular-nums text-foreground">
                  {timerDisplay}
                </span>
              </div>
            )}

            {/* Recorded state info */}
            {state === 'recorded' && result && (
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Recording captured</p>
                <p className="text-xs text-muted-foreground">
                  {(result.blob.size / 1024).toFixed(1)} KB · {result.mimeType.split(';')[0]}
                </p>
              </div>
            )}

            {/* Error message */}
            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}

            {/* Controls */}
            <div className="flex justify-center gap-3">
              {/* IDLE: Large round mic button (size-20 = 80px circle) */}
              {state === 'idle' && (
                <button
                  onClick={startRecording}
                  disabled={!selectedStaff}
                  aria-label="Start recording"
                  className={[
                    'size-20 rounded-full transition-all duration-200',
                    'flex items-center justify-center',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'hover:scale-105 active:scale-95',
                    selectedStaff
                      ? 'bg-green-600 hover:bg-green-500 shadow-lg shadow-green-900/50'
                      : 'bg-muted',
                  ].join(' ')}
                >
                  <Mic className="h-8 w-8 text-white" />
                </button>
              )}

              {/* RECORDING: Pause (outline, size-14) + Stop (destructive red, size-14) */}
              {state === 'recording' && (
                <>
                  <button
                    onClick={pauseRecording}
                    aria-label="Pause recording"
                    className="size-14 rounded-full border-2 border-border bg-transparent hover:bg-accent flex items-center justify-center transition-all duration-200"
                  >
                    <Pause className="h-6 w-6 text-foreground" />
                  </button>
                  <button
                    onClick={stopRecording}
                    aria-label="Stop recording"
                    className="size-14 rounded-full bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/50 flex items-center justify-center transition-all duration-200"
                  >
                    <Square className="h-6 w-6 text-white" />
                  </button>
                </>
              )}

              {/* PAUSED: Play (outline, size-14 — Pause flips to Play) + Stop (destructive red) */}
              {state === 'paused' && (
                <>
                  <button
                    onClick={resumeRecording}
                    aria-label="Resume recording"
                    className="size-14 rounded-full border-2 border-border bg-transparent hover:bg-accent flex items-center justify-center transition-all duration-200"
                  >
                    <Play className="h-6 w-6 text-foreground" />
                  </button>
                  <button
                    onClick={stopRecording}
                    aria-label="Stop recording"
                    className="size-14 rounded-full bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/50 flex items-center justify-center transition-all duration-200"
                  >
                    <Square className="h-6 w-6 text-white" />
                  </button>
                </>
              )}

              {/* RECORDED: Discard + Use Recording */}
              {state === 'recorded' && (
                <>
                  <Button variant="outline" onClick={handleDiscard}>
                    New Recording
                  </Button>
                  <Button
                    onClick={handleUseRecording}
                    disabled={!selectedStaff}
                    className="bg-green-600 hover:bg-green-500"
                  >
                    Upload
                  </Button>
                </>
              )}
            </div>

            {/* Staff requirement hint */}
            {state === 'idle' && !selectedStaff && (
              <p className="text-xs text-muted-foreground text-center">
                Select a staff member to start recording
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
