"use client"

import { useState } from "react"
import { Pencil, Trash2, X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { CategoryBadge, type EntryCategory } from "./category-badge"
import { cn } from "@/lib/utils"

export interface KaruteEntryData {
  id: string
  category: EntryCategory
  content: string
  originalQuote?: string | null
  confidence: number
  tags: string[]
  sortOrder: number
}

interface EntryCardProps {
  entry: KaruteEntryData
  onUpdate?: (id: string, content: string) => void
  onDelete?: (id: string) => void
}

export function EntryCard({ entry, onUpdate, onDelete }: EntryCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(entry.content)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleSave = () => {
    onUpdate?.(entry.id, editContent)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditContent(entry.content)
    setIsEditing(false)
  }

  const handleDelete = () => {
    onDelete?.(entry.id)
    setShowDeleteConfirm(false)
  }

  return (
    <div className="group rounded-lg border bg-card p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CategoryBadge category={entry.category} />
          <ConfidenceBar confidence={entry.confidence} />
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isEditing && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsEditing(true)}
              aria-label="編集"
            >
              <Pencil />
            </Button>
          )}
          {!showDeleteConfirm ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="削除"
            >
              <Trash2 className="text-destructive" />
            </Button>
          ) : (
            <div className="flex items-center gap-0.5">
              <Button
                variant="destructive"
                size="icon-xs"
                onClick={handleDelete}
                aria-label="削除を確認"
              >
                <Check />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowDeleteConfirm(false)}
                aria-label="キャンセル"
              >
                <X />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-12 text-sm"
              autoFocus
            />
            <div className="flex items-center gap-1">
              <Button size="xs" onClick={handleSave}>
                保存
              </Button>
              <Button variant="ghost" size="xs" onClick={handleCancel}>
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed">{entry.content}</p>
        )}
      </div>

      {entry.originalQuote && !isEditing && (
        <p className="mt-1.5 text-xs italic text-muted-foreground">
          &ldquo;{entry.originalQuote}&rdquo;
        </p>
      )}
    </div>
  )
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100)

  return (
    <div className="flex items-center gap-1.5" title={`信頼度: ${percent}%`}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent >= 80
              ? "bg-green-500"
              : percent >= 50
                ? "bg-amber-500"
                : "bg-red-500"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  )
}
