'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const navItems = [
  { href: '/dashboard', label: 'ダッシュボード', icon: '◻' },
  { href: '/customers', label: '顧客', icon: '◻' },
  { href: '/appointments', label: '予約', icon: '◻' },
  { href: '/karute', label: 'カルテ', icon: '◻' },
  { href: '/recording', label: '録音', icon: '◻' },
  { href: '/ask-ai', label: 'AI に聞く', icon: '◻' },
  { href: '/migration', label: 'データ移行', icon: '◻' },
  { href: '/settings', label: '設定', icon: '◻' },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/login')
      router.refresh()
    } catch {
      setLoggingOut(false)
    }
  }

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r bg-card transition-all duration-200',
        collapsed ? 'w-[72px]' : 'w-[260px]'
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="text-lg font-bold tracking-wide">
          {collapsed ? 'K' : 'Karute'}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <span className="text-base">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="border-t p-2">
        <div className={cn('flex items-center gap-3 px-3 py-2', collapsed && 'justify-center')}>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            S
          </div>
          {!collapsed && (
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium">スタッフ</p>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="ログアウト"
          title={collapsed ? 'ログアウト' : undefined}
        >
          {collapsed ? '←' : loggingOut ? 'ログアウト中...' : 'ログアウト'}
        </Button>
      </div>

      <Separator />

      {/* Collapse toggle */}
      <div className="p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50"
        >
          {collapsed ? '→' : '← 閉じる'}
        </button>
      </div>
    </aside>
  )
}
