"use client"

import { useState } from "react"
import {
  Sparkles,
  Plus,
  FileText,
  FileDown,
  ArrowLeft,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EntryCard, type KaruteEntryData } from "./entry-card"
import { TranscriptPanel, type TranscriptSegment } from "./transcript-panel"
import {
  CategoryBadge,
  ALL_CATEGORIES,
  getCategoryLabel,
  type EntryCategory,
} from "./category-badge"
import { cn } from "@/lib/utils"

type KaruteStatus = "DRAFT" | "REVIEW" | "APPROVED"

interface KaruteEditorProps {
  karuteId: string
  customerName: string
  staffName: string
  date: string
  status: KaruteStatus
  aiSummary?: string | null
  entries: KaruteEntryData[]
  segments: TranscriptSegment[]
}

const statusConfig: Record<
  KaruteStatus,
  { label: string; className: string }
> = {
  DRAFT: {
    label: "下書き",
    className:
      "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  },
  REVIEW: {
    label: "確認中",
    className:
      "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800",
  },
  APPROVED: {
    label: "承認済",
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  },
}

export function KaruteEditor({
  karuteId,
  customerName,
  staffName,
  date,
  status: initialStatus,
  aiSummary,
  entries: initialEntries,
  segments,
}: KaruteEditorProps) {
  const [entries, setEntries] = useState<KaruteEntryData[]>(initialEntries)
  const [status, setStatus] = useState<KaruteStatus>(initialStatus)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCategory, setNewCategory] = useState<EntryCategory>("OTHER")
  const [newContent, setNewContent] = useState("")
  const statusInfo = statusConfig[status]

  const handleUpdateEntry = (id: string, content: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, content } : e))
    )
  }

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const handleAddEntry = () => {
    if (!newContent.trim()) return
    const entry: KaruteEntryData = {
      id: crypto.randomUUID(),
      category: newCategory,
      content: newContent.trim(),
      originalQuote: null,
      confidence: 1.0,
      tags: [],
      sortOrder: entries.length,
    }
    setEntries((prev) => [...prev, entry])
    setNewContent("")
    setNewCategory("OTHER")
    setShowAddForm(false)
  }

  const handleClassify = () => {
    // Placeholder for AI classification
    setStatus("REVIEW")
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/karute">
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{customerName}</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                  statusInfo.className
                )}
              >
                {statusInfo.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {date} / 担当: {staffName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClassify}>
            <Sparkles className="size-3.5" />
            AI分類を実行
          </Button>
          <Button variant="outline" size="sm">
            <FileText className="size-3.5" />
            PDF
          </Button>
          <Button variant="outline" size="sm">
            <FileDown className="size-3.5" />
            テキスト
          </Button>
        </div>
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <Card className="bg-muted/50">
          <CardContent>
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  AI要約
                </p>
                <p className="text-sm leading-relaxed">{aiSummary}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Left: Transcript */}
        <TranscriptPanel
          segments={segments}
          className="h-[calc(100vh-20rem)] w-full shrink-0 lg:w-80 xl:w-96"
        />

        {/* Right: Entries */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              エントリー ({entries.length})
            </h2>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus className="size-3" />
              エントリー追加
            </Button>
          </div>

          {/* Add Entry Form */}
          {showAddForm && (
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setNewCategory(cat)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-all",
                      newCategory === cat
                        ? "ring-2 ring-ring ring-offset-1"
                        : "opacity-60 hover:opacity-100"
                    )}
                  >
                    <CategoryBadge category={cat} />
                  </button>
                ))}
              </div>
              <Textarea
                placeholder="エントリー内容を入力..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="min-h-12 text-sm"
              />
              <div className="flex items-center gap-1">
                <Button size="xs" onClick={handleAddEntry}>
                  追加
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setShowAddForm(false)
                    setNewContent("")
                  }}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          )}

          {/* Entry list */}
          <div className="space-y-2">
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onUpdate={handleUpdateEntry}
                onDelete={handleDeleteEntry}
              />
            ))}
          </div>

          {entries.length === 0 && (
            <div className="rounded-lg border border-dashed py-12 text-center">
              <p className="text-sm text-muted-foreground">
                エントリーがありません。AI分類を実行するか、手動で追加してください。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
