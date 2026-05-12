import * as React from 'react'
import {
  AlertTriangle,
  Bell,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Clock,
  FileText,
  GraduationCap,
  Home,
  Mic,
  Plus,
  Search,
  Settings,
  Sparkles,
  Upload,
  Users,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

const ICONS = {
  alert: AlertTriangle,
  bell: Bell,
  calendar: Calendar,
  cap: GraduationCap,
  chevDown: ChevronDown,
  chevLeft: ChevronLeft,
  chevRight: ChevronRight,
  chevUp: ChevronUp,
  clipboard: Clipboard,
  clock: Clock,
  fileText: FileText,
  home: Home,
  mic: Mic,
  plus: Plus,
  search: Search,
  settings: Settings,
  sparkle: Sparkles,
  upload: Upload,
  users: Users,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName
}

export function Icon({ name, size = 16, strokeWidth = 1.75, ...props }: IconProps) {
  const Component = ICONS[name]
  return <Component size={size} strokeWidth={strokeWidth} aria-hidden {...props} />
}
