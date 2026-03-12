"use client"

import { use } from "react"
import { KaruteEditor } from "@/components/karute"
import type { KaruteEntryData } from "@/components/karute"
import type { TranscriptSegment } from "@/components/karute"

const mockSegments: TranscriptSegment[] = [
  {
    text: "今日はどのような感じですか？",
    startTime: 0,
    endTime: 3.2,
    speakerLabel: "スタッフ",
  },
  {
    text: "最近ちょっと肩こりがひどくて、首のあたりも張っている感じがします。",
    startTime: 3.5,
    endTime: 9.1,
    speakerLabel: "お客様",
  },
  {
    text: "なるほど。デスクワークが多いですか？",
    startTime: 9.5,
    endTime: 12.0,
    speakerLabel: "スタッフ",
  },
  {
    text: "はい、最近リモートワークで一日中パソコンに向かっています。運動もほとんどしていなくて。",
    startTime: 12.3,
    endTime: 18.5,
    speakerLabel: "お客様",
  },
  {
    text: "それは辛いですね。前回と同じように、肩周りを中心にほぐしていきましょう。あと、首の付け根のところも重点的にやりますね。",
    startTime: 19.0,
    endTime: 27.3,
    speakerLabel: "スタッフ",
  },
  {
    text: "お願いします。あと、前回勧めていただいたストレッチ用のバンド、まだ買っていなくて…。",
    startTime: 27.8,
    endTime: 33.2,
    speakerLabel: "お客様",
  },
  {
    text: "大丈夫ですよ。今日施術の後にもう一度ご紹介しますね。次回は2週間後くらいがいいと思います。",
    startTime: 33.5,
    endTime: 40.1,
    speakerLabel: "スタッフ",
  },
  {
    text: "はい、できれば土曜日の午前中だと助かります。",
    startTime: 40.5,
    endTime: 44.0,
    speakerLabel: "お客様",
  },
]

const mockEntries: KaruteEntryData[] = [
  {
    id: "e1",
    category: "SYMPTOM",
    content: "肩こりがひどい。首周りに張りがある。",
    originalQuote: "肩こりがひどくて、首のあたりも張っている感じがします",
    confidence: 0.95,
    tags: ["肩", "首"],
    sortOrder: 0,
  },
  {
    id: "e2",
    category: "BODY_AREA",
    content: "肩周り、首の付け根",
    originalQuote: "肩周りを中心にほぐしていきましょう。首の付け根のところも重点的に",
    confidence: 0.92,
    tags: [],
    sortOrder: 1,
  },
  {
    id: "e3",
    category: "TREATMENT",
    content: "肩周りのほぐし施術、首の付け根を重点的に施術",
    originalQuote: "肩周りを中心にほぐしていきましょう。首の付け根のところも重点的にやります",
    confidence: 0.88,
    tags: [],
    sortOrder: 2,
  },
  {
    id: "e4",
    category: "LIFESTYLE",
    content: "リモートワークで終日デスクワーク。運動習慣なし。",
    originalQuote: "リモートワークで一日中パソコンに向かっています。運動もほとんどしていなくて",
    confidence: 0.9,
    tags: ["デスクワーク"],
    sortOrder: 3,
  },
  {
    id: "e5",
    category: "PRODUCT",
    content: "ストレッチ用バンドを紹介予定（前回も提案済み、未購入）",
    originalQuote: "前回勧めていただいたストレッチ用のバンド、まだ買っていなくて",
    confidence: 0.85,
    tags: [],
    sortOrder: 4,
  },
  {
    id: "e6",
    category: "NEXT_VISIT",
    content: "2週間後、土曜日午前中希望",
    originalQuote: "できれば土曜日の午前中だと助かります",
    confidence: 0.93,
    tags: [],
    sortOrder: 5,
  },
]

export default function KaruteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  return (
    <KaruteEditor
      karuteId={id}
      customerName="山田 花子"
      staffName="田中 太郎"
      date="2026-03-10"
      status="REVIEW"
      aiSummary="肩こり・首の張りの症状でご来店。リモートワークによるデスクワークが原因と考えられます。肩周りと首の付け根を重点的に施術しました。ストレッチ用バンドの購入を再度ご案内。次回は2週間後の土曜午前をご希望です。"
      entries={mockEntries}
      segments={mockSegments}
    />
  )
}
