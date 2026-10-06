// FIXTURE — practice sample data for the お店ページ preview body, not product data.
// Copied from MOCK-SWITCHBOARD-v2.html; the staff member's name replaced by an invented one (S71) :935-1004 (`var STORES`, the mock's two sample stores and
// their `rv` phone data); only the first line's `var STORES =` became `export const STORES =` and the closing
// `};` became `} as const);` inside deepFreeze (R185: frozen at runtime, not only in the types). Never retyped, never edited: a new sample comes from the mock, not from here.
// The dates/names (「9/14（月）14:30」, 水瀬 ことは — an invented person …) are the approved mock's fixed sample (D-NOT-BUILT: never product data).
import type { Counts } from "@/business/lib/store-page/model";

/** Freezes every object and array under `o` (R185): a write through a cast cannot change the sample. */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const STORES = deepFreeze({
  laestro:{
    id:"laestro", name:"La Estro 代官山院", type:"SALON",
    counts:{packs:3, classes:0, care:2, posts:4, questions:3, products:3, resources:0},
    rv:{
      serif:true, display:"La Estro", branch:"代官山院",
      addr:"東京都渋谷区代官山町12-18\nINO II ビル 2F",
      g1:"#1a6b55", g2:"#0d4a3a", coverH:210,
      rank:"GOLD MEMBER",
      next:{line:"次回のご予約", big:"9/14（月）14:30", side:"回数券 残り4回"},
      bookings:[
        {t:"今日 14:30", s:"回数券消化・水瀬 ことは・代官山院"},
        {t:"9月22日 14:00", s:"回数券消化・水瀬 ことは・代官山院"}
      ],
      posts:[
        {t:"秋のはじめ、頭皮と首まわりのケアについて", d:"9月11日（金）"},
        {t:"10月の営業時間について", d:"9月5日（土）"},
        {t:"担当スタッフのご紹介 — 水瀬", d:"8月24日（月）"},
        {t:"秋の新しいメニューのご案内", d:"8月10日（月）"}
      ],
      visits:[
        {t:"回数券消化", badge:"回数券", d:"2026年9月7日（月） ・ 水瀬 ことは ・ 代官山院"},
        {t:"VIP施術", money:"￥27,000", d:"2026年8月27日（木） ・ 水瀬 ことは ・ 代官山院"},
        {t:"VIP施術", money:"￥27,000", d:"2026年7月24日（金） ・ 水瀬 ことは ・ 代官山院"},
        {t:"VIP施術", money:"￥27,000", d:"2026年6月21日（日） ・ 水瀬 ことは ・ 代官山院"},
        {t:"VIP施術", money:"￥27,000", d:"2026年5月18日（月） ・ 水瀬 ことは ・ 代官山院"}
      ],
      packs:[{t:"VIP施術 10回券", d:"残り4回 ・ 有効期限 2027年2月28日"}],
      care:[
        {t:"頭皮マッサージ", d:"週3回 ・ 最後の記録 9月12日（土）"},
        {t:"夜のトリートメント", d:"週2回 ・ 最後の記録 9月10日（木）"}
      ],
      classes:[], lockers:null,
      products:[
        {t:"リペアシャンプー 300ml", pr:"￥4,180 税込", c:"#dfe7e2"},
        {t:"ヘアオイル ベルガモット", pr:"￥3,520 税込", c:"#eae1d4"},
        {t:"頭皮用ブラシ", pr:"￥2,750 税込", c:"#e3e0e8"}
      ],
      emptyVisits:"ご来店いただくと、こちらに残ります",
      category:"サロン"
    }
  },
  force:{
    id:"force", name:"STUDIO FORCE 渋谷", type:"GYM",
    counts:{packs:0, classes:12, care:1, posts:2, questions:0, products:0, resources:24},
    rv:{
      serif:false, display:"STUDIO FORCE", branch:"パーソナルジム",
      addr:"", g1:"#c05634", g2:"#a8412a", coverH:172,
      rank:"",
      next:{line:"", big:"", side:"", none:"いつでもご予約いただけます"},
      bookings:[],
      posts:[
        {t:"9月のレッスン追加のお知らせ", d:"9月9日（水）"},
        {t:"ロッカーの入れ替えについて", d:"8月30日（日）"}
      ],
      visits:[],
      packs:[],
      care:[{t:"股関節ストレッチ", d:"週3回 ・ 最後の記録 9月13日（日）"}],
      classes:[
        {tm:"07:00", nm:"モーニングHIIT", sub:"45分 ・ 佐々木 亮", seats:3},
        {tm:"12:00", nm:"バーベルベーシック", sub:"60分 ・ 高橋 詩織", seats:0},
        {tm:"19:30", nm:"コンディショニング", sub:"50分 ・ 佐々木 亮", seats:1}
      ],
      lockers:{t:"ロッカー（月額）", d:"空き 6/24 ・ ￥3,300 税込 / 月"},
      products:[],
      emptyVisits:"レッスンにご参加いただくと、こちらに残ります",
      category:"パーソナルジム"
    }
  }
} as const);

/** What the preview body reads from one sample store (both STORES entries satisfy it). */
export interface StorePageSample {
  readonly name: string
  readonly counts: Counts
  readonly rv: {
    readonly rank: string
    readonly next: { readonly line: string; readonly big: string; readonly side: string }
    readonly posts: ReadonlyArray<{ readonly t: string; readonly d: string }>
    readonly bookings: ReadonlyArray<{ readonly t: string; readonly s: string }>
    readonly classes: ReadonlyArray<{ readonly tm: string; readonly nm: string; readonly sub: string; readonly seats: number }>
    readonly products: ReadonlyArray<{ readonly t: string; readonly pr: string; readonly c: string }>
    readonly lockers: { readonly t: string; readonly d: string } | null
    readonly visits: ReadonlyArray<{ readonly t: string; readonly d: string; readonly badge?: string; readonly money?: string }>
    readonly packs: ReadonlyArray<{ readonly t: string; readonly d: string }>
    readonly care: ReadonlyArray<{ readonly t: string; readonly d: string }>
    readonly emptyVisits: string
  }
}
