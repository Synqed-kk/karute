// Stand-in for next-intl: the real ja catalog strings (label widths matter).
import ja from '../../../../messages/ja.json'

type Table = Record<string, unknown>
export function useTranslations(ns: string) {
  const table = (ns.split('.').reduce<unknown>((o, k) => (o as Table | undefined)?.[k], ja) ?? {}) as Table
  return (key: string, vals?: Record<string, unknown>) =>
    String(table[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vals?.[k] ?? ''))
}
