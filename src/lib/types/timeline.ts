export type TimelineType =
  | 'VISIT'
  | 'TREATMENT'
  | 'NOTE'
  | 'PHOTO'
  | 'FORM'
  | 'CONTACT'
  | 'IMPORT'
  | 'MILESTONE'
  | 'STATUS_CHANGE'

export interface TimelineEventData {
  id: string
  type: TimelineType
  title: string
  body?: string | null
  data?: Record<string, unknown>
  source?: string | null
  refId?: string | null
  occurredAt: string
  createdAt: string
}
