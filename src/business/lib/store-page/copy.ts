// お店ページ — the 機能 / 業種 strings, copied byte-for-byte from the approved mock
// (reserve-build-2026-08/item3-switchboard/MOCK-SWITCHBOARD-v2.html; line numbers cited per block).
// Never retyped, never authored here (R82); every literal below was script-checked as a substring of the mock (S49 P1).
// Keys here are the INTERNAL lowercase CapKeys; the wire is UPPER-case snake (R121: CORE-47's owner record = the mock's
// UPPER_CASE names, mapped 1:1 by model.ts wireKeyOf). The record's business_type = the Karute type key (26, model.ts
// BUSINESS_TYPE_KEYS); Family below is an INTERNAL grouping only (R143). `reuse_import` is written in
// backticks: business-isolation.test.ts's side-effect-import pattern reads the quoted form as an import.

export type CapKey =
  | 'checkin_qr' | 'packs' | 'classes' | 'homecare' | 'photo_proof' | 'video_proof'
  | 'posts' | 'read_points' | 'reactions' | `reuse_import` | 'intake' | 'waitlist'
  | 'shop' | 'points_discount' | 'points_full_pay' | 'rental'

/** The count a row needs before it can show (mock STORES.counts keys, :938). */
export type NeedKey = 'packs' | 'classes' | 'care' | 'posts' | 'questions' | 'products' | 'resources'

export interface CapRow {
  readonly key: CapKey
  readonly ja: string
  readonly desc: string
  readonly need?: NeedKey
  readonly needJa?: string
  readonly add?: string
  /** The OFF ask's sentence — only rows that carry one ever ask (spec D2). */
  readonly off?: string
  /** Set on sub rows only. */
  readonly parent?: CapKey
}

/** REG (:880-916) in mock order, each parent followed by its subs. */
export const REG: readonly CapRow[] = [
  { key: 'checkin_qr', ja: '受付QR', desc: 'お客様がお店でQRコードを見せて、受付できるようにします。' },
  { key: 'packs', ja: '回数券', desc: '回数券の残り回数をお客様のアプリに出し、新しい回数券も買えるようにします。',
    need: 'packs', needJa: '回数券', add: '回数券を追加',
    off: 'お客様の残りの回数はそのまま使えます。新しい販売だけが止まります。' },
  { key: 'classes', ja: 'クラス', desc: 'レッスンの時間割を出して、お客様が席を予約できるようにします。',
    need: 'classes', needJa: 'レッスン', add: 'レッスンを追加',
    off: '予約済みの回はそのまま開催されます。新しい席の予約だけが止まります。' },
  { key: 'homecare', ja: 'ホームケア', desc: 'おうちでのケアをお伝えして、お客様が記録できるようにします。',
    need: 'care', needJa: 'ケア', add: 'ケアを追加',
    off: 'お客様が受け取った内容と写真はそのまま見られます。新しい課題だけが止まります。' },
  { key: 'photo_proof', ja: '写真で報告', desc: 'お客様が写真を添えて記録できるようにします。', parent: 'homecare' },
  { key: 'video_proof', ja: '動画で報告', desc: 'お客様が動画を添えて記録できるようにします。', parent: 'homecare' },
  { key: 'posts', ja: 'お知らせ', desc: 'お店からの投稿をお客様のアプリに出します。',
    need: 'posts', needJa: '投稿', add: '投稿を追加',
    off: 'これまでの投稿はお客様に残ります。新しい投稿と、読んで貯まるポイントが止まります。' },
  { key: 'read_points', ja: '読んでポイント', desc: 'お知らせを読んだお客様にポイントがたまります。', parent: 'posts' },
  { key: 'reactions', ja: 'リアクション', desc: 'お客様がお知らせにリアクションできるようにします。', parent: 'posts' },
  { key: `reuse_import`, ja: '再利用の取り込み', desc: 'ほかのお店で書いた投稿を、こちらにも取り込めるようにします。', parent: 'posts' },
  { key: 'intake', ja: '問診票', desc: 'ご予約のあとに、お客様にお答えいただく質問をお出しします。',
    need: 'questions', needJa: '質問', add: '質問を追加' },
  { key: 'waitlist', ja: '待機リスト', desc: 'その日やレッスンが満席のとき、キャンセル待ちに登録できるようにします。' },
  { key: 'shop', ja: '物販', desc: '商品を並べて、お客様が注文してお店で受け取れるようにします。',
    need: 'products', needJa: '商品', add: '商品を追加',
    off: '受け付け済みの注文は最後まで進みます。新しい注文だけが止まります。' },
  { key: 'points_discount', ja: 'ポイントで割引', desc: 'お買いものにポイントを使えるようにします。', parent: 'shop' },
  { key: 'points_full_pay', ja: 'ポイントで全額', desc: 'ポイントだけでお買いものができるようにします。', parent: 'shop' },
  { key: 'rental', ja: '設備レンタル', desc: 'ロッカーなどを月ぎめで貸し出せるようにします。',
    need: 'resources', needJa: '設備', add: '設備を追加',
    off: '契約中のロッカーはそのままです。新しい契約だけが止まります。' },
]

export type Family = 'SALON' | 'GYM' | 'CLINIC' | 'RETAIL' | 'GENERIC'

/** TYPE_JA (:922), the 業種 seg's five labels in mock order. */
export const TYPE_JA: Readonly<Record<Family, string>> = {
  SALON: '美容室', GYM: 'ジム・スタジオ', CLINIC: '整体・クリニック', RETAIL: '物販中心', GENERIC: 'その他',
}

/** statusChip (:1637-1645). */
export const CHIP = {
  off: 'オフ',
  on: 'お客様に表示中',
  need: (needJa: string): string => '準備が必要 ・ ' + needJa + 'が0件',
} as const

/** srcNote (:1620-1624). The mock's fallback 「9月14日」/「店長」 is demo data and is NOT copied (D-NOT-BUILT). */
export const SOURCE = {
  typeDefault: '業種の標準',
  owner: (when: string, who: string): string => 'お店で設定 ・ ' + when + ' ・ ' + who,
} as const

/** requestToggle's ask (:1691-1714): title doubles as the dialog's aria-label. */
export const ASK = {
  title: (ja: string): string => ja + 'をオフにしますか',
  cancel: 'やめる',
  confirm: 'オフにする',
} as const

/** openTypeDialog (:1719-1764) + the block's button (:810). Diff lines = two spans: name, then value (SPECCHECK fix 5). */
export const RESET = {
  button: '業種の標準に戻す',
  title: '業種の標準に戻しますか',
  body: (typeJa: string): string => '業種「' + typeJa + '」の標準の組み合わせにします。変わるのは次のところだけです。',
  none: '変わるところはありません',
  keep: '変更なし（お店で設定済み）',
  flip: (from: boolean, to: boolean): string => (from ? 'オン' : 'オフ') + ' → ' + (to ? 'オン' : 'オフ'),
  cancel: 'やめる',
  confirm: '戻す',
  toast: (typeJa: string): string => '業種「' + typeJa + '」の標準に戻しました。保存するとお客様のアプリに反映されます',
} as const

/** The 業種 block (:799-801): h3 (doubles as the seg's aria-label, :803) + its sub. */
export const TYPE_BLOCK = {
  title: '業種',
  sub: '業種は、下の機能の「標準の組み合わせ」を決めるためのものです。選んでも、その場では何も変わりません。',
} as const

/** renderHonest (:1947-1958). */
export const HONEST = {
  pending: (ja: string, needJa: string): string => ja + 'はオンですが、' + needJa + 'が0件のため、まだお客様には出ません',
  waitlist: '待機リストはオンですが、いま満席のレッスンや枠がないため、画面には出ていません',
} as const

/** The section's own undo (button :834, toast :2072) — D-SAVE. */
export const UNDO = {
  button: '元に戻す',
  toast: '変更を元に戻しました',
} as const

/** The 業種 / 機能 blocks' headings (:800, :816) and their sub lines (:801, :817) — the tour's guide pair per block. */
export const BLOCK_GUIDES: readonly { readonly title: string; readonly guide: string }[] = [
  { title: '業種', guide: '業種は、下の機能の「標準の組み合わせ」を決めるためのものです。選んでも、その場では何も変わりません。' },
  { title: '機能', guide: 'オンにすると、お客様のアプリのお店ページにその場所が出ます。出すものがまだ無いときは、用意できるまでお客様には出ません。' },
]

/** What a reader can type to find お店ページ beyond カードの見た目 (CARD_LOOK_HEADINGS' pattern): the two block
 *  headings and the 16 row names, straight from REG (one home). */
export const STORE_PAGE_HEADINGS: readonly string[] = [...BLOCK_GUIDES.map((b) => b.title), ...REG.map((r) => r.ja)]
