// 表示設定 — the 表示する列 primitive, shared by every Business list screen.
//
// Canon puts this in `fable-shared.js` (§表示設定ポップオーバー, :153-244), not in
// a page script: 顧客 and 予約一覧 both hang a 表示設定 button off their
// `.panel-head` and both drive the same popover. One copy here for the same
// reason — two copies drift, and the "last column cannot be hidden" refusal is
// exactly the rule that would go missing on the second screen.
//
// fable-shared.js's own note calls this a per-staff-device display preference
// (「列の表示/非表示・列幅は『スタッフ個人の表示設定』… 権限ゲートは付けない」), so
// there is no permission gate here and none is wanted.

/** Canon's rule (fable-shared.js:190-193): EVERY column can be hidden, but
 *  unchecking the last visible one is refused — an all-hidden list is a broken
 *  screen, so the checkbox snaps back instead. */
export function toggleColumn(shown: readonly string[], key: string): string[] {
  if (!shown.includes(key)) return [...shown, key]
  return shown.length <= 1 ? [...shown] : shown.filter((k) => k !== key)
}

/** 表示する列 popover, canon's own behavior (fable-shared.js:216-244): the first
 *  checkbox takes focus on open, Escape and a click outside both close it and
 *  hand focus back to the button. Returns the cleanup, so a caller's effect is a
 *  thin `return wireColumnsPopover(...)`. */
export function wireColumnsPopover(pop: HTMLElement, trigger: HTMLElement, onClose: () => void): () => void {
  pop.querySelector('input')?.focus()
  const close = () => {
    onClose()
    trigger.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  // The button is excluded so its own click stays a toggle rather than being
  // closed here and reopened by the click handler.
  const onDown = (e: MouseEvent) => {
    const target = e.target as Node
    if (pop.contains(target) || trigger.contains(target)) return
    close()
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onDown)
  return () => {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('mousedown', onDown)
  }
}
