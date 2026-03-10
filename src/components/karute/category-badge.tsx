"use client"

import { cn } from "@/lib/utils"

export type EntryCategory =
  | "SYMPTOM"
  | "TREATMENT"
  | "BODY_AREA"
  | "PREFERENCE"
  | "LIFESTYLE"
  | "NEXT_VISIT"
  | "PRODUCT"
  | "OTHER"

const categoryConfig: Record<
  EntryCategory,
  { label: string; bg: string; text: string; border: string }
> = {
  SYMPTOM: {
    label: "症状",
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
  },
  TREATMENT: {
    label: "施術",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
  },
  BODY_AREA: {
    label: "部位",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    text: "text-purple-700 dark:text-purple-400",
    border: "border-purple-200 dark:border-purple-800",
  },
  PREFERENCE: {
    label: "希望",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
  },
  LIFESTYLE: {
    label: "生活習慣",
    bg: "bg-green-50 dark:bg-green-950/30",
    text: "text-green-700 dark:text-green-400",
    border: "border-green-200 dark:border-green-800",
  },
  NEXT_VISIT: {
    label: "次回予約",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    text: "text-cyan-700 dark:text-cyan-400",
    border: "border-cyan-200 dark:border-cyan-800",
  },
  PRODUCT: {
    label: "商品",
    bg: "bg-pink-50 dark:bg-pink-950/30",
    text: "text-pink-700 dark:text-pink-400",
    border: "border-pink-200 dark:border-pink-800",
  },
  OTHER: {
    label: "その他",
    bg: "bg-gray-50 dark:bg-gray-950/30",
    text: "text-gray-700 dark:text-gray-400",
    border: "border-gray-200 dark:border-gray-800",
  },
}

export function CategoryBadge({
  category,
  className,
}: {
  category: EntryCategory
  className?: string
}) {
  const config = categoryConfig[category]

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {config.label}
    </span>
  )
}

export function getCategoryLabel(category: EntryCategory): string {
  return categoryConfig[category].label
}

export const ALL_CATEGORIES: EntryCategory[] = [
  "SYMPTOM",
  "TREATMENT",
  "BODY_AREA",
  "PREFERENCE",
  "LIFESTYLE",
  "NEXT_VISIT",
  "PRODUCT",
  "OTHER",
]
