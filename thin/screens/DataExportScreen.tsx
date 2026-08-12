// データエクスポート (data export) screen in the thin bundle (design-parity
// packet 23). Fetches the screen-shaped DTO through the DataPort and renders
// the REAL DataExportView — the same leaf component the web page renders.
// The DTO's totals/recipientEmail map straight onto DataExportView's props
// (no per-field passthrough mapping); locale reads the runtime shell locale
// (thin/locale.ts, 2026-08-11 packet FOLLOW-UP §2 Ruling A).

import { DataExportView } from '@/components/export/redesign/DataExportView'
import { DataExportScreenDTO, type DataExportScreenDTOType } from '@/lib/app-api/data-export-screen-dto'
import { getThinLocale } from '../locale'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): DataExportScreenDTOType => DataExportScreenDTO.parse(raw)

export function DataExportScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/data-export', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <DataExportView
          locale={getThinLocale()}
          totals={dto.totals}
          recipientEmail={dto.recipientEmail}
        />
      )}
    </ScreenStates>
  )
}
