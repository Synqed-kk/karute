// names.ts — the practice world's name pools (data). ⚖ R8/R9 (S86): customer names are a seeded shuffle of SURNAMES ×
// the type's own given names (given names are disjoint across types, so two types never share a full name); a generated
// store's staff take a slice of STAFF_NAMES by their store's registry position. Plain names only: no 見本, no hex.
import { rng } from './plan'
import { recipe as chiro } from './recipes/beauty_chiropractic'
import { recipe as hair } from './recipes/hair_salon'
import { recipe as gym } from './recipes/personal_gym'

/** The hand-written customers of every recipe: a pool name never repeats one of them. */
const TAKEN = new Set([chiro, hair, gym].flatMap((r) => r.customers.map((c) => c.name)))

type Name = [kanji: string, kana: string]
const S = (s: string): Name[] => s.trim().split(/\s+/).map((x) => x.split(':') as Name)

export const SURNAMES: Name[] = S(`
佐藤:サトウ 鈴木:スズキ 高橋:タカハシ 田中:タナカ 伊藤:イトウ 渡辺:ワタナベ 山本:ヤマモト 中村:ナカムラ 小林:コバヤシ 加藤:カトウ
吉田:ヨシダ 山田:ヤマダ 佐々木:ササキ 山口:ヤマグチ 松本:マツモト 井上:イノウエ 木村:キムラ 林:ハヤシ 斎藤:サイトウ 清水:シミズ
山崎:ヤマザキ 森:モリ 池田:イケダ 橋本:ハシモト 阿部:アベ 石川:イシカワ 山下:ヤマシタ 中島:ナカジマ 石井:イシイ 小川:オガワ
前田:マエダ 岡田:オカダ 長谷川:ハセガワ 藤田:フジタ 後藤:ゴトウ 近藤:コンドウ 村上:ムラカミ 遠藤:エンドウ 青木:アオキ 坂本:サカモト
斉藤:サイトウ 福田:フクダ 太田:オオタ 西村:ニシムラ 藤井:フジイ 金子:カネコ 岡本:オカモト 藤原:フジワラ 中野:ナカノ 三浦:ミウラ
原田:ハラダ 中川:ナカガワ 松田:マツダ 竹内:タケウチ 小野:オノ 田村:タムラ 中山:ナカヤマ 和田:ワダ 石田:イシダ 森田:モリタ
上田:ウエダ 原:ハラ 内田:ウチダ 柴田:シバタ 酒井:サカイ 宮崎:ミヤザキ 横山:ヨコヤマ 高木:タカギ 安藤:アンドウ 宮本:ミヤモト
大野:オオノ 小島:コジマ 谷口:タニグチ 工藤:クドウ 今井:イマイ 高田:タカダ 増田:マスダ 丸山:マルヤマ 杉山:スギヤマ 村田:ムラタ
大塚:オオツカ 新井:アライ 小山:コヤマ 平野:ヒラノ 藤本:フジモト 河野:コウノ 上野:ウエノ 野口:ノグチ 武田:タケダ 松井:マツイ
千葉:チバ 岩崎:イワサキ 菅原:スガワラ 木下:キノシタ 久保:クボ 佐野:サノ 野村:ノムラ 松尾:マツオ 市川:イチカワ 菊地:キクチ
杉本:スギモト 古川:フルカワ 大西:オオニシ 島田:シマダ 水野:ミズノ 桜井:サクライ 高野:タカノ 吉川:ヨシカワ 山内:ヤマウチ 西田:ニシダ
飯田:イイダ 菅野:カンノ 吉村:ヨシムラ 荒木:アラキ 秋山:アキヤマ`)

/** Per type: female and male given names. hair_salon is 13:7 (35 % male, R18); the others keep their earlier mix. */
export const GIVEN: Record<string, { female: Name[]; male: Name[] }> = {
  hair_salon: {
    female: S('美咲:ミサキ 葵:アオイ 陽菜:ヒナ 莉子:リコ 美月:ミツキ 杏奈:アンナ 千夏:チナツ 麻衣:マイ 彩花:アヤカ 奈々:ナナ 若菜:ワカナ 理沙:リサ 沙織:サオリ'),
    male: S('翔太:ショウタ 大輔:ダイスケ 拓也:タクヤ 雄大:ユウダイ 隼人:ハヤト 亮介:リョウスケ 陸:リク'),
  },
  beauty_chiropractic: {
    female: S('真理子:マリコ 恵:メグミ 由紀子:ユキコ 智子:トモコ 久美子:クミコ 典子:ノリコ'),
    male: S('浩二:コウジ 誠:マコト 昌宏:マサヒロ 和彦:カズヒコ'),
  },
  personal_gym: {
    female: S('早紀:サキ 舞:マイ 遥:ハルカ'),
    male: S('直樹:ナオキ 悠斗:ユウト 慎也:シンヤ'),
  },
}

/** The type's customer pool: every surname × given name, minus `taken` (the recipe's own hand-written customers), in a
 *  seeded order — the same pool on every machine; registry.json `namePool` picks a store's disjoint slice of it. */
export function namePoolFor(type: string, taken: ReadonlySet<string> = TAKEN): [string, string, 'female' | 'male'][] {
  const g = GIVEN[type] ?? (() => { throw new Error(`no given-name pool for ${type}`) })()
  const pool = SURNAMES.flatMap(([s, sk]) => (['female', 'male'] as const).flatMap((gender) =>
    g[gender].map(([n, nk]): [string, string, 'female' | 'male'] => [`${s} ${n}`, `${sk} ${nk}`, gender]))).filter(([n]) => !taken.has(n))
  const r = rng(`${type}|names`)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

/** A generated store's staff, six per store by registry position (the originals keep their recipe names). */
export const STAFF_NAMES: string[] = `藤崎 涼子 三上 祐介 北川 真帆 岸本 健司 早川 香織 矢野 修 堀内 茜 片山 純一 永井 瞳 松岡 大和 辻 有紗 望月 達也
白石 綾 関口 拓真 宮田 静香 服部 晃 須藤 遥香 戸田 祐樹 本田 美穂 大川 俊 川口 萌 中西 康平 今村 千尋 篠原 涼 黒田 朋美 成田 啓太
小松 夏美 吉岡 翼 野田 由佳 安田 圭 浅野 杏 平田 将 大島 紗希 桑原 航 坂口 楓 長田 蓮 西川 志保 須田 恭平 福井 梓 岩田 颯 横田 咲 内藤 光`
  .trim().split(/\s+/).reduce<string[]>((xs, w, i, all) => (i % 2 ? xs : [...xs, `${w} ${all[i + 1]}`]), [])
