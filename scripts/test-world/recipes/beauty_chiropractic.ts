// 美容整体 — the fill data for a beauty-chiropractic test store (テスト東京店). DATA only: the loader
// (fill.ts) reads it by type id; the counts it must match live in registry.json. Every person, phone
// and address here is invented: phones are 090-0000-xxxx, mail is @example.jp, memos end 「テストデータ」.
import type { KaruteCtx, KaruteLine, RecipeCustomer, RecipeData, RequestLine } from '../plan'

const FIRST = '初回カウンセリング＋施術 90分'
const ZENSHIN = '全身整体 60分'
const KOTSUBAN = '骨盤矯正 45分'
const KOGAO = '小顔矯正 40分'
const SHISEI = '姿勢改善コース 60分'
const SANGO = '産後骨盤ケア 60分'
const KATA = '肩こり集中ケア 30分'

const HANAKO = '見本 はなこ'
const AZUSA = '見本 あずさ'
const SHIRO = '見本 しろう'
const GORO = '見本 ごろう'
const SABURO = 'テスト さぶろう'
const MIRAI = '見本 みらい'

type Row = [member: string, name: string, kana: string, gender: 'female' | 'male', birth: string, occupation: string, memo: string, theme: string, staff: string, menu: string, alt: string, start: number, every: number | null, isNew: boolean, time: 'am' | 'pm' | 'eve']
const rows: Row[] = [
  ['BC-0001', '佐々木 真由美', 'ササキ マユミ', 'female', '1978-04-12', '会社員（事務）', '長時間のデスクワークで肩こりと頭痛。夕方に頭痛が出る日が月に数回ある。', 'katakori', HANAKO, ZENSHIN, KATA, 1, 7, false, 'am'],
  ['BC-0002', '中村 彩花', 'ナカムラ アヤカ', 'female', '1995-07-03', '看護師', '夜勤明けに腰が重くなる。立ち仕事で脚もむくみやすい。', 'youtsu', AZUSA, ZENSHIN, KOTSUBAN, 3, 14, false, 'eve'],
  ['BC-0003', '伊藤 恵', 'イトウ メグミ', 'female', '1991-02-17', '主婦', '第一子の出産から半年。骨盤のゆるみと腰の痛みが気になる。お子さま連れで来店されることがある。', 'sango', HANAKO, SANGO, KOTSUBAN, 12, 10, true, 'am'],
  ['BC-0004', '渡辺 由紀子', 'ワタナベ ユキコ', 'female', '1967-09-05', 'パート（販売）', '右膝の違和感と股関節の硬さ。階段の上り下りがつらい。', 'hiza', SHIRO, ZENSHIN, KOTSUBAN, 2, 14, false, 'pm'],
  ['BC-0005', '小川 美咲', 'オガワ ミサキ', 'female', '1999-12-24', '美容部員', '顔のむくみとフェイスラインの左右差が気になる。接客で表情筋も疲れやすい。', 'kogao', AZUSA, KOGAO, ZENSHIN, 5, 10, false, 'eve'],
  ['BC-0006', '加藤 裕子', 'カトウ ユウコ', 'female', '1974-06-30', '会社員（営業）', '寝つきが悪く、朝から体がだるい。知人の紹介で来店。', 'jiritsu', GORO, ZENSHIN, KATA, 20, 21, true, 'eve'],
  ['BC-0007', '山本 沙織', 'ヤマモト サオリ', 'female', '1988-03-08', '保育士', '子どもを抱き上げる動作で腰を痛めやすい。仕事帰りに通院。', 'youtsu', AZUSA, KOTSUBAN, ZENSHIN, 0, 7, false, 'eve'],
  ['BC-0008', '吉田 奈々', 'ヨシダ ナナ', 'female', '2001-08-19', '大学院生', '猫背と巻き肩を指摘された。研究でパソコン作業が多い。', 'shisei', SHIRO, SHISEI, ZENSHIN, 30, 14, true, 'pm'],
  ['BC-0009', '松本 千尋', 'マツモト チヒロ', 'female', '1983-10-02', '会社員（IT）', '首から肩にかけて常に張っている。目の疲れも強い。', 'katakori', GORO, ZENSHIN, KATA, 4, 10, false, 'eve'],
  ['BC-0010', '井上 香織', 'イノウエ カオリ', 'female', '1972-01-27', '自営業（飲食）', '厨房での立ち仕事で腰痛。店の定休日の前日に来店されることが多い。', 'youtsu', SABURO, ZENSHIN, KOTSUBAN, 6, 14, false, 'am'],
  ['BC-0011', '木村 麻衣', 'キムラ マイ', 'female', '1993-05-14', '事務職', '脚のむくみと骨盤の歪みが気になる。ヒールで長く歩く日がある。', 'kotsuban', HANAKO, KOTSUBAN, ZENSHIN, 0, 7, false, 'eve'],
  ['BC-0012', '林 明日香', 'ハヤシ アスカ', 'female', '1989-11-11', '主婦', '第二子の出産から4か月。産後の体型戻しと腰痛が気になる。', 'sango', AZUSA, SANGO, KOTSUBAN, 45, 14, true, 'am'],
  ['BC-0013', '清水 真理子', 'シミズ マリコ', 'female', '1960-07-22', '主婦', '左の股関節に痛み。長く歩くと脚がだるくなる。', 'hiza', SHIRO, ZENSHIN, KOTSUBAN, 8, 21, false, 'am'],
  ['BC-0014', '山口 愛', 'ヤマグチ アイ', 'female', '1997-04-01', 'アパレル販売', 'フェイスラインのむくみと顔の左右差が気になる。SNSを見て来店。', 'kogao', HANAKO, KOGAO, ZENSHIN, 60, 14, true, 'eve'],
  ['BC-0015', '森 久美子', 'モリ クミコ', 'female', '1965-12-09', 'パート（介護）', '介護の仕事で中腰になることが多く、慢性的な腰痛がある。', 'youtsu', GORO, ZENSHIN, KOTSUBAN, 1, 10, false, 'pm'],
  ['BC-0016', '池田 遥', 'イケダ ハルカ', 'female', '1994-09-28', '会社員（広報）', '巻き肩とストレートネックが気になる。デスクワーク中心。', 'shisei', AZUSA, SHISEI, KOGAO, 2, 7, false, 'eve'],
  ['BC-0017', '橋本 典子', 'ハシモト ノリコ', 'female', '1970-03-15', '教員', '板書で右肩が上がりにくい。授業のない午後に来店。', 'katakori', MIRAI, KATA, ZENSHIN, 15, 14, true, 'pm'],
  ['BC-0018', '石川 さくら', 'イシカワ サクラ', 'female', '2000-02-20', '専門学校生', '友人の結婚式を控え、フェイスラインを整えたい。', 'kogao', HANAKO, KOGAO, KOGAO, 70, null, true, 'pm'],
  ['BC-0019', '前田 智子', 'マエダ トモコ', 'female', '1962-08-03', '自営業（生花店）', '眠りが浅く、疲れが抜けにくい。', 'jiritsu', SABURO, ZENSHIN, KATA, 10, 28, false, 'am'],
  ['BC-0020', '藤田 絵里', 'フジタ エリ', 'female', '1986-06-06', '薬剤師', '立ち仕事で脚がむくむ。骨盤の歪みを整えたい。', 'kotsuban', GORO, KOTSUBAN, ZENSHIN, 35, 10, true, 'eve'],
  ['BC-0021', '岡田 彩', 'オカダ アヤ', 'female', '1990-10-10', '会社員（経理）', '決算期で肩と背中がつらい。予約サイトを見て来店。', 'katakori', HANAKO, ZENSHIN, ZENSHIN, 82, null, true, 'eve'],
  ['BC-0022', '高田 健一', 'タカダ ケンイチ', 'male', '1976-05-19', '会社員（営業）', '車での移動が多く、腰とお尻に張り。ゴルフの後に悪化しやすい。', 'youtsu', SABURO, ZENSHIN, KOTSUBAN, 0, 14, false, 'eve'],
  ['BC-0023', '村上 翔太', 'ムラカミ ショウタ', 'male', '1998-09-12', 'エンジニア', '在宅勤務で猫背になり、首と背中が張る。', 'shisei', SHIRO, SHISEI, ZENSHIN, 25, 10, true, 'eve'],
  ['BC-0024', '近藤 誠', 'コンドウ マコト', 'male', '1958-01-30', '自営業（不動産）', '右膝の痛み。ゴルフのスイングで腰にも違和感。', 'hiza', GORO, ZENSHIN, KOTSUBAN, 3, 21, false, 'am'],
  ['BC-0025', '後藤 大輔', 'ゴトウ ダイスケ', 'male', '1981-07-07', '会社員（企画）', '肩こりと目の疲れ。週末は子どものサッカーの付き添いで疲れが残る。', 'katakori', AZUSA, ZENSHIN, KATA, 1, 10, false, 'eve'],
  ['BC-0026', '坂本 拓也', 'サカモト タクヤ', 'male', '1992-11-03', '消防士', '訓練で腰を痛めた。非番の日に来店。', 'youtsu', SHIRO, ZENSHIN, KOTSUBAN, 50, 14, true, 'pm'],
  ['BC-0027', '遠藤 和也', 'エンドウ カズヤ', 'male', '1987-04-25', '会社員（IT）', '寝違えのような首の痛み。会社の近くで探して来店。', 'katakori', GORO, ZENSHIN, ZENSHIN, 40, null, true, 'eve'],
  ['BC-0028', '青木 修', 'アオキ オサム', 'male', '1964-02-14', '会社役員', '出張が多く疲れが抜けない。睡眠の質を上げたい。', 'jiritsu', HANAKO, ZENSHIN, KATA, 2, 7, false, 'am'],
  ['BC-0029', '藤井 隆', 'フジイ タカシ', 'male', '1970-08-21', 'タクシー運転手', '長時間の運転で腰と太ももの裏が張る。', 'youtsu', SABURO, ZENSHIN, KOTSUBAN, 5, 10, false, 'pm'],
  ['BC-0030', '西村 悠真', 'ニシムラ ユウマ', 'male', '2002-03-18', '大学生', '陸上部の練習で股関節まわりが硬い。フォームの相談も希望。', 'hiza', MIRAI, ZENSHIN, ZENSHIN, 90, null, true, 'pm'],
]
const MAIL = ['mayumi.sasaki', 'ayaka.nakamura', 'megumi.ito', 'yukiko.watanabe', 'misaki.ogawa', 'yuko.kato', 'saori.yamamoto', 'nana.yoshida', 'chihiro.matsumoto', 'kaori.inoue', 'mai.kimura', 'asuka.hayashi', 'mariko.shimizu', 'ai.yamaguchi', 'kumiko.mori', 'haruka.ikeda', 'noriko.hashimoto', 'sakura.ishikawa', 'tomoko.maeda', 'eri.fujita', 'aya.okada', 'kenichi.takada', 'shota.murakami', 'makoto.kondo', 'daisuke.goto', 'takuya.sakamoto', 'kazuya.endo', 'osamu.aoki', 'takashi.fujii', 'yuma.nishimura']

const customers: RecipeCustomer[] = rows.map(([member, name, kana, gender, birth, occupation, memo, theme, staff, menu, alt, start, every, isNew, time], i) => ({
  member, name, kana, gender, birth, occupation, memo: `${memo}\nテストデータ`, theme, staff, menu, alt, start, every, isNew, time,
  phone: `090-0000-${1001 + i}`, email: `${MAIL[i]}@example.jp`,
}))

// ── Karute text: born-native note style, one thread per customer theme ──────────────────────────
type Theme = { first: string[]; again: string[]; since: string[]; next: string[] }
const THEMES: Record<string, Theme> = {
  katakori: {
    first: ['右肩から首にかけての張りと、夕方に出る頭痛。デスクワークは1日8時間以上。', '肩こりが慢性化し、首を左に倒すと突っ張る。こめかみのあたりの頭痛が週に2〜3回。', '首・肩の重だるさ。パソコン作業が続くと後頭部に締めつけ感が出る。'],
    again: ['肩の張りは残るが、頭痛の回数は減ってきた。', '今週は締め切りが重なり、右肩の張りが強い。', '首の動きは楽になったが、夕方になると肩が重くなる。'],
    since: ['2〜3日は肩が軽く、頭痛も出なかったとのこと。', '一時的に楽になったが、週の後半にまた張りが戻った。', '首を回したときの引っかかりが少なくなった。'],
    next: ['右の肩甲骨の内側に硬さが残る。次回も上部を重点的に。', '頭痛が続くようなら医療機関の受診をおすすめ済み。', '首の付け根の緊張が強い。次回も首まわりはソフトな手技で。'],
  },
  youtsu: {
    first: ['前かがみで腰に痛み。朝起きたときが特に強い。', '腰の右側に重だるさ。長時間の立ち仕事で悪化する。', '慢性的な腰痛。ここ1か月で痛む日が増えている。'],
    again: ['腰の痛みは軽くなってきたが、疲れると右側に張りが出る。', '朝のこわばりが以前より短くなった。', '先週、重い荷物を持ってから腰が張っている。'],
    since: ['施術の翌日から腰が伸ばしやすくなったとのこと。', '3日ほどで張りが戻ったが、痛みの強さは半分くらい。', '仕事中の痛みはほとんど気にならなかった。'],
    next: ['右の腰方形筋に張り。次回も腰まわりを重点的に。', '腸腰筋が硬く、股関節の前が詰まりやすい。ストレッチを続けてもらう。', '痛みが強い日は無理をせず、予約の変更も可能とお伝えした。'],
  },
  kotsuban: {
    first: ['骨盤の歪みと脚のむくみ。夕方になると靴がきつくなる。', '左右の脚の長さが違う気がする。スカートが回りやすい。'],
    again: ['むくみは少し改善。脚の長さの差はあまり気にならなくなった。', '立ち仕事の日は相変わらず脚が重い。', '生理前でむくみが強い時期とのこと。'],
    since: ['骨盤の左右差は前回より小さく、安定してきている。', '施術後、1週間ほどむくみが出にくかったとのこと。'],
    next: ['右の骨盤がやや後ろに傾いている。次回も同じ部位を確認。', '座るときに脚を組む癖あり。控えるよう改めてお伝えした。', '内ももの筋力が弱め。寝ながらできる運動を1つお伝えした。'],
  },
  sango: {
    first: ['出産後、骨盤がゆるい感じがあり、腰と恥骨まわりに痛み。', '産後の体型が戻らず、抱っこで腰がつらい。'],
    again: ['抱っこでの腰痛は軽くなってきた。恥骨の痛みはほぼなし。', '夜の授乳で眠りが浅く、背中が張っている。'],
    since: ['前回からお腹まわりが引き締まってきた実感があるとのこと。', '骨盤の開きは前回より改善。立ち姿勢も安定してきた。'],
    next: ['産後6か月までのうちに、間隔を空けすぎず通うようご提案。', '自宅でできる骨盤底筋の体操を続けてもらう。', 'お子さま連れの際は引き続き個室をご案内。'],
  },
  shisei: {
    first: ['猫背と巻き肩。横から見ると頭が前に出ている。', 'ストレートネックを指摘された。首と背中の張り。'],
    again: ['姿勢を意識できる時間が増えた。背中の張りは軽め。', '在宅勤務が続き、また猫背気味とのこと。'],
    since: ['前回と比べて肩の位置が後ろに戻り、胸が開いてきている。', '立ち姿勢の写真で、頭の位置の改善を確認。'],
    next: ['胸椎の伸びがまだ硬い。次回も胸郭まわりを中心に。', '机と椅子の高さを見直すようアドバイス。', '壁立ちのセルフチェックを毎日続けてもらう。'],
  },
  kogao: {
    first: ['顔のむくみとフェイスラインの左右差。', '朝の顔のむくみが強く、あご下がすっきりしない。'],
    again: ['むくみは出にくくなった。左右差はまだ少し気になる。', '仕事が忙しく、顔まわりのむくみが戻っている。'],
    since: ['施術直後の写真で、フェイスラインがすっきりしたことを一緒に確認済み。', '前回から咬筋の張りが和らいでいる。'],
    next: ['食いしばりの癖あり。寝る前の咬筋ほぐしをお伝えした。', '首・肩の張りが顔のむくみに影響している。次回は全身整体もご提案。'],
  },
  hiza: {
    first: ['右膝の違和感と股関節の硬さ。階段の上り下りがつらい。', '長く歩くと股関節の前側が痛む。'],
    again: ['膝の痛みは落ち着いている。朝の歩き始めに違和感。', '旅行で長く歩いてから股関節に張りがある。'],
    since: ['階段での膝の痛みが軽くなったとのこと。', '股関節の開きが前回より大きくなっている。'],
    next: ['腫れや熱感はなし。痛みが強くなるようなら整形外科の受診をおすすめ。', '太もも前側の硬さが残る。セルフストレッチを継続。'],
  },
  jiritsu: {
    first: ['眠りが浅く、朝から体がだるい。首肩の緊張が強い。', '疲れが抜けにくく、目の奥が重い。'],
    again: ['寝つきが良くなった日が増えた。首の緊張はやや残る。', '出張続きで疲労感が強い。'],
    since: ['施術当日はよく眠れたとのこと。', '前回の後、目の疲れが軽くなった。'],
    next: ['呼吸が浅い傾向。腹式呼吸を一緒に練習した。', '寝る前のスマートフォンを控えるようお伝えした。', '次回も首・頭部をゆっくり緩める内容で。'],
  },
}
const TREATMENT: Record<string, string[]> = {
  [FIRST]: ['問診と姿勢チェックのあと、全身の歪みを確認して施術。施術前後の写真で変化を共有。', 'カウンセリングで生活習慣を確認し、骨盤と背骨のバランスを中心に全身を調整。'],
  [ZENSHIN]: ['うつ伏せで背中と肩甲骨まわりをほぐし、胸椎の動きを調整。仰向けで首の付け根を緩めて終了。', '全身のバランスを確認後、肩甲骨まわりと腰を中心に手技で調整。', '骨盤の高さを揃えてから背中・首へ。首は強い刺激を避け、ストレッチ中心。'],
  [KOTSUBAN]: ['骨盤の前後の傾きと左右差を確認し、仙腸関節まわりを調整。', '腸腰筋とお尻の筋肉をほぐしてから骨盤を矯正。脚の長さの差はほぼ解消。'],
  [KOGAO]: ['首・デコルテのリンパを流してから、咬筋と側頭筋をほぐし、頭まわりを調整。', '顔まわりのむくみを流し、フェイスラインの左右差を整える手技を中心に。'],
  [SHISEI]: ['胸郭と肩甲骨の位置を整え、巻き肩の癖に対して胸の筋肉をゆるめた。', '立ち姿勢のチェック後、胸椎の伸びと骨盤の傾きを調整。体幹トレーニングを1種目お伝えした。'],
  [SANGO]: ['骨盤の開きと恥骨まわりを確認し、無理のない範囲で骨盤を締める手技を実施。', '腹部の筋力をチェックし、骨盤底筋を意識した呼吸法を一緒に練習。'],
  [KATA]: ['肩の上部と首の横の筋肉を重点的にほぐし、首のストレッチを実施。', '肩甲骨はがしと、首・肩の筋膜リリースを中心に。'],
}
const SELFCARE = ['お風呂上がりの肩回しストレッチをお伝えした。', 'こまめな水分補給をおすすめした。', '1時間に1回は立ち上がって体を動かすよう案内。', '寝る前の深呼吸とストレッチを続けてもらう。']

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`

function karute({ customer, menu, first, prev, pick }: KaruteCtx): KaruteLine[] {
  const t = THEMES[customer.theme]
  const lines: KaruteLine[] = [{ category: 'SYMPTOM', label: '主訴', text: pick(first ? t.first : t.again) }]
  if (prev) lines.push({ category: 'OTHER', label: '経過', text: `前回（${md(prev.date)}・${prev.menu}）の後、${pick(t.since)}` })
  lines.push({ category: 'TREATMENT', label: '施術内容', text: pick(TREATMENT[menu]) })
  lines.push({ category: 'NEXT_VISIT', label: '次回への申し送り', text: pick(t.next) })
  if (pick([true, false])) lines.push({ category: 'LIFESTYLE', label: 'セルフケア', text: pick(SELFCARE) })
  return lines
}

// ご要望 — what customers type into the booking form's 「ご要望 / メモ」 box (Reserve's own hint: 「特に気になる症状、痛み、
// お悩みなどご記入ください。」). Short, polite, the customer's own words; a real form is often left empty (registry requestShare).
const REQUESTS: RequestLine[] = [
  { text: '初めて伺います。問診票は当日の記入で大丈夫でしょうか。', first: true },
  { text: '初めてです。肩こりと腰痛の両方を相談したいです。', first: true, themes: ['katakori', 'youtsu'] },
  { text: '肩こりと首の張りがつらく、夕方になると頭痛も出ます。', themes: ['katakori', 'jiritsu'] },
  { text: 'デスクワークで右肩が特に張っています。肩まわりを重点的にお願いします。', themes: ['katakori'] },
  { text: '腰痛がひどく、朝起き上がるときに痛みます。', themes: ['youtsu'] },
  { text: '長時間座っていると腰が重くなります。腰を中心にお願いします。', themes: ['youtsu', 'kotsuban'] },
  { text: '骨盤のゆがみが気になります。左右で脚の長さが違う気がします。', themes: ['kotsuban', 'shisei'] },
  { text: '猫背を直したいです。普段の姿勢の癖も見ていただけると助かります。', themes: ['shisei'] },
  { text: '階段の上り下りで右ひざが痛みます。', themes: ['hiza'] },
  { text: '寝つきが悪く、疲れが抜けません。リラックスできる施術を希望します。', themes: ['jiritsu'] },
  { text: '顔のむくみとフェイスラインが気になります。', themes: ['kogao'] },
  { text: '産後の骨盤まわりのケアをお願いします。', themes: ['sango'] },
  { text: '授乳中です。うつ伏せが長いとつらいので、ご配慮いただけると助かります。', themes: ['sango'] },
  { text: '以前ぎっくり腰をしたことがあります。', themes: ['youtsu'] },
  { text: '強い刺激が苦手なので、やさしめでお願いします。' },
  { text: '強めの圧が好みです。' },
  { text: '前回の施術後、だいぶ楽になりました。今回も同じ内容でお願いします。', first: false },
  { text: '前回と同じ先生でお願いします。', first: false, nominated: true },
  { text: '担当の方はどなたでも大丈夫です。', nominated: false },
]

export const recipe: RecipeData = {
  policy: {
    // 火曜定休, 10:00–19:00 (the hours the Reserve pin for this store already shows).
    weekly_hours: {
      mon: { open: '10:00', close: '19:00' }, tue: null, wed: { open: '10:00', close: '19:00' }, thu: { open: '10:00', close: '19:00' },
      fri: { open: '10:00', close: '19:00' }, sat: { open: '10:00', close: '19:00' }, sun: { open: '10:00', close: '19:00' },
    },
  },
  staff: [
    { name: HANAKO, role: 'STYLIST' }, { name: AZUSA, role: 'STYLIST' }, { name: SHIRO, role: 'STYLIST' },
    { name: GORO, role: 'STYLIST' }, { name: SABURO, role: 'STYLIST' }, { name: MIRAI, role: 'ASSISTANT' },
  ],
  resources: [
    { name: 'ベッド1', room_class: 'standard', cleanup_minutes: 10, display_order: 0 },
    { name: 'ベッド2', room_class: 'standard', cleanup_minutes: 10, display_order: 1 },
    { name: 'ベッド3', room_class: 'standard', cleanup_minutes: 10, display_order: 2 },
    { name: '個室', room_class: 'private', cleanup_minutes: 10, display_order: 3 },
  ],
  menus: [
    { name: FIRST, duration: 90, price: 5500, category: 'はじめての方', nomination: false, private: false },
    { name: ZENSHIN, duration: 60, price: 7700, category: '整体', nomination: true, private: false },
    { name: KOTSUBAN, duration: 45, price: 6600, category: '骨盤・姿勢', nomination: true, private: false },
    { name: KOGAO, duration: 40, price: 7150, category: '美容矯正', nomination: true, private: false },
    { name: SHISEI, duration: 60, price: 8250, category: '骨盤・姿勢', nomination: true, private: false },
    { name: SANGO, duration: 60, price: 7700, category: '産後ケア', nomination: true, private: true },
    { name: KATA, duration: 30, price: 4400, category: '整体', nomination: true, private: false },
  ],
  firstMenu: FIRST,
  customers,
  requests: REQUESTS,
  // 回数券: bought at the Nth completed visit (atVisit), used from that visit on.
  packs: [
    { member: 'BC-0001', size: 10, unitPrice: 6600, atVisit: 4 },
    { member: 'BC-0007', size: 5, unitPrice: 6050, atVisit: 4 },
    { member: 'BC-0011', size: 5, unitPrice: 6050, atVisit: 3 },
    { member: 'BC-0028', size: 10, unitPrice: 6600, atVisit: 1 },
    { member: 'BC-0016', size: 10, unitPrice: 7150, atVisit: 5 },
    { member: 'BC-0003', size: 10, unitPrice: 6600, atVisit: 1 },
    { member: 'BC-0005', size: 10, unitPrice: 6600, atVisit: 2 },
    { member: 'BC-0009', size: 10, unitPrice: 6600, atVisit: 2 },
    { member: 'BC-0015', size: 10, unitPrice: 6600, atVisit: 3 },
    { member: 'BC-0020', size: 5, unitPrice: 5500, atVisit: 1 },
    { member: 'BC-0023', size: 10, unitPrice: 7150, atVisit: 1 },
    { member: 'BC-0025', size: 10, unitPrice: 6600, atVisit: 4 },
  ],
  karute,
}
