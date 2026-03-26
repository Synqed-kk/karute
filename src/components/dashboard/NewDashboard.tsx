'use client'

import { useState, useMemo } from 'react'
import { Mic, Users, FileText, Clock, ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { AIRecommendedActions } from './AIRecommendedActions'

interface Appointment {
  id: string
  startTime: string
  durationMinutes: number
  staffId: string
  customerName: string
  staffName: string
}

interface KaruteRecord {
  id: string
  summary: string | null
  createdAt: string
  staffId: string
  customerName: string
}

interface NewDashboardProps {
  staffName: string
  activeStaffId: string | null
  stats: {
    recordingsThisWeek: number
    karuteGenerated: number
  }
  todayAppointments: Appointment[]
  recentKarute: KaruteRecord[]
  locale: string
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function NewDashboard({ staffName, activeStaffId, stats, todayAppointments, recentKarute, locale }: NewDashboardProps) {
  const [showAll, setShowAll] = useState(false)

  const filteredAppointments = useMemo(() => {
    if (showAll || !activeStaffId) return todayAppointments
    return todayAppointments.filter((a) => a.staffId === activeStaffId)
  }, [todayAppointments, activeStaffId, showAll])

  const filteredKarute = useMemo(() => {
    if (showAll || !activeStaffId) return recentKarute.slice(0, 5)
    return recentKarute.filter((r) => r.staffId === activeStaffId).slice(0, 5)
  }, [recentKarute, activeStaffId, showAll])

  return (
    <div className="space-y-6">
      {/* Welcome + toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome back, {staffName}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {showAll ? 'My View' : 'All Staff'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500/10 to-orange-500/10 border border-rose-500/20 p-5">
          <Mic className="absolute top-4 right-4 h-8 w-8 text-rose-500/20" />
          <div className="text-3xl font-bold text-rose-600 dark:text-rose-400">{stats.recordingsThisWeek}</div>
          <div className="text-sm text-muted-foreground mt-1">Recordings This Week</div>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 p-5">
          <Users className="absolute top-4 right-4 h-8 w-8 text-blue-500/20" />
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{filteredAppointments.length}</div>
          <div className="text-sm text-muted-foreground mt-1">Customers Today</div>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 p-5">
          <FileText className="absolute top-4 right-4 h-8 w-8 text-emerald-500/20" />
          <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{stats.karuteGenerated}</div>
          <div className="text-sm text-muted-foreground mt-1">Karute Generated</div>
        </div>
      </div>

      {/* Two column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Appointments */}
        <div className="rounded-2xl border border-border/30 bg-card/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Today&apos;s Appointments</h3>
            </div>
            <Link href={'/appointments' as Parameters<typeof Link>[0]['href']} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {filteredAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No appointments today</p>
          ) : (
            <div className="space-y-2">
              {filteredAppointments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/20 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-[50px]">
                    <Clock className="h-3 w-3" />
                    {formatTime(a.startTime)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.customerName}</p>
                    <p className="text-xs text-muted-foreground">{a.staffName} · {a.durationMinutes}min</p>
                  </div>
                  <Link
                    href={`/sessions?customerId=${a.id}` as Parameters<typeof Link>[0]['href']}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Karute */}
        <div className="rounded-2xl border border-border/30 bg-card/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Recent Karute</h3>
            </div>
            <Link href={'/karute' as Parameters<typeof Link>[0]['href']} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {filteredKarute.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No karute records yet</p>
          ) : (
            <div className="space-y-2">
              {filteredKarute.map((r) => (
                <Link
                  key={r.id}
                  href={`/karute/${r.id}` as Parameters<typeof Link>[0]['href']}
                  className="flex items-center gap-3 rounded-lg border border-border/20 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.customerName}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.summary ?? '—'}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Recommended Actions */}
      <AIRecommendedActions locale={locale} />

      {/* Quick Actions */}
      <div className="rounded-2xl border border-border/30 bg-card/50 p-5">
        <h3 className="text-sm font-semibold mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            href={'/sessions' as Parameters<typeof Link>[0]['href']}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-600 transition-colors"
          >
            <Mic className="h-4 w-4" />
            Start Recording
          </Link>
          <Link
            href={'/customers' as Parameters<typeof Link>[0]['href']}
            className="flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <Users className="h-4 w-4" />
            Add Customer
          </Link>
          <Link
            href={'/karute' as Parameters<typeof Link>[0]['href']}
            className="flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <FileText className="h-4 w-4" />
            View Karute
          </Link>
        </div>
      </div>
    </div>
  )
}
