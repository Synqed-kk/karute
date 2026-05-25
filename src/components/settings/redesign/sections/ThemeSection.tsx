'use client'

import { useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Sun, Moon, Monitor, ChevronDown } from 'lucide-react'
import { upsertOrgSettings, type OrgSettings } from '@/actions/org-settings'
import {
  DEFAULT_THEME_COLORS,
  type ThemeColors,
} from '@/lib/theme'

const BAR_COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'barOpen', label: 'Open' },
  { key: 'barBooking', label: 'Booking' },
  { key: 'barRecording', label: 'Recording' },
  { key: 'barCompleted', label: 'Completed' },
  { key: 'barBlocked', label: 'Blocked' },
  { key: 'barProcessing', label: 'Processing' },
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
