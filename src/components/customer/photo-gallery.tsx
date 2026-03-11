'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Photo {
  id: string
  caption: string
  photoType: 'BEFORE' | 'AFTER' | 'PROGRESS' | 'GENERAL'
  date: string
}

const typeLabels: Record<Photo['photoType'], { label: string; className: string }> = {
  BEFORE: { label: 'ビフォー', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  AFTER: { label: 'アフター', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  PROGRESS: { label: '経過', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  GENERAL: { label: '一般', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
}

const mockPhotos: Photo[] = [
  { id: 'p1', caption: 'カラー施術前', photoType: 'BEFORE', date: '2026-03-08' },
  { id: 'p2', caption: 'カラー仕上がり — アッシュブラウン', photoType: 'AFTER', date: '2026-03-08' },
  { id: 'p3', caption: '2週間後の経過', photoType: 'PROGRESS', date: '2026-02-24' },
  { id: 'p4', caption: 'ヘアスタイル参考', photoType: 'GENERAL', date: '2026-02-10' },
]

export function PhotoGallery() {
  if (mockPhotos.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p className="text-muted-foreground">写真はまだありません</p>
        <Button variant="outline" className="mt-4">写真を追加</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm">写真を追加</Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {mockPhotos.map((photo) => {
          const config = typeLabels[photo.photoType]
          return (
            <div
              key={photo.id}
              className="group overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
            >
              <div className="flex h-40 items-center justify-center bg-muted text-sm text-muted-foreground">
                📷
              </div>
              <div className="p-3">
                <Badge variant="secondary" className={config.className}>
                  {config.label}
                </Badge>
                <p className="mt-1.5 text-sm font-medium">{photo.caption}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{photo.date}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
