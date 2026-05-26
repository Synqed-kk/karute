'use client'

import { useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ChevronDown,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Sun,
} from 'lucide-react'
import { upsertOrgSettings, type OrgSettings } from '@/actions/org-settings'
import {
  DEFAULT_THEME_COLORS,
  type ThemeColors,
} from '@/lib/theme'
import {
  useSidebarStyle,
  useSidebarStyleMutations,
  type SidebarStyle,
} from '@/lib/sidebar-style/hooks'

const BAR_COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'barOpen', label: 'Open' },
  { key: 'barBooking', label: 'Booking' },
  { key: 'barRecording', label: 'Recording' },
  { key: 'barCompleted', label: 'Completed' },
  { key: 'barBlocked', label: 'Blocked' },
  { key: 'barProcessing', label: 'Processing' },
]

/** Spike's BRAND_SWATCHES, identical hex values. Read-only
 *  display today — a future enhancement could let owners
 *  override individual swatches per business. */
const BRAND_SWATCHES = [
  { label: 'Primary', hex: '#1f2937' },
  { label: 'Accent', hex: '#2563eb' },
  { label: 'Success', hex: '#16a34a' },
  { label: 'Live', hex: '#ea580c' },
  { label: 'Warning', hex: '#eab308' },
  { label: 'Alert', hex: '#dc2626' },
  { label: 'Purple', hex: '#7c3aed' },
  { label: 'Background', hex: '#fafaf9' },
] as const

const SIDEBAR_OPTIONS: {
  key: SidebarStyle
  icon: typeof PanelLeft
  labelKey: string
  descriptionKey: string
}[] = [
  {
    key: 'light',
    icon: PanelLeft,
    labelKey: 'sidebarLightLabel',
    descriptionKey: 'sidebarLightDesc',
  },
  {
    key: 'dark',
    icon: PanelLeftClose,
    labelKey: 'sidebarDarkLabel',
    descriptionKey: 'sidebarDarkDesc',
  },
]

interface ThemeSectionProps {
  orgSettings: OrgSettings | null
  locale: string
}

export function ThemeSection({ orgSettings, locale }: ThemeSectionProps) {
  const t = useTranslations('settings')
  const router = useRouter()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const sidebarStyle = useSidebarStyle()
  const { setSidebarStyle } = useSidebarStyleMutations()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [colors, setColors] = useState<ThemeColors>({
    ...DEFAULT_THEME_COLORS,
    ...(orgSettings?.theme_colors ?? {}),
  })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleLanguageChange(next: string) {
    if (next === locale) return
    const segments = pathname.split('/')
    if (segments[1] === 'en' || segments[1] === 'ja') {
      segments[1] = next
      router.push(segments.join('/'))
    }
  }

  function handleColorChange(key: keyof ThemeColors, value: string) {
    const next = { ...colors, [key]: value }
    setColors(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      upsertOrgSettings({ theme_colors: next }).then((result) => {
        if ('error' in result) toast.error(result.error)
      })
    }, 800)
  }

  function resetColors() {
    setColors({ ...DEFAULT_THEME_COLORS })
    upsertOrgSettings({ theme_colors: { ...DEFAULT_THEME_COLORS } }).then(
      (result) => {
        if ('error' in result) toast.error(result.error)
        else toast.success(t('settingsSaved'))
      },
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('theme.label')}</h3>
        <p className="text-sm text-muted-foreground">{t('themeDescription')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('displayLanguage')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <LangButton
              active={locale === 'en'}
              onClick={() => handleLanguageChange('en')}
              label="English"
            />
            <LangButton
              active={locale === 'ja'}
              onClick={() => handleLanguageChange('ja')}
              label="日本語"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('displayLanguageDescription')}
          </p>
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('displayMode')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            <ModeButton
              icon={<Sun className="size-3.5" />}
              active={theme === 'light'}
              onClick={() => setTheme('light')}
              label={t('modeLight')}
            />
            <ModeButton
              icon={<Moon className="size-3.5" />}
              active={theme === 'dark'}
              onClick={() => setTheme('dark')}
              label={t('modeDark')}
            />
            <ModeButton
              icon={<Monitor className="size-3.5" />}
              active={theme === 'system' || !theme}
              onClick={() => setTheme('system')}
              label={t('modeSystem')}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('displayModeDescription')}
          </p>
        </div>
      </div>

      {/* Sidebar appearance picker — light vs dark. State persists
       *  to localStorage today (lib/sidebar-style/hooks.ts); when
       *  Anthony wires the real sidebar switch, the same hook drives
       *  conditional dark styling on <Sidebar/>. */}
      <div className="border-t border-border/30 pt-6">
        <div className="mb-2">
          <h4 className="text-sm font-medium">{t('sidebarAppearance')}</h4>
          <p className="text-xs text-muted-foreground">
            {t('sidebarAppearanceDesc')}
          </p>
        </div>
        <div className="grid max-w-xl grid-cols-2 gap-3">
          {SIDEBAR_OPTIONS.map((opt) => {
            const active = opt.key === sidebarStyle
            const Icon = opt.icon
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSidebarStyle(opt.key)}
                className={`rounded-lg border-2 p-3 text-left transition-all ${
                  active
                    ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 dark:bg-blue-500/10'
                    : 'border-gray-200 bg-card hover:border-gray-300 dark:border-white/10'
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className={`flex size-7 items-center justify-center rounded-md ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-400'
                    }`}
                  >
                    <Icon className="size-3.5" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t(opt.labelKey)}
                  </span>
                  {active && (
                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-blue-700 dark:text-blue-300">
                      {t('sidebarApplied')}
                    </span>
                  )}
                </div>
                <div className="mb-2.5 text-xs text-gray-500 dark:text-gray-400">
                  {t(opt.descriptionKey)}
                </div>
                <SidebarPreview variant={opt.key} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Brand color swatches — read-only display. Documents the
       *  brand palette so owners + design reviewers can reference
       *  the exact hex values. */}
      <div className="border-t border-border/30 pt-6">
        <div className="mb-2">
          <h4 className="text-sm font-medium">{t('brandColors')}</h4>
          <p className="text-xs text-muted-foreground">
            {t('brandColorsDesc')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {BRAND_SWATCHES.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <span
                className="size-9 rounded-md border border-gray-200 shadow-sm dark:border-white/10"
                style={{ backgroundColor: s.hex }}
                title={`${s.label}: ${s.hex}`}
              />
              <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                {s.hex}
              </span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/30 pt-6">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80"
        >
          <ChevronDown
            className={`size-4 transition-transform ${
              advancedOpen ? 'rotate-180' : ''
            }`}
          />
          {t('advancedTimelineColors')}
        </button>

        {advancedOpen && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t('themeDescription')}
              </p>
              <button
                type="button"
                onClick={resetColors}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                {t('resetToDefaults')}
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {BAR_COLOR_FIELDS.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-border/30 p-3"
                >
                  <label className="relative cursor-pointer">
                    <input
                      type="color"
                      value={colors[key] ?? DEFAULT_THEME_COLORS[key] ?? '#000000'}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <div
                      className="h-8 w-8 rounded-md border border-border shadow-sm"
                      style={{
                        backgroundColor:
                          colors[key] ?? DEFAULT_THEME_COLORS[key],
                      }}
                    />
                  </label>
                  <p className="text-xs font-medium truncate">{label}</p>
                </div>
              ))}
            </div>

            <div>
              <h4 className="text-xs font-semibold mb-2 text-muted-foreground">
                {t('preview')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {BAR_COLOR_FIELDS.map(({ key, label }) => (
                  <div
                    key={key}
                    className="rounded-full px-3 py-1 text-[10px] font-semibold text-white"
                    style={{
                      backgroundColor:
                        colors[key] ?? DEFAULT_THEME_COLORS[key],
                    }}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LangButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  )
}

function ModeButton({
  icon,
  active,
  onClick,
  label,
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

/** Visual mini-sidebar inside each picker tile — matches the
 *  spike's SidebarPreview component. Pure decorative SVG/HTML —
 *  not interactive. */
function SidebarPreview({ variant }: { variant: SidebarStyle }) {
  if (variant === 'light') {
    return (
      <div className="flex h-16 overflow-hidden rounded-md border border-gray-200 dark:border-white/10">
        <div className="w-14 space-y-1 border-r border-gray-200 bg-gray-50 p-1.5 dark:border-white/10 dark:bg-white/[0.04]">
          <div className="h-1.5 w-10 rounded-sm bg-gray-900" />
          <div className="space-y-0.5 pt-1">
            <div className="flex h-1.5 items-center rounded-sm bg-blue-100 px-1 dark:bg-blue-500/15">
              <div className="size-1 rounded-full bg-blue-600" />
            </div>
            <div className="h-1.5 rounded-sm bg-gray-200/60" />
            <div className="h-1.5 rounded-sm bg-gray-200/60" />
          </div>
        </div>
        <div className="flex-1 space-y-0.5 bg-gray-50/50 p-1.5">
          <div className="h-1.5 w-12 rounded-sm bg-gray-800" />
          <div className="h-1.5 w-20 rounded-sm bg-gray-300" />
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-16 overflow-hidden rounded-md border border-gray-200 dark:border-white/10">
      <div className="w-14 space-y-1 bg-gray-900 p-1.5">
        <div className="h-1.5 w-10 rounded-sm bg-card" />
        <div className="space-y-0.5 pt-1">
          <div className="flex h-1.5 items-center rounded-sm bg-white/10 px-1">
            <div className="size-1 rounded-full bg-blue-400" />
          </div>
          <div className="h-1.5 rounded-sm bg-white/20" />
          <div className="h-1.5 rounded-sm bg-white/20" />
        </div>
      </div>
      <div className="flex-1 space-y-0.5 bg-gray-50/50 p-1.5">
        <div className="h-1.5 w-12 rounded-sm bg-gray-800" />
        <div className="h-1.5 w-20 rounded-sm bg-gray-300" />
      </div>
    </div>
  )
}
