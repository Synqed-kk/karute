// Treatment-title kind prefixes the extraction prompt can mandate — the
// business type's own service noun (「施術：」「トレーニング：」「処置：」…, v3.3
// de-bodywork) plus the advice prefixes. CurrentSessionCard strips these and
// shows the kind once as a sub-heading. Kept as a literal list (importing the
// persona module would drag ~40KB of token data into the client bundle) —
// prompt-debodywork.test.ts asserts it covers every serviceNounJa
// (business-ai-tokens).
export const TREATMENT_KIND_PREFIXES = [
  '施術',
  'レッスン',
  'トレーニング',
  '処置',
  'リハビリ',
  'セッション',
  'トリミング',
  '実施内容',
  'アドバイス',
  'セルフケア指導',
] as const
