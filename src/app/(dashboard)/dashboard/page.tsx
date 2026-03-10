'use client'

import { useOrg } from '@/components/providers/org-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const statsCards = [
  { label: '本日の予約', value: 8, icon: '📅' },
  { label: '顧客数', value: 142, icon: '👥' },
  { label: '今月のカルテ', value: 36, icon: '📋' },
  { label: '未処理の録音', value: 3, icon: '🎙' },
]

const recentActivity = [
  { time: '14:30', text: '山田花子さんのカルテを更新しました' },
  { time: '13:15', text: '新規顧客「佐藤美咲」を登録しました' },
  { time: '11:00', text: '録音から施術メモを自動生成しました' },
  { time: '09:45', text: '本日の予約リマインダーを送信しました' },
  { time: '昨日', text: '月次レポートが生成されました' },
]

function formatDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const weekday = weekdays[now.getDay()]
  return `${year}年${month}月${day}日（${weekday}）`
}

export default function DashboardPage() {
  const { staff } = useOrg()

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          こんにちは、{staff.name}さん
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDate()}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statsCards.map((stat) => (
          <Card
            key={stat.label}
            className="transition-shadow hover:shadow-md"
          >
            <CardContent className="pt-1">
              <div className="flex items-center justify-between">
                <span className="text-2xl">{stat.icon}</span>
              </div>
              <div className="mt-3">
                <p className="text-3xl font-bold tabular-nums tracking-tight">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button size="lg">
          🎙 録音開始
        </Button>
        <Button variant="outline" size="lg">
          👤 新規顧客
        </Button>
      </div>

      <Separator />

      {/* Recent Activity */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">最近のアクティビティ</h2>
        <div className="space-y-3">
          {recentActivity.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
            >
              <span className="mt-0.5 min-w-[3.5rem] text-xs text-muted-foreground">
                {item.time}
              </span>
              <span className="text-foreground/90">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
