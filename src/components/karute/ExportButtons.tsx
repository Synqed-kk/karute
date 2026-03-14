'use client'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ExportButtonsProps {
  karuteId: string
}

/**
 * Client component with PDF and plain text download links.
 * Uses native browser download via <a href download> — no fetch or blob needed.
 * Both routes are authenticated Next.js API routes that return file downloads.
 */
export function ExportButtons({ karuteId }: ExportButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      {/* PDF download */}
      <a
        href={`/api/karute/${karuteId}/export/pdf`}
        download
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
      >
        PDF 出力
      </a>

      {/* Plain text download */}
      <a
        href={`/api/karute/${karuteId}/export/text`}
        download
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      >
        テキスト出力
      </a>
    </div>
  )
}
