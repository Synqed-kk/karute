'use client'

// AI相談 — the computer door onto the same AI the phone app already ships, and
// onto the suggestion feed canon designed for the desk. ⚖ Liam 8/31 ordered this
// room REDESIGNED: "the phone one hasn't been touched properly and it's crap" —
// so the phone is the CONTRACT source (what a question is, what an answer knows,
// who may ask, what is kept) and never the design bar.
//
// ⚖ WHAT THE DESK DOES THAT THE PHONE CANNOT (desktop-superior, 8/30):
//   (a) BOTH PLANES AT ONCE. The phone stacks header → hints → templates →
//       conversation → input in one column, so the conversation — the thing the
//       page is FOR — is the last thing you reach. Here the consultation is the
//       left workspace and the suggestion feed is the right aside, visible
//       together at desk widths, and inside the workspace the CONVERSATION comes
//       first: the prompt systems sit where they are used, just above the
//       composer, instead of in front of the answers (⚖ D-1).
//   (b) HONEST FAILURE GRAMMAR. The phone collapses every failure into one
//       bubble reading 「エラーが発生しました。」. Here the refusal, the permission
//       state and the failed turn each carry their own reason, and the failed
//       turn is a designed card rather than a latent branch (⚖ D-3).
//   (c) ONE EVIDENCE GRAMMAR. The phone's citations path is dead code ("until
//       RAG lands"). Here an answer's 出典 rows and a suggestion's 根拠 line are
//       the SAME component reading the SAME resolver, so the two can never tell
//       one customer's story two ways (⚖ D-4).
// ⚖ AND WHAT IT KEEPS (the recognition floor): where the desk shows the same
// meaning it uses the phone's own words — AI相談, 接続済みデータ, 会話,
// じっくり相談, 今日のヒント, 出典, 送信, and the composer's two hint lines.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: what is typed in the composer,
// which refusal is currently being shown, which suggestions have been dismissed
// for this visit, which toast is up, and which step of the 画面の説明 tour the
// reader is on. Every one is pure browsing — none of them writes anything, and
// the one control that would (送信) refuses immediately and honestly.
//
// ⚠ NO GENERATION THEATRE, ANYWHERE (⚖ D-2). This screen never renders the
// phone's 「お店のデータを確認しています…」, never fabricates a reply, never
// pretends latency and never calls anything: there is no fetch, no timer that
// resolves into content, and no `thinking` string in this file. 送信 refuses in
// the same tick, naming registry ①, and the typed text is untouched.
//
// CLASS NAMES ARE PREFIXED `ak-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and 今日の
// 運営 / 顧客 / 予約一覧 / 売上分析 / スタッフ・シフト / 受信トレイ / 売上・レジ /
// カルテ state BARE `.biz .<name>` rules on names this room would otherwise want
// (`.panel`, `.empty`, `.chip`, `.toast`, `.spot-card`…). A fence that has to
// enumerate sixty shared names rots as the neighbours grow; not colliding at all
// cannot. `page` / `h1` / `btn` are the SHELL's and restated here, so those three
// are fenced in ask-ai.css at four levels.

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  keepCardOffHeading,
  windowFeed,
  type ConversationTurn,
  type FeedCard,
  type ScopeFact,
  type SignalChip,
  type TemplatePill,
} from '@/business/lib/ask-ai'

/** THE ROUTE WRAPPER. Every rule in ask-ai.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-ask-ai` (four
 *  levels) rather than `.pg-ask-ai` (three) so a sibling's own three-level rule
 *  (`.biz .page .btn`, customers.css:23) cannot win the room back on insertion
 *  order. */
const ROOT = 'page pg-ask-ai'

/** A suggestion card as the SERVER hands it over: the derivation's own verdicts
 *  plus the one thing only the route knows — where the card's action goes, with
 *  the current store lens already on it. The screen builds no URL (⚖ registry ⑥:
 *  a record-level param would be a contract this room invented). */
export interface AskAiCardProps extends FeedCard {
  href: string
}

export interface AskAiProps {
  dateline: string
  lensLabel: string
  subtitle: string
  /** Non-empty ⇒ this reader may not consult, and every field below is empty by
   *  construction rather than by a screen being trusted to hide it. */
  noticeLines: string[]
  scopeTitle: string
  scope: ScopeFact[]
  privacyLines: string[]
  signals: SignalChip[]
  templates: TemplatePill[]
  /** 「最適化対象：美容整体」 — present only when a business type is set. */
  tunedLabel: string | null
  /** …and its opposite: present only when one is NOT (⚖ never both). */
  profileHint: { title: string; body: string; cta: string } | null
  turns: ConversationTurn[]
  startHint: string
  feed: AskAiCardProps[]
  feedEmpty: { title: string; body: string }
  trace: Array<{ label: string; value: string; unconnected: boolean }>
  boundary: { kicker: string; title: string; body: string; backLabel: string; backHref: string }
  composer: { placeholder: string; hint: string; sendLabel: string }
  refusals: { send: string; settings: string }
  dismissToast: string
  footnote: string
}

/** ⚖ Liam 8/23 — 画面の説明. The family's own tour helpers, at the same shape:
 *  a rect literal the shared engine understands, and two identity guards that
 *  keep the measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** The composer's auto-grow ceiling. The phone caps at 160px
 *  (`AIInputBar.tsx:21`); the desk has more room and a longer question is what a
 *  desk is FOR, so the ceiling is higher — and it is a ceiling on a TEXT CONTROL,
 *  not on a wrapper, so the ⚖ page-scroll ruling (no container in this room owns
 *  an axis) is untouched: the proof measures wrappers, and a textarea scrolls the
 *  way an `<input>` does, by UA. */
const COMPOSER_MAX = 260

export function AskAiScreen(props: AskAiProps) {
  const [draft, setDraft] = useState('')
  /** ⚖ D-2 — WHAT THE LAST PRESS REFUSED, AND WHY. `contextLabel` is the
   *  `context_label` the shipped request would have come back with when the
   *  press came from a 今日のヒント chip, shown so the refusal says which slice of
   *  data the answer would have been built from rather than only that it did not
   *  happen. */
  const [refusal, setRefusal] = useState<{ reason: string; contextLabel: string | null } | null>(null)
  /** ⚖ DEMO-LOCAL BY DESIGN (canon's own contract): in memory, this visit only.
   *  A remount brings every card back, the toast says so out loud, and a store
   *  switch resets it with the rest of the screen because `page.tsx` keys this
   *  component by the lens. */
  const [dismissed, setDismissed] = useState<string[]>([])
  /** ⚖ HOW MUCH OF THE FEED IS OPEN — browsing state, exactly like the dismissed
   *  list, and it resets with the store for the same reason (`page.tsx` keys this
   *  component by the lens). The カルテ room's own さらに表示 walk, at the family's
   *  shape: a step count, never a page number, because 「もっと見る」 is what a
   *  reader is asking for and 「3 / 7ページ」 is not. */
  const [feedSteps, setFeedSteps] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visible = props.feed.filter((c) => !dismissed.includes(c.id))
  /** ⚠ THE WINDOW IS TAKEN OFF `visible`, NOT OFF THE PROPS. A dismissal leaves
   *  the total the head counts AND the arithmetic the footer names in one pass,
   *  so 「提案 N件」 and 「あと M件」 can never describe two different lists. */
  const walk = windowFeed(visible, feedSteps)

  /** THE COMPOSER'S OWN MECHANIC, kept from the phone (`AIInputBar.tsx:18-23`):
   *  the box grows with what is typed. `height: auto` first, or the box can only
   *  ever get taller — a deleted line would leave the hole it made. */
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX)}px`
  }, [draft])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }, [])

  // A timer that outlives its component sets state on nothing. One cleanup, at
  // the one place the timer is owned.
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  /** ⚖ SEND REFUSES, IMMEDIATELY AND HONESTLY, AND CHANGES NOTHING ELSE (⚖ §A-7).
   *  The typed text is not read, not trimmed into the box, not cleared and not
   *  moved: a refusal that ate the question would make the reader retype it to
   *  find out what the refusal said. */
  const refuseSend = (contextLabel: string | null = null) => {
    setRefusal({ reason: props.refusals.send, contextLabel })
  }

  /** 今日のヒント — the phone SENDS on a chip tap, with the chip's context hint
   *  (`AIAssistantView.tsx:147`). The desk walks the same path to its honest
   *  end: the question lands in the composer where the reader can see and edit
   *  it, and the send it would have made is refused with the context label the
   *  request would have carried. */
  const takeSignal = (chip: SignalChip) => {
    setDraft(chip.prompt)
    refuseSend(chip.contextLabel)
    inputRef.current?.focus()
  }

  /** じっくり相談 — the phone FILLS ONLY (`AIAssistantView.tsx:162` / `:181` —
   *  `setInput(example)`, no send). The two behaviours are different on purpose
   *  and stay different here: a template is a starting point somebody edits. */
  const takeTemplate = (pill: TemplatePill) => {
    setDraft(pill.example)
    setRefusal(null)
    inputRef.current?.focus()
  }

  /** Enter sends, Shift+Enter is a newline — the contract the composer's own
   *  hint line documents (`messages/ja.json` askAi.inputHint). */
  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    if (draft.trim()) refuseSend()
  }

  const dismiss = (id: string) => {
    setDismissed((was) => (was.includes(id) ? was : [...was, id]))
    showToast(props.dismissToast)
  }

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`, and
   *  that engine is FROZEN — this room wires a trigger and an overlay to it and
   *  nothing else). A section joins the walk by DECLARING `data-guide-title` +
   *  `data-guide` ON ITSELF, so there is no list to keep in sync: a section that
   *  renders is a section that is explained, and one that is not on screen — the
   *  今日のヒント strip in a store with no signals, the 業種未設定 note in a shop
   *  that has chosen one, the permission note for a reader who has the
   *  permission — drops out of the walk and out of the N/M count by itself. That
   *  is Liam's "when I add a function it should automatically pick it up", and it
   *  is why this room's gate is a census of what the DOM declares rather than a
   *  table anyone maintains.
   *
   *  The walk is scoped to the ROOM's own root rather than the document: the
   *  shell's rail and topbar are not this page. */
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls, which is the room's
    // ruling — the overlay adds no scroller of its own (⚖ page-scroll).
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    // The engine's answer, then the correction for the one shape it cannot place
    // — a section taller than the viewport, which this room's feed becomes the
    // moment a store has twenty-five suggestions.
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // ONE keyboard listener, bound only while the tour IS open and removed with
  // it: while the walk is up it owns Escape and the arrows walk the ring. The
  // composer's own Enter is a LOCAL handler on the textarea rather than a second
  // document listener, so the two can never fire on one press.
  useEffect(() => {
    if (!tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize, the ≤743 band arriving — has to re-measure.
  useEffect(() => {
    if (!tourOpen) return
    const bump = () => setTourTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  // ⚖ THE KEYBOARD MUST NOT BE STRANDED BY THE TOUR. Opening it puts focus on
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts focus
  // back on the ? it came from, rather than dropping the reader at the top of the
  // document. `wasOpen` is what keeps the close half from firing on the first
  // render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  const denied = props.noticeLines.length > 0

  return (
    <div className={ROOT} ref={rootRef}>
      {/* STEP 0. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it — and its sentence is true whether or not the reader may consult. */}
      <header
        className="ak-head"
        data-guide-title="AI相談"
        data-guide="この店舗の記録をもとに、AIに質問したり、AIからの提案を受け取ったりする画面です。左側で質問し、右側にAIからの提案が並びます。相談の内容は保存されません。"
      >
        <div className="ak-eyebrow">{props.dateline}</div>
        <div className="ak-titleline">
          <h1>AI相談</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one every other
              Business page has: a spotlight walk of everything on this screen,
              and during the walk you can tap any part of the page to jump
              straight to what it is. A hairline circle, never a filled one
              (⚖ R13). */}
          <button
            className="ak-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="akTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="ak-subtitle">{props.subtitle}</p>
      </header>

      {denied && (
        <section
          className="ak-notice"
          aria-label="この画面の見え方"
          data-guide-title="この画面の見え方"
          data-guide="AI相談を使うには顧客を閲覧できる権限が必要です。権限がない場合、この画面には提案も相談の内容も読み込まれません。"
        >
          {props.noticeLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}

      {!denied && (
        <>
          {/* ⚖ 接続済みデータ — the phone's own four facts, in the phone's own
              words, and EXACT rather than approximate (a sealed world has no
              page to run out of). ⚖ 8/25: every chip says WHAT it counts. */}
          <section
            className="ak-scope"
            aria-label={props.scopeTitle}
            data-guide-title="接続済みデータ"
            data-guide="AIがこの店舗で読み取れる記録の件数です。カルテ・顧客・予約・録音の4つを、それぞれ何の件数かを書いて並べています。下の2行は、保存されないことと、回答が実際に読み取る範囲の説明です。"
          >
            <div className="ak-scope-row">
              <span className="ak-label">{props.scopeTitle}</span>
              <div className="ak-scope-chips">
                {props.scope.map((f) => (
                  <span className="ak-scope-chip" key={f.key}>
                    <b>{f.label}</b> {f.value}
                  </span>
                ))}
              </div>
            </div>
            {props.privacyLines.map((line) => (
              <p className="ak-scope-note" key={line}>{line}</p>
            ))}
          </section>

          <div className="ak-workspace">
            <div className="ak-main">
              {/* ═══ 会話 — FIRST, which is the whole of ⚖ D-1 ═══
                  On the phone the conversation is the last thing you reach,
                  under two blocks of prompts. Here it opens the workspace and
                  the prompts sit where they are used: immediately above the
                  composer. */}
              <section
                className="ak-convo"
                aria-label="会話"
                data-guide-title="会話"
                data-guide="質問と回答が並ぶところです。回答には出典がつき、どのカルテ・どのお客様の記録から答えたのかを確認できます。うまく回答できなかったときは、その理由がその場に表示されます。"
              >
                <div className="ak-sec-title">会話</div>
                {props.turns.length === 0 ? (
                  <p className="ak-start">{props.startHint}</p>
                ) : (
                  <div className="ak-turns">
                    {props.turns.map((t) => (
                      <article className={`ak-turn ak-turn-${t.role}`} key={t.id}>
                        <div className="ak-turn-who">
                          {t.role === 'user' ? '質問' : t.role === 'assistant' ? 'AIの回答' : '回答できませんでした'}
                          {t.contextLabel && <span className="ak-turn-ctx">{t.contextLabel}</span>}
                        </div>
                        <p className="ak-turn-text">{t.text}</p>
                        {t.sources.length > 0 && (
                          <div className="ak-sources">
                            <div className="ak-sources-head">
                              <span className="ak-sources-label">出典</span>
                              <span className="ak-sources-count">{t.sourceCountLabel}</span>
                            </div>
                            {/* ⚖ D-4 — ONE EVIDENCE GRAMMAR. This is the same
                                row the feed's 根拠 line uses, reading the same
                                resolver: a person's name and what the record
                                says, never an id. */}
                            {t.sources.map((s) => (
                              <p className="ak-evidence" key={s.ref}>{s.line}</p>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {props.signals.length > 0 && (
                <section
                  className="ak-signals"
                  aria-label="今日のヒント"
                  data-guide-title="今日のヒント"
                  data-guide="今日の予約とカルテから自動で作られた質問です。押すと質問が入力欄に入り、その質問がどの記録を読んで答えるつもりだったのかが表示されます。"
                >
                  <div className="ak-sec-title">今日のヒント</div>
                  <p className="ak-sec-note">今日の予約とカルテから自動で提案しています</p>
                  <div className="ak-chip-row">
                    {props.signals.map((s) => (
                      <button className="ak-signal" type="button" key={s.id} onClick={() => takeSignal(s)}>
                        <span className="ak-signal-tag">{s.tag}</span>
                        <span className="ak-signal-title">{s.title}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {props.profileHint && (
                <section
                  className="ak-profile"
                  aria-label={props.profileHint.title}
                  data-guide-title="業種の設定"
                  data-guide="業種を選ぶと、お店の言葉に合わせてAIが調整され、業種別のおすすめの質問が表示されます。設定画面は準備中です。"
                >
                  <strong>{props.profileHint.title}</strong>
                  <p>{props.profileHint.body}</p>
                  <button
                    className="btn ak-profile-cta"
                    type="button"
                    aria-disabled="true"
                    title={props.refusals.settings}
                    aria-label={`${props.profileHint.cta} — ${props.refusals.settings}`}
                    onClick={() => setRefusal({ reason: props.refusals.settings, contextLabel: null })}
                  >
                    {props.profileHint.cta}
                  </button>
                </section>
              )}

              <section
                className="ak-templates"
                aria-label="じっくり相談"
                data-guide-title="じっくり相談"
                data-guide="業種に合わせたおすすめの質問です。押すと入力欄に文章が入るだけなので、そのまま送らずに書き換えられます。"
              >
                <div className="ak-sec-head">
                  <div className="ak-sec-title">じっくり相談</div>
                  {props.tunedLabel && <span className="ak-tuned">{props.tunedLabel}</span>}
                </div>
                <div className="ak-tpl-row">
                  {props.templates.map((t) => (
                    <button className="ak-tpl" type="button" key={t.id} onClick={() => takeTemplate(t)}>
                      <span className="ak-tpl-cat">{t.categoryLabel}</span>
                      <span className="ak-tpl-title">{t.title}</span>
                      <span className="ak-tpl-preview">{t.preview}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section
                className="ak-composer"
                aria-label="質問を入力"
                data-guide-title="質問を入力"
                data-guide="質問を書いて送るところです。Enterで送信、Shift+Enterで改行します。いまは見本データのため送信はできず、押すと理由が表示されます。書いた文章はそのまま残ります。"
              >
                {/* ⚖ D-2 · ⚖ §A-7 — the refusal appears HERE, beside the control
                    that was pressed, and it changes nothing: the question stays
                    in the box, the box stays usable, and the reason names the
                    seam it is waiting on. */}
                {refusal && (
                  <div className="ak-refusal" role="status" aria-live="polite">
                    <p className="ak-refusal-reason">{refusal.reason}</p>
                    {refusal.contextLabel && (
                      <p className="ak-refusal-ctx">読み取る予定だったデータ：{refusal.contextLabel}</p>
                    )}
                  </div>
                )}
                <div className="ak-input-wrap">
                  <textarea
                    ref={inputRef}
                    className="ak-input"
                    rows={3}
                    value={draft}
                    placeholder={props.composer.placeholder}
                    aria-label="お店について質問を入力"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onComposerKey}
                  />
                  <button
                    className="ak-send"
                    type="button"
                    disabled={draft.trim() === ''}
                    onClick={() => refuseSend()}
                  >
                    {props.composer.sendLabel}
                  </button>
                </div>
                <p className="ak-input-hint">{props.composer.hint}</p>
                <p className="ak-footnote">{props.footnote}</p>
              </section>
            </div>

            <aside className="ak-aside">
              {/* ═══ canon's feed, whole: the count, the badge that comes only
                  from a hard fact, the 根拠 line, the deep link and 却下 ═══ */}
              <section
                className="ak-feed"
                aria-label="AIが提案する次のアクション"
                data-guide-title="AIが提案する次のアクション"
                data-guide="記録や予約の変化からAIが提案した、次にやることの一覧です。1件ごとに根拠が付いていて、ボタンを押すとその作業をする画面へ移動します。急ぎの目印は記録そのものに期限や未対応があるときだけ付きます。却下はこの画面の中だけの操作で、保存はされません。"
              >
                <div className="ak-feed-head">
                  <h2>AIが提案する次のアクション</h2>
                  <span className="ak-feed-count">提案 {visible.length}件</span>
                </div>
                {visible.length === 0 ? (
                  <div className="ak-empty">
                    <strong>{props.feedEmpty.title}</strong>
                    <span>{props.feedEmpty.body}</span>
                  </div>
                ) : (
                  <div className="ak-feed-list">
                    {/* ⚖ THE CATEGORY IS A DATA ATTRIBUTE, NOT A CLASS. The sheet
                        carries one quiet tone per canon category off `data-cat`
                        (the カルテ room's kr-cat precedent), so a category the
                        plane adds later arrives NEUTRAL rather than mis-coloured,
                        and this file states no colour at all. */}
                    {walk.shown.map((c) => (
                      <article className="ak-sug" key={c.id} data-cat={c.category}>
                        <div className="ak-sug-top">
                          <span className="ak-sug-cat">{c.categoryLabel}</span>
                          {c.badge && <span className="ak-sug-badge">{c.badge}</span>}
                        </div>
                        <p className="ak-sug-text">{c.text}</p>
                        <div className="ak-evidence">
                          <span className="ak-evidence-label">根拠</span>
                          <span>{c.evidence}</span>
                        </div>
                        <div className="ak-sug-actions">
                          <Link className="btn primary ak-open" href={c.href}>{c.linkLabel}</Link>
                          <button className="ak-dismiss" type="button" onClick={() => dismiss(c.id)}>却下</button>
                        </div>
                      </article>
                    ))}
                    {/* ⚖ さらに表示 — the カルテ room's own footer band, and it
                        declares itself so the walk explains it the round it
                        lands. It renders ONLY when there is genuinely more, so a
                        store whose whole feed fits shows no control and loses no
                        tour step (⚖ self-registration, both directions). */}
                    {walk.moreLabel && (
                      <div
                        className="ak-more"
                        data-guide-title="さらに表示"
                        data-guide="提案は6件ずつ表示しています。押すと続きの提案が下に追加され、ボタンには残りの件数が出ます。却下した提案は残りの件数からも外れます。"
                      >
                        <button className="btn" type="button" onClick={() => setFeedSteps((s) => s + 1)}>
                          {walk.moreLabel}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section
                className="ak-trace"
                aria-label="この画面の値の設定元"
                data-guide-title="この画面の値の設定元"
                data-guide="この画面の内容がどこで決まるかの一覧です。「未接続」と書かれている行は、まだ決める画面がつながっていないという意味で、いまは見本の値で表示しています。"
              >
                <div className="ak-sec-title">この画面の値の設定元</div>
                <dl className="ak-trace-rows">
                  {props.trace.map((row) => (
                    <div className="ak-trace-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className={row.unconnected ? 'ak-unconnected' : undefined}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </aside>
          </div>
        </>
      )}

      {/* Boundary markup — PRESENT-BUT-INERT, one mount. The matrix row
          `nav.record_ai.ai_consult` defines only a boundary-ENTITLEMENT state
          (no `by_rights` variant), so there is one panel and one copy, canon's.
          `hidden` keeps it out of the layout AND out of the tour: the engine's
          registry drops a node with no box by itself. */}
      <div className="ak-boundary" id="akBoundary" hidden aria-hidden="true">
        <div className="ak-eyebrow">{props.boundary.kicker}</div>
        <h2>{props.boundary.title}</h2>
        <p>{props.boundary.body}</p>
        <Link className="btn primary" href={props.boundary.backHref}>{props.boundary.backLabel}</Link>
      </div>

      {toast && (
        <div className="ak-toast" role="status" aria-live="polite" aria-atomic="true">
          {toast}
        </div>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so the ⚖ page-scroll ruling is untouched. */}
      {tourOpen && (
        <>
          <div
            className="ak-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
              setTourIdx(hit >= 0 ? hit : -1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="ak-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="ak-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="ak-spot-card"
            id="akTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="ak-spot-text">{tourStep?.text ?? ''}</span>
            <div className="ak-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="ak-spot-foot">
              <button type="button" className="ak-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="ak-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="ak-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="ak-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
