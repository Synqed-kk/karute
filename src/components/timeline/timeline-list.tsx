'use client'

import { TimelineEvent } from './timeline-event'
import type { TimelineEventData } from '@/lib/types/timeline'

interface TimelineListProps {
  events: TimelineEventData[]
  loading?: boolean
}

function groupByDate(events: TimelineEventData[]): { label: string; events: TimelineEventData[] }[] {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)

  const groups: Record<string, TimelineEventData[]> = {
    今日: [],
    昨日: [],
    今週: [],
    今月: [],
    それ以前: [],
  }

  for (const event of events) {
    const date = event.occurredAt.slice(0, 10)
    if (date === today) groups['今日'].push(event)
    else if (date === yesterday) groups['昨日'].push(event)
    else if (date >= weekAgo) groups['今週'].push(event)
    else if (date >= monthAgo) groups['今月'].push(event)
    else groups['それ以前'].push(event)
  }

  return Object.entries(groups)
    .filter(([, events]) => events.length > 0)
    .map(([label, events]) => ({ label, events }))
}

export function TimelineList({ events, loading }: TimelineListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p className="text-muted-foreground">イベントはまだありません</p>
      </div>
    )
  }

  const groups = groupByDate(events)

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <div className="relative space-y-1 border-l-2 border-border pl-4">
            {group.events.map((event) => (
              <TimelineEvent
                key={event.id}
                type={event.type}
                title={event.title}
                body={event.body}
                source={event.source}
                occurredAt={event.occurredAt}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
