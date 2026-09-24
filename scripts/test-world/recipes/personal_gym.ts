// パーソナルジム — the fill data for a personal-gym test store. DATA only: the loader (fill.ts) reads it by
// type id; the counts it must match live in registry.json. Every person, phone and address here is invented:
// phones are 090-0000-2xxx, mail is @example.jp, memos end 「テストデータ」.
// STORE: テスト恵比寿ジム · 東京都渋谷区恵比寿1-0-0 テストビル3F · 03-0000-2000
// Trainers carry the STYLIST role: it is core's only practitioner role (StaffRole = OWNER | ADMIN | STYLIST | ASSISTANT).
// Monthly memberships / 月会費 have no core home yet (CORE-35): nothing here stands in for a plan — no packs either.
import type { KaruteCtx, KaruteLine, RecipeCustomer, RecipeData } from '../plan'

const TAIKEN = '体験トレーニング 60分'
const PT60 = 'パーソナルトレーニング 60分'
const PT90 = 'パーソナルトレーニング 90分'
const PAIR = 'ペアトレーニング 60分'
const SOKUTEI = '体組成測定＋カウンセリング 30分'
const STRETCH = 'ストレッチ 30分'
const BODYMAKE = 'ボディメイク集中 75分'
const SANGO = '産後リカバリー 60分'

const KENTA = '見本 けんた'
const DAICHI = '見本 だいち'
const RINA = 'テスト りな'
const NATSUMI = '見本 なつみ'
const KOHARU = 'テスト こはる'

// lv = the member's strength level (× the theme lift's base load), used only by the training record.
type Row = [member: string, name: string, kana: string, gender: 'female' | 'male', birth: string, occupation: string, memo: string, theme: string, staff: string, menu: string, alt: string, start: number, every: number | null, isNew: boolean, time: 'am' | 'pm' | 'eve', lv: number]
const rows: Row[] = [
  ['GY-0001', '高橋 美穂', 'タカハシ ミホ', 'female', '1985-06-14', '会社員（人事）', '3か月後に結婚式を控え、体重を5kg落としたい。運動経験はほとんどない。', 'diet', NATSUMI, PT60, STRETCH, 0, 3, false, 'eve', 1],
  ['GY-0002', '鈴木 拓海', 'スズキ タクミ', 'male', '1990-02-08', '会社員（営業）', '学生時代はラグビー部。10年ぶりに本格的に体を鍛え直したい。', 'kinryoku', KENTA, PT60, PT90, 1, 4, false, 'eve', 1.2],
  ['GY-0003', '田中 恵理子', 'タナカ エリコ', 'female', '1972-11-20', '薬剤師', '健康診断で内臓脂肪を指摘された。無理なく続けられる運動を探している。', 'kenko', DAICHI, PT60, SOKUTEI, 2, 7, false, 'pm', 0.8],
  ['GY-0004', '伊藤 翼', 'イトウ ツバサ', 'male', '2003-05-01', '大学生（陸上部）', '短距離の選手。スタートの爆発力を上げたい。11月に大会がある。', 'kyogi', KENTA, BODYMAKE, PT60, 0, 4, false, 'pm', 1.2],
  ['GY-0005', '渡辺 さやか', 'ワタナベ サヤカ', 'female', '1992-09-09', '主婦', '第一子の出産から5か月。お腹まわりのたるみと腰痛が気になる。お子さまを預けて来店。', 'sango', RINA, SANGO, STRETCH, 5, 7, true, 'am', 0.7],
  ['GY-0006', '山本 大輔', 'ヤマモト ダイスケ', 'male', '1979-03-27', '会社役員', '会食が多く、ここ2年で体重が8kg増えた。午前中の予約を希望。', 'diet', DAICHI, PT60, SOKUTEI, 1, 3, false, 'am', 1.1],
  ['GY-0007', '中村 優奈', 'ナカムラ ユウナ', 'female', '1996-12-12', 'ヨガインストラクター', '体幹を強くして、背中のラインを整えたい。', 'shisei', RINA, PT60, STRETCH, 3, 4, false, 'pm', 1],
  ['GY-0008', '小林 健太郎', 'コバヤシ ケンタロウ', 'male', '1968-07-07', '自営業（工務店）', '腰痛の再発予防に、医師から筋トレをすすめられた。', 'kenko', KENTA, PT60, STRETCH, 2, 4, false, 'am', 1],
  ['GY-0009', '加藤 麻美', 'カトウ アサミ', 'female', '1988-01-19', '看護師', '夜勤明けに通える日を選んで来店。体力をつけたい。', 'kinryoku', NATSUMI, PT60, STRETCH, 4, 4, false, 'am', 0.8],
  ['GY-0010', '吉田 誠', 'ヨシダ マコト', 'male', '1975-10-30', '会社員（経理）', '妻と二人で通っている。夫婦で体重を落とすのが目標。', 'diet', DAICHI, PAIR, PT60, 0, 4, false, 'eve', 1],
  ['GY-0011', '山田 綾', 'ヤマダ アヤ', 'female', '1983-04-04', '会社員（企画）', 'デスクワークで猫背と肩こりがひどい。姿勢を良くしたい。', 'shisei', RINA, PT60, STRETCH, 6, 7, false, 'eve', 0.9],
  ['GY-0012', '佐藤 直樹', 'サトウ ナオキ', 'male', '1985-08-16', '消防士', '昇任試験の体力測定に向けて、全身の筋力を底上げしたい。', 'kinryoku', KENTA, PT90, PT60, 1, 4, false, 'pm', 1.3],
  ['GY-0013', '松田 亜希子', 'マツダ アキコ', 'female', '1965-02-22', '主婦', 'ひざに不安があり、ひとりでジムに通うのは心配だった。', 'kenko', DAICHI, PT60, STRETCH, 8, 7, true, 'am', 0.7],
  ['GY-0014', '井上 拓也', 'イノウエ タクヤ', 'male', '1994-06-03', 'エンジニア', '在宅勤務で運動不足。体脂肪率を20%から15%に落としたい。', 'diet', NATSUMI, BODYMAKE, PT60, 2, 3, false, 'eve', 1],
  ['GY-0015', '木村 沙也加', 'キムラ サヤカ', 'female', '1990-03-13', '主婦', '産後1年。抱っこで腰と肩が痛む。体型も戻したい。', 'sango', RINA, SANGO, PT60, 3, 4, false, 'am', 0.8],
  ['GY-0016', '林 健二', 'ハヤシ ケンジ', 'male', '1958-12-01', '会社顧問', '足腰を今のうちに鍛えておきたい。ゴルフの飛距離も伸ばしたい。', 'kenko', KENTA, PT60, STRETCH, 0, 7, false, 'am', 0.9],
  ['GY-0017', '斎藤 美紀', 'サイトウ ミキ', 'female', '1981-07-25', '会社員（広報）', '二の腕とお腹まわりを引き締めたい。', 'diet', NATSUMI, PT60, BODYMAKE, 10, 4, true, 'eve', 0.9],
  ['GY-0018', '清水 亮', 'シミズ リョウ', 'male', '1999-11-11', '社会人サッカー選手', '当たり負けしない体を作りたい。練習のない日に来店。', 'kyogi', KENTA, BODYMAKE, PT90, 4, 4, false, 'pm', 1.3],
  ['GY-0019', '山崎 由美', 'ヤマザキ ユミ', 'female', '1970-05-18', 'パート（事務）', '更年期に入ってから体重が落ちにくくなった。', 'diet', DAICHI, PT60, SOKUTEI, 6, 4, false, 'pm', 0.8],
  ['GY-0020', '森 大樹', 'モリ ダイキ', 'male', '1987-09-02', '会社員（IT）', 'ベンチプレス100kgが目標。自己流では伸び悩んでいる。', 'kinryoku', KENTA, PT60, PT90, 0, 3, false, 'eve', 1.4],
  ['GY-0021', '阿部 理恵', 'アベ リエ', 'female', '1993-01-28', '美容師', '立ち仕事で脚がむくむ。お尻と脚のラインを整えたい。', 'diet', NATSUMI, PT60, STRETCH, 12, 7, true, 'pm', 0.9],
  ['GY-0022', '池田 和也', 'イケダ カズヤ', 'male', '1972-04-14', 'タクシー運転手', '長時間座りっぱなしで、腰と背中が張る。', 'shisei', DAICHI, PT60, STRETCH, 20, 7, true, 'am', 1],
  ['GY-0023', '橋本 真央', 'ハシモト マオ', 'female', '1998-08-08', '大学院生', '友人の紹介で来店。就職前に体を引き締めたい。', 'diet', NATSUMI, PT60, PT60, 30, null, true, 'pm', 0.8],
  ['GY-0024', '石井 隆之', 'イシイ タカユキ', 'male', '1962-10-05', '医師', '空いた時間に効率よく鍛えたい。', 'kenko', DAICHI, PT60, SOKUTEI, 1, 7, false, 'pm', 1],
  ['GY-0025', '前田 早紀', 'マエダ サキ', 'female', '1995-02-14', '保育士', 'スキーの検定に向けて、下半身を強くしたい。', 'kyogi', NATSUMI, PT60, BODYMAKE, 7, 4, false, 'eve', 0.9],
  ['GY-0026', '藤井 美奈子', 'フジイ ミナコ', 'female', '1986-06-21', '会社員（秘書）', '第二子の出産から8か月。体力の回復と骨盤まわりのケアを希望。', 'sango', RINA, SANGO, STRETCH, 40, 4, true, 'am', 0.8],
  ['GY-0027', '岡本 翔', 'オカモト ショウ', 'male', '2001-03-09', '大学生', '筋トレの正しいフォームを知りたい。料金を見て入会を検討するとのこと。', 'kinryoku', KENTA, PT60, PT60, 55, null, true, 'eve', 1],
  ['GY-0028', '長谷川 恵', 'ハセガワ メグミ', 'female', '1978-09-17', '自営業（カフェ）', '店の定休日に合わせて来店。体重を落として、ひざの負担を減らしたい。', 'diet', DAICHI, PT60, STRETCH, 3, 7, false, 'pm', 0.9],
  ['GY-0029', '近藤 雄一', 'コンドウ ユウイチ', 'male', '1983-12-23', '会社員（商社）', 'ハーフマラソンの自己ベスト更新が目標。', 'kyogi', KENTA, PT60, STRETCH, 50, 4, true, 'eve', 1.1],
  ['GY-0030', '小川 由香', 'オガワ ユカ', 'female', '1976-07-30', '教員', '姿勢が悪いと生徒に言われた。巻き肩を直したい。', 'shisei', RINA, PT60, STRETCH, 15, 4, true, 'eve', 0.9],
]
const MAIL = ['miho.takahashi', 'takumi.suzuki', 'eriko.tanaka', 'tsubasa.ito', 'sayaka.watanabe', 'daisuke.yamamoto', 'yuna.nakamura', 'kentaro.kobayashi', 'asami.kato', 'makoto.yoshida', 'aya.yamada', 'naoki.sato', 'akiko.matsuda', 'takuya.inoue', 'sayaka.kimura', 'kenji.hayashi', 'miki.saito', 'ryo.shimizu', 'yumi.yamazaki', 'daiki.mori', 'rie.abe', 'kazuya.ikeda', 'mao.hashimoto', 'takayuki.ishii', 'saki.maeda', 'minako.fujii', 'sho.okamoto', 'megumi.hasegawa', 'yuichi.kondo', 'yuka.ogawa']

const LEVEL = new Map(rows.map((r) => [r[0], r[15]]))
const customers: RecipeCustomer[] = rows.map(([member, name, kana, gender, birth, occupation, memo, theme, staff, menu, alt, start, every, isNew, time], i) => ({
  member, name, kana, gender, birth, occupation, memo: `${memo}\nテストデータ`, theme, staff, menu, alt, start, every, isNew, time,
  phone: `090-0000-${2001 + i}`, email: `${MAIL[i]}@example.jp`,
}))

// ── Training record: born-native trainer notes, one thread per goal; loads follow the member over time ──
// A load is a pure function of the member and the DATE (base × level, one step up every three weeks, capped), so a
// returning member's record names the same numbers the previous record showed.
type Lift = { name: string; unit: 'kg' | '秒'; base: [female: number, male: number]; step: number; max: number; sets: string }
type Theme = { first: string[]; again: string[]; menu: string[]; lift: Lift; cond: string[]; next: string[] }
const THEMES: Record<string, Theme> = {
  diet: {
    first: ['3か月で体重-5kg。まずは週2回の運動習慣をつけたい。', '体脂肪を落として、服のサイズを1つ下げたい。', '健康診断までに体重を落としたい。'],
    again: ['体重-5kgの目標に向けて継続中。今週は会食が2回あったとのこと。', 'お腹まわりの引き締め。前回からウエストが1cm減った。', '体重は横ばい。食事の記録を続けてもらっている。'],
    menu: ['レッグプレス・ラットプルダウン・スクワット、最後にバイク15分', 'レッグプレス・チェストプレス・ランジ、有酸素はバイク10分', 'レッグプレス・ダンベルデッドリフト・プランク、最後にバイク15分'],
    lift: { name: 'レッグプレス', unit: 'kg', base: [40, 70], step: 5, max: 6, sets: '×15回×3セット' },
    cond: ['睡眠は6時間ほど。疲れはあるが体調は良好。', '前回の筋肉痛が2日ほど残ったとのこと。', '前半は息が上がりやすかったが、後半はペースを保てた。'],
    next: ['下半身中心で継続。有酸素を5分延ばす予定。', '食事の記録を見ながら、夕食の主食の量を一緒に見直す。', '次回は体組成を測って、1か月の変化を確認する。'],
  },
  kinryoku: {
    first: ['全身の筋力を底上げしたい。ベンチプレスの重量を伸ばしたい。', '自己流で伸び悩んでいる。正しいフォームで重量を上げたい。'],
    again: ['ベンチプレスの重量更新が目標。', '全身の筋力アップを継続中。'],
    menu: ['ベンチプレス・インクラインダンベルプレス・ディップス', 'ベンチプレス・補助付き懸垂・ダンベルロウ', 'ベンチプレス・スクワット・ルーマニアンデッドリフト'],
    lift: { name: 'ベンチプレス', unit: 'kg', base: [20, 50], step: 2.5, max: 8, sets: '×8回×3セット' },
    cond: ['肩の違和感なし。前日はしっかり休めたとのこと。', '仕事の疲れで序盤は重く感じたが、メインセットは問題なし。', '右肩に軽い張り。可動域を確認しながら実施。'],
    next: ['フォームは安定。次回は2.5kg上げて挑戦。', '肩甲骨の寄せが甘くなる場面あり。次回もフォームの確認から。', '次回は下半身の日。スクワット中心で組む。'],
  },
  shisei: {
    first: ['猫背と巻き肩を直したい。デスクワークで肩こりがひどい。', '体幹を強くして、立ち姿をきれいに見せたい。'],
    again: ['巻き肩の改善を継続中。', '疲れてくると背中が丸まりやすいとのこと。'],
    menu: ['ラットプルダウン・シーテッドロウ・フェイスプル、胸のストレッチ', 'ラットプルダウンのあと、プランク・デッドバグで体幹、最後に胸椎の可動域トレーニング', 'ラットプルダウン・ヒップリフト、壁を使った姿勢チェック'],
    lift: { name: 'ラットプルダウン', unit: 'kg', base: [20, 35], step: 2.5, max: 6, sets: '×12回×3セット' },
    cond: ['肩こりは前回より軽いとのこと。', '在宅勤務が続き、背中の張りが強め。', '朝のこわばりが少なくなってきた。'],
    next: ['肩甲骨を下げる意識がまだ弱い。次回も背中の種目から。', '1時間に1回は立って胸を開くストレッチを続けてもらう。', '次回は立ち姿勢の写真を撮り、初回と比べる。'],
  },
  sango: {
    first: ['産後の体力回復と、お腹まわりの引き締め。', '抱っこでの腰痛をなくしたい。骨盤まわりを安定させたい。'],
    again: ['産後の体型戻しを継続中。腰痛は軽くなってきた。', '骨盤まわりの安定と体力の回復を継続中。'],
    menu: ['ドローイン・ヒップリフト・プランクなど、骨盤底筋と体幹を中心に', '呼吸と骨盤底筋の確認から、自重スクワット・ヒップリフト・プランクへ', 'ストレッチで骨盤まわりをほぐしてから、ヒップリフトとプランクを軽めに'],
    lift: { name: 'プランク', unit: '秒', base: [20, 30], step: 5, max: 6, sets: '×3セット' },
    cond: ['夜の授乳で睡眠不足気味。強度を落として実施。', '腰の痛みはほぼなし。抱っこも楽になってきた。', '恥骨まわりの違和感なし。'],
    next: ['腹筋の開きはほぼ戻っている。次回から少しずつ負荷を上げる。', '自宅でのドローインを1日5分続けてもらう。', 'お子さま連れでも来店できるよう、次回は個室をご案内。'],
  },
  kyogi: {
    first: ['競技力を上げたい。下半身のパワーをつけたい。', '当たり負けしない体を作りたい。'],
    again: ['大会に向けて下半身のパワーアップを継続中。', 'シーズン中のため、疲労を見ながら強度を調整。'],
    menu: ['スクワット・ボックスジャンプ・メディシンボール投げ', 'スクワット・ブルガリアンスクワット・スプリントドリル', 'スクワット・クリーンのフォーム確認・体幹'],
    lift: { name: 'スクワット', unit: 'kg', base: [35, 60], step: 5, max: 4, sets: '×5回×5セット' },
    cond: ['前日に練習試合があり、脚に疲労が残っている。', 'コンディション良好。ジャンプの高さも出ていた。', 'もも裏に軽い張り。ストレッチを多めに入れた。'],
    next: ['大会2週間前からは重量を落とし、スピード重視に切り替える。', '次回は片脚の種目で左右差を確認。', '練習量が多い週は、回復中心のメニューに変更する。'],
  },
  kenko: {
    first: ['足腰を鍛えて、年齢を重ねても元気に動ける体でいたい。', '医師のすすめで、無理のない筋トレを続けたい。'],
    again: ['健康維持のため、無理のない範囲で継続中。', '足腰の筋力維持。ひざの様子を見ながら。'],
    menu: ['チェストプレス（マシン）・レッグプレス・シーテッドロウ', 'チェストプレス（マシン）・椅子を使ったスクワット・バランスボードでの片脚立ち', 'チェストプレス（マシン）・ラットプルダウン、肩まわりのストレッチ'],
    lift: { name: 'チェストプレス（マシン）', unit: 'kg', base: [15, 30], step: 2.5, max: 6, sets: '×12回×3セット' },
    cond: ['来店時の血圧は問題なし。', 'ひざの痛みはなし。階段が楽になったとのこと。', '少し寝不足とのことで、強度を控えめにした。'],
    next: ['次回もひざに負担の少ない種目で。', '自宅でのかかと上げを毎日続けてもらう。', '次回は体組成を測って、筋肉量の変化を確認する。'],
  },
}
const FIRST_COND = ['運動は久しぶりとのこと。息は上がったが、最後までやり切った。', '体調は良好。フォームの飲み込みが早い。', '緊張していたが、後半はリラックスして取り組めた。']
const FIRST_NEXT = ['次回はカウンセリングの内容をもとに、プログラムを組んでお見せする。', '通うペースは週2回をご提案。', '体験の感想を伺い、通い方を一緒に検討する。']
const FOOD = ['夕食の主食を半分にする取り組みを継続中。', 'たんぱく質を毎食とるようお伝えした。', '間食をナッツとヨーグルトに置き換えてもらっている。']
const NO_LOAD = new Set([STRETCH, SOKUTEI]) // a session with no lift: no load line, and never quoted as 「前回は…」

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`
const ANCHOR = Date.parse('2026-06-01T00:00:00Z')
function load(c: RecipeCustomer, l: Lift, ymd: string): number {
  const steps = Math.min(l.max, Math.max(0, Math.floor((Date.parse(`${ymd}T00:00:00Z`) - ANCHOR) / (21 * 86_400_000))))
  return (Math.round((l.base[c.gender === 'female' ? 0 : 1] * LEVEL.get(c.member)!) / l.step) + steps) * l.step
}

function menuLine(menu: string, t: Theme, pick: KaruteCtx['pick']): string {
  if (menu === TAIKEN) return `カウンセリングと姿勢チェックのあと、${t.lift.name}を中心に基本の種目を軽めに体験。`
  if (menu === STRETCH) return pick(['ストレッチ30分。肩まわり・股関節・もも裏を中心にほぐした。', 'トレーナーが全身をストレッチ。特に硬い股関節まわりを重点的にほぐした。'])
  if (menu === SOKUTEI) return pick(['体組成を測定し、結果をもとに今後のメニューと食事を相談。', '体組成を測定。筋肉量と体脂肪率の変化を一緒に確認した。'])
  if (menu === PAIR) return `ペアで交互に、${pick(t.menu)}。`
  if (menu === PT90) return `${pick(t.menu)}。最後の20分はストレッチ。`
  return pick(t.menu)
}

function karute({ customer: c, menu, date, first, prev, pick }: KaruteCtx): KaruteLine[] {
  const t = THEMES[c.theme]
  const lines: KaruteLine[] = [
    { category: 'PREFERENCE', label: '目的', text: pick(first ? t.first : t.again) },
    { category: 'TREATMENT', label: '本日のメニュー', text: menuLine(menu, t, pick) },
  ]
  if (!NO_LOAD.has(menu)) {
    const { name, unit, sets } = t.lift
    const w = load(c, t.lift, date)
    const pw = prev && !NO_LOAD.has(prev.menu) ? load(c, t.lift, prev.date) : null
    const text = first
      ? `初回のため軽めに設定。${name} ${w}${unit}${sets}。`
      : pw === null
        ? `${name} ${w}${unit}${sets}。`
        : `${name} ${w}${unit}${sets}（前回${md(prev!.date)}は${pw}${unit}）。${w > pw ? `前回より${w - pw}${unit}アップ。` : '前回と同じ負荷で、フォームを安定させた。'}`
    lines.push({ category: 'OTHER', label: '負荷・回数', text })
  }
  lines.push({ category: 'SYMPTOM', label: '体調・所感', text: pick(first ? FIRST_COND : t.cond) })
  lines.push({ category: 'NEXT_VISIT', label: '次回', text: pick(first ? FIRST_NEXT : t.next) })
  if (c.theme === 'diet' && !first && pick([true, false])) lines.push({ category: 'LIFESTYLE', label: '食事', text: pick(FOOD) })
  return lines
}

export const recipe: RecipeData = {
  policy: {
    // 年中無休, 07:00–22:00.
    weekly_hours: {
      mon: { open: '07:00', close: '22:00' }, tue: { open: '07:00', close: '22:00' }, wed: { open: '07:00', close: '22:00' }, thu: { open: '07:00', close: '22:00' },
      fri: { open: '07:00', close: '22:00' }, sat: { open: '07:00', close: '22:00' }, sun: { open: '07:00', close: '22:00' },
    },
  },
  staff: [
    { name: KENTA, role: 'STYLIST' }, { name: DAICHI, role: 'STYLIST' }, { name: RINA, role: 'STYLIST' },
    { name: NATSUMI, role: 'STYLIST' }, { name: KOHARU, role: 'ASSISTANT' },
  ],
  resources: [
    { name: 'トレーニングルームA', room_class: 'standard', cleanup_minutes: 10, display_order: 0 },
    { name: 'トレーニングルームB', room_class: 'standard', cleanup_minutes: 10, display_order: 1 },
    { name: '個室スタジオ', room_class: 'private', cleanup_minutes: 10, display_order: 2 },
  ],
  menus: [
    { name: TAIKEN, duration: 60, price: 5500, category: 'はじめての方', nomination: false, private: false },
    { name: PT60, duration: 60, price: 11000, category: 'パーソナルトレーニング', nomination: true, private: false },
    { name: PT90, duration: 90, price: 16500, category: 'パーソナルトレーニング', nomination: true, private: false },
    { name: BODYMAKE, duration: 75, price: 13750, category: 'パーソナルトレーニング', nomination: true, private: false },
    { name: PAIR, duration: 60, price: 15400, category: 'ペアトレーニング', nomination: true, private: false },
    { name: STRETCH, duration: 30, price: 6600, category: 'コンディショニング', nomination: true, private: false },
    { name: SOKUTEI, duration: 30, price: 3300, category: '測定・カウンセリング', nomination: true, private: false },
    { name: SANGO, duration: 60, price: 11000, category: '産後ケア', nomination: true, private: true },
  ],
  firstMenu: TAIKEN,
  customers,
  packs: [],
  karute,
}
