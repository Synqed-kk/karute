// お店ページ — WHICH LINE EACH HALF OF ONE SAVE PRESS SHOWS (S61 P7B-1, DECISIONS-S61 R220). One pure function, no React.
// The colour's own lines stay in the room (it passes its CARD_SAVE_FAIL in), so no Japanese moves out of it.

import { SAVE_FAIL } from './copy'
import type { CapsSaveReason } from './save-client'

/** The colour save's four refusals (the room's CardSaveReason). */
export type CardReason = 'forbidden' | 'tenant' | 'invalid' | 'core'

/** Each half: 'unsent' (not sent by this press), 'ok' (core accepted it) or its refusal. Each line says only its own
 *  half's truth (S5). Switches: stale → X4-alt · forbidden → X1 · tenant → X2 · locked (S75) → its own reload line ·
 *  core / invalid / disconnected → X3,
 *  or L9 when the colour was saved. Colour: its own line, except `core` while the switches were saved → L10. */
export function saveFailLines(
  card: 'unsent' | 'ok' | CardReason,
  caps: 'unsent' | 'ok' | CapsSaveReason,
  cardLines: Record<CardReason, string>,
): { card: string | null; caps: string | null } {
  const capsLine =
    caps === 'unsent' || caps === 'ok' ? null
      : caps === 'stale' ? SAVE_FAIL.stale
        : caps === 'forbidden' ? SAVE_FAIL.forbidden
          : caps === 'tenant' ? SAVE_FAIL.tenant
            : caps === 'locked' ? SAVE_FAIL.locked
            : card === 'ok' ? SAVE_FAIL.colourOnly
              : SAVE_FAIL.core
  const cardLine =
    card === 'unsent' || card === 'ok' ? null
      : card === 'core' && caps === 'ok' ? SAVE_FAIL.switchesOnly
        : cardLines[card]
  return { card: cardLine, caps: capsLine }
}
