'use client'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export interface StaffMember {
  id: string
  name: string
}

// Phase 1 placeholder staff list — replaced with real Supabase data in Phase 5
const PLACEHOLDER_STAFF: StaffMember[] = [
  { id: 'staff-1', name: 'Yuki Tanaka' },
  { id: 'staff-2', name: 'Hana Sato' },
  { id: 'staff-3', name: 'Kenji Mori' },
]

interface StaffSelectorProps {
  selected: StaffMember | null
  onSelect: (staff: StaffMember) => void
  disabled?: boolean
}

export function StaffSelector({ selected, onSelect, disabled }: StaffSelectorProps) {
  return (
    <div className="flex gap-3 justify-center flex-wrap">
      {PLACEHOLDER_STAFF.map((staff) => (
        <button
          key={staff.id}
          onClick={() => onSelect(staff)}
          disabled={disabled}
          className={[
            'flex flex-col items-center gap-1 p-2 rounded-lg transition-colors',
            'hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed',
            selected?.id === staff.id
              ? 'ring-2 ring-green-500 bg-accent'
              : 'ring-1 ring-border',
          ].join(' ')}
        >
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-muted text-foreground text-sm">
              {staff.name.split(' ').map(n => n[0]).join('')}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground max-w-16 truncate">{staff.name}</span>
        </button>
      ))}
    </div>
  )
}
