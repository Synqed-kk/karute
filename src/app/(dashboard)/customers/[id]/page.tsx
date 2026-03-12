'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'

// Mock customer data
const mockCustomers = [
  {
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
  },
  {
    id: '2',
    name: '佐藤 美咲',
    nameKana: 'サトウ ミサキ',
    phone: '080-9876-5432',
    email: 'misaki@example.com',
    notes: '',
    tags: ['常連'],
    createdAt: '2025-09-01',
    lastVisit: '2026-03-05',
    visitCount: 12,
  },
]

const tagColors: Record<string, string> = {
  VIP: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  常連: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const customer = mockCustomers.find((c) => c.id === id) ?? mockCustomers[0]

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href="/customers"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 顧客一覧
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {customer.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.nameKana}
          </p>
          <div className="mt-2 flex gap-1.5">
            {customer.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className={tagColors[tag] || ''}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm">
          編集
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
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

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">タイムライン</TabsTrigger>
          <TabsTrigger value="karute">カルテ</TabsTrigger>
          <TabsTrigger value="photos">写真</TabsTrigger>
          <TabsTrigger value="details">詳細</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-6">
          <div className="space-y-4">
            {[
              { date: '2026-03-08', text: 'カット + カラー — 担当: 鈴木' },
              { date: '2026-02-10', text: 'カット — 担当: 鈴木' },
              { date: '2026-01-15', text: 'カット + トリートメント — 担当: 田中' },
            ].map((event, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/40"
              >
                <span className="min-w-[5rem] text-xs text-muted-foreground">
                  {event.date}
                </span>
                <span className="text-sm">{event.text}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="karute" className="mt-6">
          <div className="flex flex-col items-center py-12 text-center">
            <p className="text-muted-foreground">カルテ記録はまだありません</p>
            <Button variant="outline" className="mt-4">
              カルテを作成
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="photos" className="mt-6">
          <div className="flex flex-col items-center py-12 text-center">
            <p className="text-muted-foreground">写真はまだありません</p>
            <Button variant="outline" className="mt-4">
              写真をアップロード
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="details" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">連絡先情報</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">電話番号</span>
                <span>{customer.phone}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">メール</span>
                <span>{customer.email || '—'}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">メモ</span>
                <span className="max-w-xs text-right">{customer.notes || '—'}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
