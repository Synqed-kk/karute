'use client'

// 顧客 — the canon screen's markup and behavior (fable-store-customers.html),
// transplanted. Canon class names, canon Japanese wording, canon structure.
// Values arrive pre-formatted from the server page: no dates, no data access
// and no store lens logic live here.
//
// BATCH-1 INTERACTION FLOOR (⚖ L-7, read-and-play, zero persistence):
//   · search / filters / column show-hide / row select all work client-side
//   · 顧客を追加 adds a row to client state exactly as canon does — it resets
//     on reload, and the toast says so
//   · an action with no canon client transition sits DISABLED with the standing
//     hint, and a link whose screen is not built yet is greyed 準備中. Nothing
//     here ever reports a success the screen cannot show.
//
// ⚖ CUT #7: 本人関係 renders COLLAPSED — one line per party, detail on click,
// and a chip only where the fixture deviates. The exploded five-party box never
// renders.
// ⚖ CUT #5: canon's subtitle is reduced to one short functional line.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface CustomerRow {
  id: string
  no: string
  name: string
  furigana: string | null
  mark: string
  phone: string | null
  email: string | null
  source: string
  identityCheck: string | null
  storeLabel: string | null
  groupKey: string
  hasNext: boolean
  nextLabel: string
  nextMenu: string
  nextDetail: string
  nextPrice: string
  ticket: number | null
  wallet: number | null
  lastVisitShort: string | null
  lastVisitFull: string | null
  totalSpent: number | null
  consent: { line: boolean; sms: boolean; email: boolean } | null
  lineLinked: boolean
  merge: 'open' | 'pending' | 'none'
  duplicateOf: string | null
  party: Array<{ role: string; name: string; note: string }>
  thin: boolean
  externalOwner: boolean
  note: string | null
  history: Array<{ date: string; service: string; amount: string }>
  bookings: Array<{ date: string; detail: string }>
}

type FilterKey = 'all' | 'future' | 'ticket' | 'wallet' | 'merge'

const FILTERS: Array<{ k: FilterKey; label: string }> = [
  { k: 'all', label: 'すべて' },
  { k: 'future', label: '次回予約' },
  { k: 'ticket', label: '回数券' },
  { k: 'wallet', label: '預かり残高' },
  { k: 'merge', label: '重複候補' },
]

/** Canon's data-columns-config, verbatim widths. `nw` is the ≤1320px track the
 *  canon @media block declares for the four default columns. */
const COLUMNS = [
  { k: 'person', label: '顧客', w: 'minmax(170px, 1.3fr)', nw: 'minmax(140px, 1.2fr)', optional: false },
  { k: 'next', label: '次回予約', w: 'minmax(126px, 1fr)', nw: 'minmax(104px, 1fr)', optional: false },
  { k: 'ticket', label: '回数券・残高', w: '120px', nw: '100px', optional: false },
  { k: 'confirm', label: '確認', w: '92px', nw: '78px', optional: false },
  { k: 'lastVisit', label: '最終来店', w: '96px', nw: '96px', optional: true },
  { k: 'totalSpent', label: '累計支払', w: '104px', nw: '104px', optional: true },
  { k: 'consent', label: '連絡同意', w: '108px', nw: '108px', optional: true },
] as const

const MERGE_LABEL: Record<CustomerRow['merge'], string> = {
  open: '重複候補',
  pending: '統合確認中',
  none: '確認済み',
}

const HINT = '見本データのため実行できません'

// Exported for the suite: "a missing value says 「—」" is the rule the canon
// crash and the ¥0 misread both came from, so it gets asserted directly.
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
export const ticketLabel = (n: number | null) => (n == null || n === 0 ? 'なし' : `残 ${n}回`)
/** null is stated as 「—」, never rendered as ¥0 (⚖ L-6 null-guard). */
export const walletLabel = (n: number | null) => (n == null ? '—' : yen(n))
export const spentLabel = (n: number | null) => (n == null ? '—' : yen(n))
export function consentLabel(c: CustomerRow['consent']): string {
  if (!c) return '—'
  const on = [c.line && 'LINE', c.sms && 'SMS', c.email && 'メール'].filter(Boolean)
  return on.length ? on.join('・') : '同意なし'
}

export function CustomersScreen({
  rows,
  lensLabel,
  grouped,
}: {
  rows: CustomerRow[]
  lensLabel: string
  grouped: boolean
}) {
  const [added, setAdded] = useState<CustomerRow[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(rows[0]?.id ?? null)
  const [optional, setOptional] = useState<string[]>([])
  const [colsOpen, setColsOpen] = useState(false)
  const [openParty, setOpenParty] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  const all = useMemo(() => [...rows, ...added], [rows, added])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const columns = useMemo(
    () => COLUMNS.filter((c) => !c.optional || optional.includes(c.k)),
    [optional],
  )
  // Both track lists ride as custom properties; the stylesheet's 1320px media
  // query picks between them, exactly as canon's own @media does.
  const trackStyle = {
    '--fx-wide': columns.map((c) => c.w).join(' '),
    '--fx-narrow': columns.map((c) => c.nw).join(' '),
  } as React.CSSProperties

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = all.filter((r) => {
      const passesFilter =
        filter === 'all' ||
        (filter === 'future' && r.hasNext) ||
        (filter === 'ticket' && r.ticket != null && r.ticket > 0) ||
        (filter === 'wallet' && r.wallet != null && r.wallet > 0) ||
        (filter === 'merge' && r.merge !== 'none')
      if (!passesFilter) return false
      if (!q) return true
      return [r.name, r.furigana, r.no, r.phone].some((v) => v?.toLowerCase().includes(q))
    })
    if (!grouped) return matched
    // Stores in order, then the CM-9 unassigned bucket LAST — it is the
    // exception, not the headline.
    const key = (r: CustomerRow) => r.groupKey || '￿'
    return [...matched].sort((a, b) => key(a).localeCompare(key(b)) || a.no.localeCompare(b.no))
  }, [all, filter, search, grouped])

  const current = all.find((r) => r.id === selected) ?? visible[0] ?? all[0] ?? null
  const offList = current != null && !visible.some((r) => r.id === current.id)

  const unresolved = all.filter((r) => r.merge !== 'none').length
  const counts = {
    total: all.length,
    future: all.filter((r) => r.hasNext).length,
    ticket: all.filter((r) => r.ticket != null && r.ticket > 0).length,
    wallet: all.filter((r) => r.wallet != null && r.wallet > 0).length,
  }

  function toggleOptional(k: string) {
    setOptional((was) => (was.includes(k) ? was.filter((x) => x !== k) : [...was, k]))
  }

  function submitCreate(form: HTMLFormElement) {
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const phone = String(data.get('phone') ?? '').trim()
    if (!name || !phone) return false
    const seq = 90001 + added.length
    const row: CustomerRow = {
      id: `local-${seq}`,
      no: `C-${seq}`,
      name,
      furigana: String(data.get('kana') ?? '').trim() || null,
      mark: name.split(/\s+/)[0].slice(0, 3),
      phone,
      email: String(data.get('email') ?? '').trim() || null,
      source: String(data.get('source') ?? '店頭登録'),
      identityCheck: null,
      storeLabel: grouped ? '店舗未設定' : null,
      groupKey: '',
      hasNext: false,
      nextLabel: 'なし',
      nextMenu: '予約なし',
      nextDetail: '次回予約なし',
      nextPrice: '予約確定後に記録',
      ticket: null,
      wallet: null,
      lastVisitShort: null,
      lastVisitFull: null,
      totalSpent: 0,
      consent: { line: false, sms: false, email: false },
      lineLinked: false,
      merge: 'none',
      duplicateOf: null,
      party: [],
      thin: false,
      externalOwner: false,
      note: null,
      history: [],
      bookings: [],
    }
    setAdded((was) => [...was, row])
    setSelected(row.id)
    setToast(`${name}さんをこの画面の中だけに追加しました。再読み込みすると消えます`)
    return true
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{lensLabel} / 運営情報</div>
          <h1>顧客</h1>
          <p className="subtitle">顧客の本人情報・予約・回数券・残高を確認します。</p>
        </div>
        <div className="head-actions">
          <button className="btn" type="button" disabled title="受信トレイは準備中です">
            受信トレイで連絡（準備中）
          </button>
          <button className="btn primary" type="button" onClick={() => dialogRef.current?.showModal()}>
            顧客を追加
          </button>
        </div>
      </header>

      <section className="summary" aria-label="顧客の概要">
        <div className="summary-main">
          <strong>{lensLabel}の顧客 {counts.total}名</strong>
          <span>
            検索と一覧には予約・レジの記録だけの方も含みます。件数・検索は表示できる店舗と項目から導出します。
          </span>
        </div>
        <div className="summary-stat"><span>次回予約あり</span><b>{counts.future}</b></div>
        <div className="summary-stat"><span>回数券あり</span><b>{counts.ticket}</b></div>
        <div className="summary-stat"><span>預かり残高あり</span><b>{counts.wallet}</b></div>
        <div className="summary-stat"><span>重複候補</span><b className="attention">{unresolved}</b></div>
      </section>

      {unresolved > 0 && (
        <section className="identity-alert" aria-labelledby="mergeIncidentTitle">
          <div>
            <strong id="mergeIncidentTitle">{unresolved}件の重複候補を先に確認</strong>
            <span>本人情報を誤って統合すると、予約・回数券・預かり残高の所有先が変わります。自動統合はしません。</span>
          </div>
          {/* The confirm screen is 顧客プロフィール, which is not built — greyed,
              never a dead link (L-7). */}
          <button className="btn danger" type="button" disabled title="顧客プロフィールは準備中です">
            先頭を確認（準備中）
          </button>
        </section>
      )}

      <div className="workspace">
        <section className="panel" id="customerPanel" style={trackStyle} aria-labelledby="customerListTitle">
          <div className="panel-head">
            <div>
              <strong id="customerListTitle">顧客一覧</strong>
              <span aria-live="polite">{visible.length}名を表示 / この店舗範囲 {all.length}名</span>
            </div>
            <div className="panel-actions" style={{ position: 'relative' }}>
              {/* CSV writes a file, which the play phase cannot do — disabled
                  with the standing hint rather than a toast that claims work. */}
              <button className="btn text" type="button" disabled title={HINT}>
                表示中をCSV
              </button>
              <button
                className="btn"
                type="button"
                aria-expanded={colsOpen}
                onClick={() => setColsOpen((v) => !v)}
              >
                表示設定
              </button>
              {colsOpen && (
                <div className="fx-cols-pop" role="group" aria-label="表示する列">
                  <h3>表示する列</h3>
                  {COLUMNS.map((c) => (
                    <label className="fx-cols-opt" key={c.k}>
                      <input
                        type="checkbox"
                        checked={!c.optional || optional.includes(c.k)}
                        disabled={!c.optional}
                        onChange={() => toggleOptional(c.k)}
                      />
                      {c.label}
                    </label>
                  ))}
                  <p className="fx-cols-note">列の表示はこの画面の中だけの設定です。再読み込みすると既定に戻ります。</p>
                </div>
              )}
            </div>
          </div>

          <div className="search-row">
            <input
              className="search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名前・電話・顧客番号で検索"
              aria-label="顧客を検索"
            />
            <button className="btn" type="button" onClick={() => setSearch('')}>検索をクリア</button>
          </div>

          <div className="filters" role="group" aria-label="顧客一覧の絞り込み">
            {FILTERS.map((f) => (
              <button
                key={f.k}
                className="filter"
                type="button"
                aria-pressed={filter === f.k}
                onClick={() => setFilter(f.k)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="fx-scroll">
            <div className="list-head" aria-hidden="true">
              {columns.map((c) => (
                <span key={c.k} className={c.k === 'confirm' ? 'badge-col' : undefined}>{c.label}</span>
              ))}
            </div>
            <div className="customer-list">
              {visible.map((r, i) => {
                const newGroup = grouped && (i === 0 || visible[i - 1].groupKey !== r.groupKey)
                return (
                  <div key={r.id}>
                    {newGroup && (
                      <div className="w2-cross-store-group">
                        {r.storeLabel ?? '店舗未設定'} — 顧客IDを共通キーとして店舗別事実を表示
                      </div>
                    )}
                    <button
                      type="button"
                      className={`customer-row${r.id === current?.id ? ' selected' : ''}`}
                      aria-pressed={r.id === current?.id}
                      onClick={() => setSelected(r.id)}
                    >
                      {columns.map((c) => {
                        if (c.k === 'person') {
                          return (
                            <span className="person" key={c.k}>
                              <span className={`person-mark${r.mark.length > 2 ? ' long' : ''}`}>{r.mark}</span>
                              <span>
                                <strong>{r.name}</strong>
                                <span className="person-sub">{r.no} / {r.phone ?? '電話未登録'}</span>
                                <small className="w2-provenance">
                                  {r.storeLabel ? `${r.storeLabel} / 共通顧客ID` : '共通顧客ID'}
                                </small>
                              </span>
                            </span>
                          )
                        }
                        if (c.k === 'next') {
                          return (
                            <span className="cell" key={c.k}>
                              <strong>{r.nextLabel}</strong>
                              <span>{r.nextMenu}</span>
                            </span>
                          )
                        }
                        if (c.k === 'ticket') {
                          return (
                            <span className="cell" key={c.k}>
                              <strong>{r.thin ? '—' : ticketLabel(r.ticket)}</strong>
                              <span>{r.thin ? '簡易表示のみ' : `残高 ${walletLabel(r.wallet)}`}</span>
                            </span>
                          )
                        }
                        if (c.k === 'confirm') {
                          return (
                            <span className="badge-col" key={c.k}>
                              <span className={`pill${!r.thin && r.merge === 'open' ? ' alert' : ''}`}>
                                {r.thin ? 'サンプル簡易表示' : MERGE_LABEL[r.merge]}
                              </span>
                            </span>
                          )
                        }
                        if (c.k === 'lastVisit') {
                          return <span className="cell num" key={c.k}><strong>{r.lastVisitShort ?? '—'}</strong></span>
                        }
                        if (c.k === 'totalSpent') {
                          return <span className="cell num" key={c.k}><strong>{spentLabel(r.totalSpent)}</strong></span>
                        }
                        return <span className="cell" key={c.k}><strong>{consentLabel(r.consent)}</strong></span>
                      })}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {visible.length === 0 && (
            <div className="empty">
              <strong>一致する顧客はいません</strong>
              <span>検索語または絞り込みを変えてください。</span>
            </div>
          )}
        </section>

        {current && (
          <aside className="panel detail" aria-labelledby="detailTitle">
            <div className="detail-head">
              <div className="detail-kicker">顧客 {current.no}{current.thin ? ' ・ サンプル簡易表示' : ''}</div>
              <h2 id="detailTitle">{current.name}</h2>
              <p>
                {current.furigana ? `${current.furigana} / ` : ''}
                {current.lastVisitFull ? `最終来店 ${current.lastVisitFull}` : '来店記録なし'}
              </p>
            </div>
            <div className="detail-body">
              {offList && (
                <p className="w2-off-list">
                  選択中の顧客は現在の検索・絞り込みには含まれていません。選択は保持しています。
                </p>
              )}

              <div className="section-title">本人情報</div>
              <div className="identity">
                <div className="identity-item"><span>携帯番号</span><b>{current.phone ?? '未登録'}</b></div>
                <div className="identity-item"><span>メール</span><b>{current.email ?? '未登録'}</b></div>
                <div className="identity-item"><span>登録元</span><b>{current.source}</b></div>
                <div className="identity-item"><span>本人確認</span><b>{current.identityCheck ?? '未確認'}</b></div>
              </div>

              <PartyBlock
                row={current}
                open={openParty === current.id}
                onToggle={() => setOpenParty((v) => (v === current.id ? null : current.id))}
              />

              {!current.thin && current.merge === 'open' && (
                <div className="merge-warning">
                  <strong>同じ電話番号の重複候補があります</strong>
                  <span>
                    共通本人情報と店舗別の予約・回数券・残高・履歴を分けて比較します。自動統合はしません。
                    {current.duplicateOf ? `（相手 ${current.duplicateOf}）` : ''}
                  </span>
                  <button className="btn danger" type="button" disabled title="顧客プロフィールは準備中です">
                    重複候補を確認（準備中）
                  </button>
                </div>
              )}
              {!current.thin && current.merge === 'pending' && (
                <div className="merge-warning">
                  <strong>統合申請を確認中</strong>
                  <span>申請 M-{current.no.slice(2)}。承認までは2つの顧客を別々に保持します。</span>
                </div>
              )}

              {current.thin ? (
                <>
                  {current.note && (
                    <div className="record-boundary">
                      <strong>{current.externalOwner ? '編集できない理由' : 'メモ'}</strong>
                      <br />
                      {current.note}
                    </div>
                  )}
                  <div className="section-title">関連する予約・レジ記録</div>
                  <div className="fact-list">
                    {current.bookings.length === 0 ? (
                      <div className="fact"><span>記録</span><b>関連する予約はありません</b></div>
                    ) : (
                      current.bookings.map((b, i) => (
                        <div className="fact" key={i}><span>{b.date}</span><b>{b.detail}</b></div>
                      ))
                    )}
                  </div>
                  <div className="record-boundary">
                    <strong>サンプル簡易表示について</strong>
                    <br />
                    {current.externalOwner
                      ? 'この方は予約・レジの運営記録にのみ登場する簡易表示です。本人情報の正本は外部予約元のため、SYNQEDからは編集できません。'
                      : 'この方は予約・レジの運営記録にのみ登場し、本人プロフィールはまだ登録されていません。プロフィール側が本人情報・同意・連絡の操作を一つに所有します。'}
                  </div>
                </>
              ) : (
                <>
                  <div className="section-title">保有状況</div>
                  <div className="metric-strip">
                    <div className="metric"><span>回数券</span><b>{ticketLabel(current.ticket)}</b></div>
                    <div className="metric"><span>預かり残高</span><b>{walletLabel(current.wallet)}</b></div>
                    <div className="metric"><span>累計支払</span><b>{spentLabel(current.totalSpent)}</b></div>
                  </div>

                  <div className="section-title">次回予約</div>
                  <div className="fact-list">
                    <div className="fact"><span>予約</span><b>{current.nextDetail}</b></div>
                    <div className="fact"><span>受付価格</span><b>{current.nextPrice}</b></div>
                  </div>

                  <div className="section-title">連絡同意</div>
                  <div className="consent-box">
                    <div className="consent-row">
                      <strong>LINE</strong>
                      <span>
                        {current.consent == null
                          ? '—'
                          : current.consent.line
                            ? current.lineLinked
                              ? '同意あり / 連携確認済み'
                              : '同意あり / 連携未確認'
                            : '同意なし'}
                      </span>
                    </div>
                    <div className="consent-row">
                      <strong>SMS</strong>
                      <span>{current.consent == null ? '—' : current.consent.sms ? (current.phone ?? '同意あり') : '同意なし'}</span>
                    </div>
                    <div className="consent-row">
                      <strong>メール</strong>
                      <span>{current.consent == null ? '—' : current.consent.email ? (current.email ?? '同意あり') : '同意なし'}</span>
                    </div>
                  </div>

                  <div className="section-title">来店履歴</div>
                  <div className="history">
                    {current.history.length === 0 ? (
                      <div className="history-row"><time>—</time><span><strong>来店記録はありません</strong></span></div>
                    ) : (
                      current.history.map((h, i) => (
                        <div className="history-row" key={i}>
                          <time>{h.date}</time>
                          <span><strong>{h.service}</strong><span>{h.amount}</span></span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="record-boundary">
                    <strong>正本と操作の所有</strong>
                    <br />
                    この一覧は参照と新規顧客追加だけを所有します。本人情報・同意・連絡・重複判断は顧客プロフィールが一つに所有します。
                  </div>
                </>
              )}

              <div className="detail-actions">
                <button className="btn" type="button" disabled title="顧客プロフィールは準備中です">顧客プロフィールを開く（準備中）</button>
                <button className="btn" type="button" disabled title="カルテ連携は準備中です">Karuteを開く（準備中）</button>
                <button className="btn" type="button" disabled title="受信トレイは準備中です">受信トレイで連絡（準備中）</button>
              </div>
            </div>
          </aside>
        )}
      </div>

      <dialog ref={dialogRef} aria-labelledby="createCustomerTitle">
        <form
          method="dialog"
          onSubmit={(e) => {
            if (!submitCreate(e.currentTarget)) e.preventDefault()
          }}
        >
          <div className="dialog-head">
            <div>
              <h2 id="createCustomerTitle">新規顧客を追加</h2>
              <p>顧客はサービスを受ける人です。ペットなどの対象は顧客として追加しません</p>
            </div>
            <button className="close" type="button" aria-label="閉じる" onClick={() => dialogRef.current?.close()}>×</button>
          </div>
          <div className="dialog-body consent-form">
            <label className="consent-field">氏名<input name="name" required placeholder="例: 見本 はなこ" /></label>
            <label className="consent-field">フリガナ<input name="kana" placeholder="例: ミホン ハナコ" /></label>
            <label className="consent-field">携帯番号<input name="phone" required placeholder="例: 090-0000-0000" /></label>
            <label className="consent-field">メール<input name="email" placeholder="例: hanako@sample.invalid" /></label>
            <label className="consent-field">
              登録元
              <select name="source" defaultValue="店頭登録">
                <option>店頭登録</option>
                <option>電話予約</option>
                <option>Reserve本人登録</option>
                <option>旧CSV移行</option>
              </select>
            </label>
            <div className="merge-proof">
              氏名と携帯番号は必須です。連絡同意は未確認のまま登録し、確認後に別途記録します。
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn" type="button" onClick={() => dialogRef.current?.close()}>戻る</button>
            <button className="btn primary" type="submit">この画面内に顧客を追加</button>
          </div>
        </form>
      </dialog>

      <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {toast}
      </div>
    </div>
  )
}

/** 本人関係 (D8), collapsed per ⚖ cut #7. The 顧客 line always renders; a
 *  サービス対象 / 保護者 / 支払者 line renders only where the fixture says that
 *  party is someone else, and carries a 別の方 chip so the deviation is the
 *  thing that catches the eye. */
function PartyBlock({
  row,
  open,
  onToggle,
}: {
  row: CustomerRow
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <div className="section-title">本人関係</div>
      <div className="party-list">
        <button className="party-row" type="button" onClick={onToggle} aria-expanded={open}>
          <span>顧客</span>
          <b>{row.name}</b>
        </button>
        {row.party.map((p) => (
          <button className="party-row" type="button" key={p.role} onClick={onToggle} aria-expanded={open}>
            <span>{p.role}</span>
            <b>{p.name}</b>
            <span className="pill warn">別の方</span>
          </button>
        ))}
        {open && (
          <div className="party-note">
            {row.party.length === 0
              ? 'サービス対象・保護者・支払者はすべてご本人です。'
              : row.party.map((p) => `${p.role}: ${p.name} — ${p.note}`).join(' / ')}
          </div>
        )}
      </div>
    </>
  )
}
