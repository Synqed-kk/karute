'use client'

import { use } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { PhotoGallery } from '@/components/customer/photo-gallery'
import { CustomerNotes } from '@/components/customer/customer-notes'
import { cn } from '@/lib/utils'

// Mock customer data
const mockCustomer = {
  id: '1',
  name: '山田 花子',
  nameKana: 'ヤマダ ハナコ',
  phone: '090-1234-5678',
  email: 'hanako@example.com',
  notes: 'カラーのアレルギーあり。ジアミン系不可。',
  tags: ['VIP', '常連'],
  createdAt: '2025-06-15',
  lastVisit: '2026-03-08',
  visitCount: 24,
}

const tagColors: Record<string, string> = {
  VIP: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  常連: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

// Inline timeline events (no import dependency on timeline task)
const timelineEvents = [
  { id: 't1', type: 'VISIT' as const, title: 'カット + カラー', body: '担当: 田中太郎。アッシュブラウン。', date: '2026-03-08' },
  { id: 't2', type: 'TREATMENT' as const, title: '肩周りの施術', body: '肩こり改善。首の付け根を重点。', date: '2026-03-07' },
  { id: 't3', type: 'NOTE' as const, title: 'アレルギー情報追加', body: 'ジアミン系カラー剤 要注意', date: '2026-03-05' },
  { id: 't4', type: 'VISIT' as const, title: 'カット', body: '担当: 鈴木。前髪 + 毛先整え。', date: '2026-02-20' },
  { id: 't5', type: 'MILESTONE' as const, title: '来店10回達成', body: 'VIPステータスに昇格', date: '2026-02-15' },
  { id: 't6', type: 'VISIT' as const, title: 'トリートメント', body: '担当: 田中太郎。ヘッドスパ。', date: '2026-01-15' },
]

const typeColors: Record<string, string> = {
  VISIT: 'text-blue-500',
  TREATMENT: 'text-purple-500',
  NOTE: 'text-gray-400',
  MILESTONE: 'text-amber-500',
}

// Mock karute records
const karuteRecords = [
  { id: 'k1', date: '2026-03-08', status: 'APPROVED', entries: 6, staff: '田中太郎' },
  { id: 'k2', date: '2026-02-20', status: 'APPROVED', entries: 4, staff: '鈴木' },
  { id: 'k3', date: '2026-01-15', status: 'DRAFT', entries: 0, staff: '田中太郎' },
]

const statusStyles: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '下書き', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  REVIEW: { label: '確認中', className: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400' },
  APPROVED: { label: '承認済', className: 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
}

// Mock insights
const mockInsights = [
  {
    id: 'i1', type: 'FOLLOW_UP', title: 'フォローアップ推奨',
    body: 'ストレッチ用バンドの購入検討中。次回来店時に再度ご案内を。',
    priority: 0.8,
  },
  {
    id: 'i2', type: 'NEXT_TREATMENT', title: '次回施術の提案',
    body: '肩こりが続いているため、2週間後の来店を推奨。土曜午前希望。',
    priority: 0.7,
  },
  {
    id: 'i3', type: 'UPSELL', title: 'アップセル機会',
    body: 'ヘッドスパを気に入っていた様子。カラー施術時にセットメニューを提案可能。',
    priority: 0.5,
  },
]

const insightBorderColors: Record<string, string> = {
  FOLLOW_UP: 'border-l-orange-500',
  NEXT_TREATMENT: 'border-l-blue-500',
  UPSELL: 'border-l-purple-500',
  CHURN_RISK: 'border-l-red-500',
  TALKING_POINT: 'border-l-cyan-500',
}

const insightTypeLabels: Record<string, string> = {
  FOLLOW_UP: 'フォローアップ',
  NEXT_TREATMENT: '次回施術',
  UPSELL: 'アップセル',
  CHURN_RISK: '離反リスク',
  TALKING_POINT: '話題',
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const customer = mockCustomer

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/customers"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← 顧客一覧
      </Link>

      {/* Header + Insights row */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Customer info */}
        <div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{customer.nameKana}</p>
              <div className="mt-2 flex gap-1.5">
                {customer.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className={tagColors[tag] || ''}>
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm">編集</Button>
          </div>

          {/* Stats */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold tabular-nums">{customer.visitCount}</p>
                <p className="text-xs text-muted-foreground">来店回数</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">{customer.lastVisit}</p>
                <p className="text-xs text-muted-foreground">最終来店</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">{customer.createdAt}</p>
                <p className="text-xs text-muted-foreground">登録日</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right: AI Insights */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">AIインサイト</h3>
          {mockInsights.map((insight) => (
            <Card
              key={insight.id}
              className={cn(
                'border-l-4 transition-shadow hover:shadow-sm',
                insightBorderColors[insight.type] || 'border-l-gray-300'
              )}
            >
              <CardContent className="py-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {insightTypeLabels[insight.type] || insight.type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    優先度 {Math.round(insight.priority * 100)}%
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{insight.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{insight.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">タイムライン</TabsTrigger>
          <TabsTrigger value="karute">カルテ</TabsTrigger>
          <TabsTrigger value="photos">写真</TabsTrigger>
          <TabsTrigger value="details">詳細</TabsTrigger>
        </TabsList>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-6">
          <div className="relative space-y-1 border-l-2 border-border pl-4">
            {timelineEvents.map((event) => (
              <div
                key={event.id}
                className="group flex gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/40"
              >
                <span className={cn('mt-1 text-[8px]', typeColors[event.type] || 'text-gray-400')}>
                  ●
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{event.body}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{event.date}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Karute */}
        <TabsContent value="karute" className="mt-6">
          <div className="space-y-2">
            {karuteRecords.map((record) => {
              const status = statusStyles[record.status]
              return (
                <Link
                  key={record.id}
                  href={`/karute/${record.id}`}
                  className="flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="text-sm font-medium">{record.date}</span>
                  <span className="text-sm text-muted-foreground">{record.staff}</span>
                  <Badge variant="secondary" className={status?.className}>
                    {status?.label}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {record.entries} エントリー
                  </span>
                </Link>
              )
            })}
          </div>
        </TabsContent>

        {/* Photos */}
        <TabsContent value="photos" className="mt-6">
          <PhotoGallery />
        </TabsContent>

        {/* Details */}
        <TabsContent value="details" className="mt-6">
          <CustomerNotes
            phone={customer.phone}
            email={customer.email}
            notes={customer.notes}
            tags={customer.tags}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
