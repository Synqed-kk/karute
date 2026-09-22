// PURE text → Registry parser for the seed loader's manifest
// (DESIGN-PRACTICE-DOOR.md §4). Two schemas live in the manifest: the loader's
// five tables (fixture id + core uuid → the twin map) and the 9/15 La Estro
// addendum (no fixture id; only its Store row's uuid is kept). Any other table
// shape throws — the registry is never built from a table nobody declared.
// Zero imports: the generator outside the repo runs this file under Node's type
// stripping, so it stays erasable TypeScript only.

export interface Registry {
  source: { fixturesCommit: string }
  twins: Record<'stores' | 'staff' | 'menus' | 'customers' | 'appointments', Record<string, string>>
  addendumStores: Record<string, string> /* name → uuid */
}

type TwinKind = keyof Registry['twins']
type TableRole = { kind: TwinKind } | { kind: 'addendumStore' } | { kind: 'ignored' }
type TableShape = { heading: string; prefix: boolean; columns: string; role: TableRole }

const SHAPES: TableShape[] = [
  { heading: '## Stores', prefix: false, columns: 'fixture id | name | core uuid | status', role: { kind: 'stores' } },
  { heading: '## Staff', prefix: false, columns: 'fixture id | name | assigned stores | core uuid | status', role: { kind: 'staff' } },
  { heading: '## Menus', prefix: false, columns: 'fixture id | name | store | core uuid | status', role: { kind: 'menus' } },
  { heading: '## Customers', prefix: false, columns: 'fixture id | member_number | name | core uuid | status', role: { kind: 'customers' } },
  {
    heading: '## Appointments',
    prefix: false,
    columns: 'fixture id | display_no | JST date-time | customer | staff | store | menu | core uuid | status',
    role: { kind: 'appointments' },
  },
  { heading: '### Store', prefix: false, columns: 'name | address | phone | core uuid | status', role: { kind: 'addendumStore' } },
  { heading: '### Staff', prefix: true, columns: 'name | kana | role | core uuid | status', role: { kind: 'ignored' } },
  { heading: '### Menus', prefix: true, columns: 'name | duration | price (税込) | core uuid | status', role: { kind: 'ignored' } },
]

const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/
const STATUS_OK = ['adopted', 'created']

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

// A key of __proto__ would hit the inherited setter and the row would vanish from
// the registry; refuse the reserved names loudly (same posture as sample-facade.ts).
function refuseReserved(key: string): string {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`manifest: reserved key refused: "${key}"`)
  return key
}

function headingMatches(heading: string, shape: TableShape): boolean {
  return heading === shape.heading || (shape.prefix && heading.startsWith(`${shape.heading} `))
}

export function parseManifest(text: string): Registry {
  const twins: Registry['twins'] = { stores: {}, staff: {}, menus: {}, customers: {}, appointments: {} }
  const addendumStores: Record<string, string> = {}
  let fixturesCommit: string | null = null
  let heading = ''

  const lines = text.split('\n').map((l) => l.trimEnd())
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const commit = /^- fixtures commit: (\S+)$/.exec(line)
    if (commit) fixturesCommit = commit[1]
    if (line.startsWith('#')) heading = line.trim()
    if (!line.startsWith('|')) continue

    // A table: header row, separator row, then rows until a blank line.
    const header = cells(line)
    const shape = SHAPES.find((s) => headingMatches(heading, s) && s.columns === header.join(' | '))
    if (!shape) throw new Error(`manifest: unknown table header: ${heading} ${line}`)
    if (!SEPARATOR.test(lines[i + 1] ?? '')) throw new Error(`manifest: table without a separator row: ${line}`)
    const col = (name: string) => header.indexOf(name)

    for (i += 2; i < lines.length && lines[i].trim() !== ''; i += 1) {
      const row = cells(lines[i])
      if (row.length !== header.length) throw new Error(`manifest: row has ${row.length} cells, header ${header.length}: ${lines[i]}`)
      const status = row[col('status')]
      if (!STATUS_OK.includes(status)) throw new Error(`manifest: row status is ${status}: ${lines[i]}`)
      const uuid = row[col('core uuid')]
      const role = shape.role
      if (role.kind === 'ignored') continue
      if (role.kind === 'addendumStore') {
        addendumStores[refuseReserved(row[col('name')])] = uuid
        continue
      }
      const fixtureId = refuseReserved(row[col('fixture id')])
      const map = twins[role.kind]
      if (Object.prototype.hasOwnProperty.call(map, fixtureId)) {
        throw new Error(`manifest: duplicate ${role.kind} fixture id ${fixtureId}`)
      }
      map[fixtureId] = uuid
    }
  }

  if (fixturesCommit === null) throw new Error('manifest: no "- fixtures commit:" header line')
  return { source: { fixturesCommit }, twins, addendumStores }
}
