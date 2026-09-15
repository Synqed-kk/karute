// R3-19 — the 新規 spark, the mock's own glyph rather than lucide's.
// DATE-JUMP-PICKER-MOCK.html line 780 draws TWO stars at stroke 1.8; lucide's
// `Sparkles` draws three at stroke 2, so the port carried a denser, heavier
// mark than the design it was copying. One component, because the day line and
// the week cell must not drift apart — and the month line and the selected-day
// card come to the same door when they land.
//
// Colour is inherited: every call site already sets the 新規 tone on the
// element the spark sits in, so `currentColor` keeps ONE source for it.
// `aria-hidden` on purpose — the cell's label already says 新規, and the row's
// accessible name is built from that label (R3-6).
export function NewSpark({ className }: { className?: string }) {
  return (
    <svg
      data-new-spark
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M10.5 3l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3L4.5 9l4.3-1.7z" />
      <path d="M17.6 14.2l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" />
    </svg>
  )
}
