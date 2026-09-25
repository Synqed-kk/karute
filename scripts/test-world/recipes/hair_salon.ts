// ヘアサロン — the fill data for a hair-salon test store. DATA only: the loader (fill.ts) reads it by type id;
// the counts it must match live in registry.json. Every person, phone and address here is invented: phones are
// 090-0000-3xxx, mail is @example.jp, memos end 「テストデータ」.
// STORE: テスト自由が丘店 · 東京都目黒区自由が丘2-0-0 テストビル2F · 03-0000-3000
// Stylist ranks, 指名料 and menu add-ons have no core home yet (CORE-25 · CORE-38): nothing here stands in for them.
// No シャンプー台: the planner may seat any menu on any standard resource, so a shampoo station would get cuts.
import type { KaruteCtx, KaruteLine, RecipeCustomer, RecipeData, RequestLine } from '../plan'

const FIRST = '初回カウンセリング＋カット'
const CUT = 'カット'
const MENS = 'メンズカット'
const BANG = '前髪カット'
const GAKU = '学割カット（高校生以下）'
const CUTCOLOR = 'カット＋カラー'
const RETOUCH = 'リタッチカラー'
const ILLUMINA = 'カット＋イルミナカラー'
const HIGHLIGHT = 'カット＋ハイライトカラー'
const PERM = 'カット＋パーマ'
const DIGI = 'カット＋デジタルパーマ'
const STRAIGHT = 'カット＋縮毛矯正'
const TR = 'トリートメント'
const CUTTR = 'カット＋トリートメント'
const SPA = 'ヘッドスパ'
const SET = 'ヘアセット'
const BLOW = 'シャンプー＆ブロー'

const YUI = '見本 ゆい'
const SOTA = '見本 そうた'
const AYAKA = 'テスト あやか'
const REN = '見本 れん'
const MANA = 'テスト まな'
const HINATA = '見本 ひなた'

type Row = [member: string, name: string, kana: string, gender: 'female' | 'male', birth: string, occupation: string, memo: string, theme: string, staff: string, menu: string, alt: string, start: number, every: number | null, isNew: boolean, time: 'am' | 'pm' | 'eve']
const rows: Row[] = [
  ['HS-0001', '青木 真理', 'アオキ マリ', 'female', '1980-05-12', '会社員（総務）', '白髪が増えてきた。暗く染めるより、明るめでなじませたい。', 'gray', YUI, RETOUCH, CUTCOLOR, 2, 35, false, 'am'],
  ['HS-0002', '石田 奈央', 'イシダ ナオ', 'female', '1994-08-22', 'アパレル販売', '透明感のあるベージュ系が好み。ブリーチはしたくない。', 'color', YUI, ILLUMINA, CUTCOLOR, 6, 42, false, 'eve'],
  ['HS-0003', '上田 彩', 'ウエダ アヤ', 'female', '1990-01-15', '会社員（マーケティング）', 'ショートボブをキープしたい。月に一度は切りたい。', 'short', SOTA, CUT, CUTCOLOR, 0, 30, false, 'eve'],
  ['HS-0004', '岡田 翔太', 'オカダ ショウタ', 'male', '1992-03-03', '会社員（営業）', '清潔感のある短めのスタイル。セットは簡単に済ませたい。', 'mens', SOTA, MENS, MENS, 1, 28, false, 'eve'],
  ['HS-0005', '加藤 由美子', 'カトウ ユミコ', 'female', '1966-11-02', '主婦', '白髪染めは根元が目立ってきたら。頭皮が敏感なので薬剤に注意。', 'gray', MANA, RETOUCH, CUTCOLOR, 10, 35, false, 'am'],
  ['HS-0006', '川口 美月', 'カワグチ ミヅキ', 'female', '2000-06-30', '大学生', '就職活動に向けて、暗めの落ち着いた色にしたい。', 'color', AYAKA, CUTCOLOR, CUT, 20, 45, true, 'pm'],
  ['HS-0007', '木下 香織', 'キノシタ カオリ', 'female', '1983-09-09', '看護師', 'くせ毛で梅雨どきに広がる。縮毛矯正は年に数回、間はカットのみ。', 'straight', AYAKA, CUT, STRAIGHT, 3, 42, false, 'pm'],
  ['HS-0008', '小松 大和', 'コマツ ヤマト', 'male', '1988-12-18', '美容商材の営業', '毎月メンズカット。たまにパーマで動きをつけたい。', 'mens', REN, MENS, PERM, 4, 28, false, 'eve'],
  ['HS-0009', '斉藤 千夏', 'サイトウ チナツ', 'female', '1997-07-07', 'ネイリスト', 'ハイライトでデザイン性のあるカラーにしたい。', 'color', YUI, HIGHLIGHT, ILLUMINA, 8, 56, false, 'pm'],
  ['HS-0010', '坂井 美智子', 'サカイ ミチコ', 'female', '1958-04-26', '自営業（呉服店）', 'グレイヘアへの移行を相談中。ハイライトで白髪をなじませたい。', 'gray', YUI, HIGHLIGHT, RETOUCH, 15, 56, false, 'am'],
  ['HS-0011', '杉本 さくら', 'スギモト サクラ', 'female', '1991-02-11', '保育士', 'ゆるいウェーブを保ちたい。朝のスタイリングを楽にしたい。', 'perm', AYAKA, DIGI, CUT, 5, 90, false, 'am'],
  ['HS-0012', '高木 涼介', 'タカギ リョウスケ', 'male', '1985-10-10', 'エンジニア', 'ツーブロックを維持したい。仕事帰りに来店。', 'mens', REN, MENS, MENS, 2, 28, false, 'eve'],
  ['HS-0013', '竹内 由佳', 'タケウチ ユカ', 'female', '1987-03-19', '会社員（経理）', '毛先のダメージが気になる。まとまりやすくしたい。', 'damage', MANA, CUTTR, TR, 9, 42, false, 'eve'],
  ['HS-0014', '田村 陽菜', 'タムラ ヒナ', 'female', '2008-05-05', '高校生', '前髪を自分で切って失敗したので相談したい。', 'short', SOTA, GAKU, BANG, 25, 45, true, 'pm'],
  ['HS-0015', '千葉 恵美', 'チバ エミ', 'female', '1975-08-14', '会社員（管理職）', '白髪をしっかり染めたい。仕事が忙しいので手早く済ませたい。', 'gray', MANA, RETOUCH, RETOUCH, 0, 28, false, 'eve'],
  ['HS-0016', '中島 優', 'ナカジマ ユウ', 'male', '1979-01-24', '公務員', '短髪を月に一度。白髪が少し出てきた。', 'mens', REN, MENS, MENS, 6, 30, false, 'am'],
  ['HS-0017', '西田 あかり', 'ニシダ アカリ', 'female', '1995-11-28', '会社員（受付）', 'ロングの毛先を整えつつ、艶を出したい。', 'damage', YUI, CUTTR, ILLUMINA, 12, 49, false, 'pm'],
  ['HS-0018', '野口 美穂', 'ノグチ ミホ', 'female', '1970-02-03', 'パート（販売）', '髪のボリュームが減ってきた。ふんわりさせたい。', 'perm', AYAKA, PERM, RETOUCH, 30, 60, true, 'am'],
  ['HS-0019', '橋本 美咲', 'ハシモト ミサキ', 'female', '1993-06-17', '会社員（広告）', '友人の結婚式の二次会に合わせてヘアセットを予約。', 'set', MANA, SET, SET, 40, null, false, 'pm'],
  ['HS-0020', '平野 綾香', 'ヒラノ アヤカ', 'female', '1989-09-25', '薬剤師', 'くせが強く、縮毛矯正は年に3回ほど。', 'straight', AYAKA, STRAIGHT, CUT, 14, 90, false, 'pm'],
  ['HS-0021', '福田 美和', 'フクダ ミワ', 'female', '1962-12-07', '主婦', '白髪染めを定期的に。ヘッドスパで頭皮もすっきりさせたい。', 'gray', MANA, RETOUCH, SPA, 4, 35, false, 'am'],
  ['HS-0022', '藤原 陸', 'フジワラ リク', 'male', '2001-04-19', '大学生', 'メンズパーマに挑戦したい。', 'mens', REN, PERM, MENS, 35, 60, true, 'eve'],
  ['HS-0023', '松井 智美', 'マツイ トモミ', 'female', '1984-10-01', '会社員（人事）', '肩につくくらいのボブ。カラーは暗めのブラウン。', 'color', SOTA, CUTCOLOR, CUT, 7, 42, false, 'eve'],
  ['HS-0024', '松本 健', 'マツモト ケン', 'male', '1971-07-11', '会社経営', '短髪のカットと、白髪ぼかし。予約は午前が多い。', 'gray', REN, MENS, RETOUCH, 3, 30, false, 'am'],
  ['HS-0025', '宮本 杏奈', 'ミヤモト アンナ', 'female', '1998-03-21', '看護師', '夜勤の合間に来店。まとめ髪が多く、毛先の傷みが気になる。', 'damage', MANA, CUTTR, CUT, 16, 49, false, 'pm'],
  ['HS-0026', '森田 陽子', 'モリタ ヨウコ', 'female', '1968-05-29', '教員', '白髪染めとカットを同じ日に。夏休み中は間隔が空く。', 'gray', YUI, CUTCOLOR, RETOUCH, 1, 42, false, 'pm'],
  ['HS-0027', '山内 拓真', 'ヤマウチ タクマ', 'male', '1996-09-14', '会社員（IT）', '口コミを見て予約。清潔感のある短めのスタイルにしたい。', 'mens', SOTA, MENS, MENS, 45, 28, true, 'eve'],
  ['HS-0028', '山下 真由', 'ヤマシタ マユ', 'female', '1990-12-24', '会社員（秘書）', '産後で髪のボリュームが落ちた。手入れが楽なショートにしたい。', 'short', SOTA, CUT, CUTTR, 50, 35, true, 'am'],
  ['HS-0029', '吉川 奈々', 'ヨシカワ ナナ', 'female', '1986-07-02', 'デザイナー', 'ヘッドスパが好き。カットの合間にスパだけで来ることもある。', 'damage', REN, CUT, SPA, 11, 42, false, 'pm'],
  ['HS-0030', '渡部 和夫', 'ワタベ カズオ', 'male', '1955-03-08', '税理士', '長年同じ髪型。二か月に一度のカット。', 'mens', REN, MENS, MENS, 20, 56, false, 'am'],
]
const MAIL = ['mari.aoki', 'nao.ishida', 'aya.ueda', 'shota.okada', 'yumiko.kato', 'mizuki.kawaguchi', 'kaori.kinoshita', 'yamato.komatsu', 'chinatsu.saito', 'michiko.sakai', 'sakura.sugimoto', 'ryosuke.takagi', 'yuka.takeuchi', 'hina.tamura', 'emi.chiba', 'yu.nakajima', 'akari.nishida', 'miho.noguchi', 'misaki.hashimoto', 'ayaka.hirano', 'miwa.fukuda', 'riku.fujiwara', 'tomomi.matsui', 'ken.matsumoto', 'anna.miyamoto', 'yoko.morita', 'takuma.yamauchi', 'mayu.yamashita', 'nana.yoshikawa', 'kazuo.watabe']

const customers: RecipeCustomer[] = rows.map(([member, name, kana, gender, birth, occupation, memo, theme, staff, menu, alt, start, every, isNew, time], i) => ({
  member, name, kana, gender, birth, occupation, memo: `${memo}\nテストデータ`, theme, staff, menu, alt, start, every, isNew, time,
  phone: `090-0000-${3001 + i}`, email: `${MAIL[i]}@example.jp`,
}))

// ── 施術記録: born-native stylist notes. The wish and the hand-over follow the customer's theme; the work, the
// recipe and the finish follow the menu of the day. ────────────────────────────────────────────────────────
type Kind = 'cut' | 'color' | 'highlight' | 'perm' | 'straight' | 'tr' | 'spa' | 'set'
const KIND: Record<string, Kind> = {
  [FIRST]: 'cut', [CUT]: 'cut', [MENS]: 'cut', [BANG]: 'cut', [GAKU]: 'cut', [BLOW]: 'set', [SET]: 'set',
  [CUTCOLOR]: 'color', [RETOUCH]: 'color', [ILLUMINA]: 'color', [HIGHLIGHT]: 'highlight',
  [PERM]: 'perm', [DIGI]: 'perm', [STRAIGHT]: 'straight', [TR]: 'tr', [CUTTR]: 'tr', [SPA]: 'spa',
}
type Theme = { first: string[]; again: string[]; next: string[] }
const THEMES: Record<string, Theme> = {
  gray: {
    first: ['白髪が気になってきた。暗く染めるより、明るめでなじませたい。', '白髪をしっかり染めて、根元が目立たないようにしたい。'],
    again: ['根元の白髪が目立ってきた。', '分け目の白髪が気になるとのこと。', '前回の色味が気に入っている。同じ明るさで。'],
    next: ['頭皮がしみやすいので、カラーの際は保護オイルを塗ってから塗布。', '次回は根元の伸び具合を見て、リタッチかハイライトかを相談。', '白髪の割合が増えてきた。次回はハイライトでぼかす方法もご提案。'],
  },
  color: {
    first: ['透明感のあるベージュ系にしたい。ブリーチはしない。', '落ち着いた暗めのブラウンにしたい。'],
    again: ['色落ちして黄みが出てきた。', '前回より少し明るくしたい。', '同じ色味で、艶を出したい。'],
    next: ['色持ちのため、紫シャンプーを週2〜3回おすすめ。', '次回は季節に合わせて色味を相談。', '6週間前後でのご来店をおすすめ済み。'],
  },
  short: {
    first: ['ショートボブをキープしたい。襟足はすっきりさせたい。', '手入れが簡単な短めのスタイルにしたい。'],
    again: ['襟足が伸びてきた。形は前回と同じで。', '前髪を少し短めにしたい。', '全体の量を軽くしたい。'],
    next: ['4〜5週間でのメンテナンスをおすすめ。', '前髪は伸びやすいので、前髪カットのみのご予約もご案内。', '次回はカラーも検討中とのこと。'],
  },
  mens: {
    first: ['清潔感のある短めのスタイル。セットは簡単にしたい。', '仕事でも浮かない程度のツーブロックにしたい。'],
    again: ['いつもの長さで。サイドを短めに。', '全体を少し短く。トップは残したい。', '白髪が少し出てきたので、ぼかせるか相談。'],
    next: ['次回も同じ長さで。', 'パーマに興味あり。次回ご提案。', 'スタイリング剤はバームをおすすめ済み。'],
  },
  perm: {
    first: ['ゆるいウェーブで、朝のスタイリングを楽にしたい。', 'トップのボリュームを出したい。'],
    again: ['パーマがゆるくなってきた。同じくらいのかかり具合で。', '前回よりしっかりめにかけたい。'],
    next: ['スタイリングはムースをおすすめ。', '3か月前後でのかけ直しをご案内。', '毛先の乾燥が気になる。次回はトリートメントもご提案。'],
  },
  straight: {
    first: ['くせ毛で梅雨どきに広がる。自然なストレートにしたい。'],
    again: ['根元のくせが伸びてきた。', '湿気で広がりやすくなってきた。'],
    next: ['3〜4か月でのかけ直しをおすすめ。', '梅雨入り前の縮毛矯正をおすすめ済み。', '毛先は前回の矯正が残っている。次回も根元のみで。'],
  },
  damage: {
    first: ['毛先のパサつきが気になる。まとまりやすくしたい。'],
    again: ['毛先の乾燥が気になる。', '前回のトリートメントで手触りが良くなった。続けたい。'],
    next: ['ドライヤー前に洗い流さないトリートメントをおすすめ済み。', '次回もトリートメントで状態を確認。', '傷んだ毛先を少しずつカットしていく。'],
  },
  set: {
    first: ['友人の結婚式の二次会に合わせて、アップスタイルにしたい。'],
    again: ['友人の結婚式の二次会に合わせて、アップスタイルにしたい。'],
    next: ['普段のカットの相談も、いつでもどうぞとお伝えした。'],
  },
}
// A wish tied to the menu itself wins over the theme's (a spa day is not a colour day).
const WISH: Partial<Record<string, string[]>> = {
  [SPA]: ['頭皮のべたつきと肩こりが気になる。ゆっくりしたい。'],
  [BANG]: ['前髪が目にかかってきた。'],
  [TR]: ['毛先のパサつきが気になる。艶を出したい。'],
  [BLOW]: ['夜に会食があるので、きれいにブローしてほしい。'],
}
const WORK: Record<string, string[]> = {
  [FIRST]: ['カウンセリングで髪の悩みと普段の手入れを伺い、骨格に合わせてカット。', 'くせと毛流れを確認してからカット。乾かし方もお伝えした。'],
  [CUT]: ['全体の長さを整えて量を調整。顔まわりにレイヤーを入れた。', 'ボブのラインを整え、襟足をすっきりさせた。'],
  [MENS]: ['サイドと襟足を刈り上げ、トップはハサミで量を調整。', '全体を短めに整え、前髪は流れやすいようにカット。'],
  [BANG]: ['前髪を眉下の長さに整え、量を軽くした。'],
  [GAKU]: ['肩上の長さでカット。前髪は眉にかからない長さに。', 'ボブベースで量を軽くし、まとめやすくした。'],
  [CUTCOLOR]: ['カット後、全体にカラー。根元から塗布し、毛先は後から。', '全体カラーとカット。顔まわりは少し明るめに。'],
  [RETOUCH]: ['根元の伸びた部分のみ塗布。毛先は最後の5分だけなじませた。', '根元1.5cm分のリタッチ。'],
  [ILLUMINA]: ['カット後、イルミナカラーで全体を染めた。', '毛先の色落ちした部分をカバーしながら全体カラー。'],
  [HIGHLIGHT]: ['顔まわりを中心に細めのハイライトを入れ、全体にオンカラー。', 'ハイライトとカットで、立体感のある仕上がりに。'],
  [PERM]: ['カットで形を作ってから、中間〜毛先にパーマ。', 'トップにボリュームが出るようロッドを配置。'],
  [DIGI]: ['カット後、中間〜毛先にデジタルパーマ。', '毛先はワンカール、中間にゆるいウェーブ。'],
  [STRAIGHT]: ['くせの強い根元〜中間に縮毛矯正、毛先は保護。仕上げにカット。', '前回の矯正部分を避け、新しく伸びた根元に施術。'],
  [TR]: ['カラー履歴を確認し、髪の状態に合わせて4ステップのトリートメント。'],
  [CUTTR]: ['毛先の傷んだ部分をカットし、トリートメント。', '量を整えるカットのあと、集中トリートメント。'],
  [SPA]: ['頭皮の状態を確認し、クレンジングとマッサージ。首と肩もほぐした。'],
  [SET]: ['ゆるめのシニヨンでアップスタイル。後れ毛を残して柔らかく。'],
  [BLOW]: ['シャンプー後、ブローで内巻きに。'],
}
const RECIPE: Record<Exclude<Kind, 'cut' | 'set'>, string[]> = {
  color: ['イルミナカラー オーキッド8 : サファリ8 = 1:1、OX 6%', 'アディクシー サファイア9 : シルバー9 = 1:1、OX 6%', 'イルミナカラー オーシャン6 : ブリック6 = 2:1、OX 3%', 'スロウカラー ベージュ11 : アッシュ11 = 2:1、OX 6%'],
  highlight: ['ハイライト 細め30枚（ブリーチ、OX 6%）。オンカラー イルミナカラー ヌード10 : オーロラ10 = 1:1、OX 3%', 'ハイライト 細め20枚（ブリーチ、OX 6%）。オンカラー アディクシー グレーパール9、OX 3%'],
  perm: ['1剤 チオ系、ロッド 17〜20mm、2剤 ブロム 5分×2回', '1剤 コスメ系、ロッド 20〜23mm、常温放置15分、2剤 ブロム 5分×2回'],
  straight: ['1剤 酸性ストレート（根元〜中間）、毛先は弱酸性、アイロン 160℃、2剤 ブロム', '根元のみ 1剤 チオ系。既矯正部は薬剤をつけず、アイロン 140℃で整えた'],
  tr: ['TOKIO インカラミ 4ステップ', 'オージュア クエンチ 4ステップ', 'フィヨーレ プリュ F.プロテクト'],
  spa: ['スパ用クレンジングジェル、炭酸泉でオフ'],
}
// A recipe tied to the menu itself wins over its kind's: a heated デジタルパーマ never prints on a cold パーマ.
const RECIPE_BY_MENU: Partial<Record<string, string[]>> = {
  [DIGI]: ['1剤 システアミン系、ロッド 26mm（中間〜毛先）、80℃で8分', '1剤 システアミン系、ロッド 23〜26mm、乾燥後 90℃で10分、2剤 ブロム 5分×2回'],
}
const GRAY = ['オルディーブ ボーテ 8-NB : 8-BE = 1:1、OX 6%、放置20分', 'オルディーブ ボーテ 7-NB : 7-BE = 2:1、OX 6%、放置20分', '根元 オルディーブ ボーテ 6-NB、OX 6%。毛先はイルミナカラー ヌード8、OX 3%でなじませた']
const FINISH: Record<Kind, string[]> = {
  cut: ['乾かすだけでまとまる形に。', '毛流れに沿って整え、扱いやすい長さになった。', 'スタイリング剤を少量つけるだけでまとまる。'],
  color: ['黄みが抑えられ、透明感のある色味に。', '艶が出て、光に当たるとほんのり赤みが見える。'],
  highlight: ['動くたびに明るい筋が見える、立体感のある仕上がり。'],
  perm: ['乾かすだけでゆるいカールが出る。', 'トップがふんわりして、ボリュームの悩みが解消。'],
  straight: ['毛先まで自然なストレート。ピンとなりすぎない仕上がり。'],
  tr: ['毛先まで指通りが良くなり、艶も出た。'],
  spa: ['頭皮のべたつきが取れ、首まわりも軽くなったとのこと。'],
  set: ['崩れにくいように固めつつ、柔らかい印象に仕上げた。'],
}

const GRAY_FINISH: Partial<Record<Kind, string[]>> = {
  color: ['白髪までしっかり染まり、根元と毛先の差もなくなった。', '明るめの仕上がりで、伸びてきても白髪が目立ちにくい。'],
  highlight: ['細いハイライトで白髪がなじみ、伸びても境目が目立ちにくい。'],
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`
const weeks = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (7 * 86_400_000)))

function karute({ customer: c, menu, date, first, prev, pick }: KaruteCtx): KaruteLine[] {
  const t = THEMES[c.theme]
  const kind = KIND[menu]
  const wish = pick(WISH[menu] ?? (first ? t.first : t.again))
  const lines: KaruteLine[] = [
    { category: 'PREFERENCE', label: 'ご要望', text: prev ? `前回（${md(prev.date)}・${prev.menu}）から${weeks(prev.date, date)}週間。${wish}` : wish },
    { category: 'TREATMENT', label: '施術内容', text: pick(WORK[menu]) },
  ]
  const recipes = kind === 'cut' || kind === 'set' ? null : RECIPE_BY_MENU[menu] ?? (kind === 'color' && c.theme === 'gray' ? GRAY : menu === ILLUMINA ? RECIPE.color.filter((r) => r.startsWith('イルミナ')) : RECIPE[kind])
  if (recipes) lines.push({ category: 'PRODUCT', label: '薬剤・配合', text: pick(recipes) })
  lines.push({ category: 'OTHER', label: '仕上がり', text: pick((c.theme === 'gray' && GRAY_FINISH[kind]) || FINISH[kind]) })
  lines.push({ category: 'NEXT_VISIT', label: '次回への申し送り', text: pick(t.next) })
  return lines
}

// ご要望 — what customers type into the booking form's 「ご要望 / メモ」 box: メニューの組み合わせ, なりたいスタイル (写真持参 /
// 前回と同じ), 指名の有無, 頭皮・アレルギー. Short, polite, the customer's own words; a real form is often left empty.
const REQUESTS: RequestLine[] = [
  { text: '初めて伺います。カラーは2か月前にほかのお店でしています。', first: true, themes: ['color', 'gray', 'damage'] },
  { text: '初めてです。なりたい髪型の写真を持っていきます。', first: true },
  { text: 'カットとカラーをお願いします。少し明るめのブラウンにしたいです。', themes: ['color'] },
  { text: '前回のカラーが気に入ったので、同じ色でお願いします。', first: false, themes: ['color', 'gray'] },
  { text: '根元の白髪が気になってきたので、リタッチをお願いします。', themes: ['gray'] },
  { text: '白髪染めで頭皮がかぶれたことがあります。刺激の少ない薬剤でお願いします。', themes: ['gray'] },
  { text: '毛先の傷みが気になります。トリートメントも一緒にお願いします。', themes: ['damage', 'color'] },
  { text: '髪を伸ばしているので、長さはあまり変えずに傷んだところだけ切ってください。', themes: ['damage', 'straight'] },
  { text: 'サイドと襟足を短めに、全体をすっきりさせてください。', themes: ['mens', 'short'] },
  { text: '仕事柄、短くしすぎないようにお願いします。', themes: ['mens'] },
  { text: '毛先に動きが出るようにパーマをかけたいです。', themes: ['perm'] },
  { text: 'くせが強く、雨の日に広がるので縮毛矯正をお願いします。', themes: ['straight'] },
  { text: '肩につくくらいまでばっさり切りたいです。写真を持っていきます。', themes: ['short'] },
  { text: '結婚式に参列するので、ヘアセットをお願いします。', themes: ['set'] },
  { text: '前回と同じ感じでお願いします。', first: false },
  { text: 'ヘアカラーでしみやすいので、頭皮の保護をお願いします。', themes: ['color', 'gray'] },
  { text: '前回担当してくださった方でお願いします。', first: false, nominated: true },
  { text: 'スタイリストの指名はありません。', nominated: false },
]

export const recipe: RecipeData = {
  policy: {
    // 火曜定休, 10:00–20:00.
    weekly_hours: {
      mon: { open: '10:00', close: '20:00' }, tue: null, wed: { open: '10:00', close: '20:00' }, thu: { open: '10:00', close: '20:00' },
      fri: { open: '10:00', close: '20:00' }, sat: { open: '10:00', close: '20:00' }, sun: { open: '10:00', close: '20:00' },
    },
  },
  staff: [
    { name: YUI, role: 'STYLIST' }, { name: SOTA, role: 'STYLIST' }, { name: AYAKA, role: 'STYLIST' },
    { name: REN, role: 'STYLIST' }, { name: MANA, role: 'STYLIST' }, { name: HINATA, role: 'ASSISTANT' },
  ],
  resources: [
    { name: 'セット面1', room_class: 'standard', cleanup_minutes: 5, display_order: 0 },
    { name: 'セット面2', room_class: 'standard', cleanup_minutes: 5, display_order: 1 },
    { name: 'セット面3', room_class: 'standard', cleanup_minutes: 5, display_order: 2 },
    { name: 'セット面4', room_class: 'standard', cleanup_minutes: 5, display_order: 3 },
  ],
  menus: [
    { name: FIRST, duration: 75, price: 5500, category: 'はじめての方', nomination: true, private: false },
    { name: CUT, duration: 60, price: 6600, category: 'カット', nomination: true, private: false },
    { name: MENS, duration: 45, price: 5500, category: 'カット', nomination: true, private: false },
    { name: BANG, duration: 15, price: 1100, category: 'カット', nomination: false, private: false },
    { name: GAKU, duration: 45, price: 4400, category: 'カット', nomination: true, private: false },
    { name: CUTCOLOR, duration: 150, price: 13200, category: 'カラー', nomination: true, private: false },
    { name: RETOUCH, duration: 90, price: 7700, category: 'カラー', nomination: true, private: false },
    { name: ILLUMINA, duration: 150, price: 15400, category: 'カラー', nomination: true, private: false },
    { name: HIGHLIGHT, duration: 180, price: 19800, category: 'カラー', nomination: true, private: false },
    { name: PERM, duration: 150, price: 13200, category: 'パーマ', nomination: true, private: false },
    { name: DIGI, duration: 180, price: 17600, category: 'パーマ', nomination: true, private: false },
    { name: STRAIGHT, duration: 210, price: 22000, category: '縮毛矯正', nomination: true, private: false },
    { name: TR, duration: 45, price: 5500, category: 'トリートメント', nomination: true, private: false },
    { name: CUTTR, duration: 90, price: 11000, category: 'トリートメント', nomination: true, private: false },
    { name: SPA, duration: 30, price: 4400, category: 'ヘッドスパ', nomination: true, private: false },
    { name: SET, duration: 45, price: 5500, category: 'セット', nomination: true, private: false },
    { name: BLOW, duration: 30, price: 3300, category: 'セット', nomination: true, private: false },
  ],
  firstMenu: FIRST,
  customers,
  requests: REQUESTS,
  // 回数券: bought at the Nth completed visit (atVisit); the loader burns one on each completed visit from then on,
  // whatever that visit's menu. So a ticket goes ONLY to a customer who books nothing but its service (menu and alt
  // both that service). メンズカット5回券 ×5 (MENS / MENS) · トリートメント5回券 ×1 (HS-0013, CUTTR / TR — both
  // treatments); unit price a little under the single price. No ヘッドスパ券: no customer books ヘッドスパ only.
  // A new customer's visit 1 is the 初回 menu, so a new holder (HS-0027) buys at visit 2.
  packs: [
    { member: 'HS-0004', size: 5, unitPrice: 4950, atVisit: 2 }, // メンズカット5回券
    { member: 'HS-0012', size: 5, unitPrice: 4950, atVisit: 1 }, // メンズカット5回券
    { member: 'HS-0016', size: 5, unitPrice: 4950, atVisit: 1 }, // メンズカット5回券
    { member: 'HS-0027', size: 5, unitPrice: 4950, atVisit: 2 }, // メンズカット5回券
    { member: 'HS-0030', size: 5, unitPrice: 4950, atVisit: 1 }, // メンズカット5回券
    { member: 'HS-0013', size: 5, unitPrice: 4950, atVisit: 1 }, // トリートメント5回券
  ],
  karute,
}
