import { z } from 'zod'

// ============================================================================
// Recording Upload
// ============================================================================

export const recordingUploadSchema = z.object({
  orgId: z.string().uuid('組織IDが無効です'),
  sessionId: z.string().uuid('セッションIDが無効です'),
  mimeType: z.string().regex(/^audio\//, 'オーディオ形式のみ対応しています'),
})

export type RecordingUploadInput = z.input<typeof recordingUploadSchema>

// ============================================================================
// Transcription Request
// ============================================================================

export const transcriptionRequestSchema = z.object({
  recordingSessionId: z.string().uuid('録音セッションIDが無効です'),
})

export type TranscriptionRequestInput = z.input<typeof transcriptionRequestSchema>

// ============================================================================
// Classification Request
// ============================================================================

export const classificationRequestSchema = z
  .object({
    recordingSessionId: z.string().uuid('録音セッションIDが無効です').optional(),
    transcript: z.string().min(1, '文字起こしテキストを入力してください').optional(),
    businessType: z.string().optional(),
  })
  .refine((data) => data.recordingSessionId || data.transcript, {
    message: 'recordingSessionId または transcript のどちらかが必要です',
  })

export type ClassificationRequestInput = z.input<typeof classificationRequestSchema>
