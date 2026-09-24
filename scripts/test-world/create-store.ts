// create-store.ts — ONE-OFF: makes one Dev Salon test store for a new test-world type (run once per store, on Liam's
// word). Its id goes into registry.json `stores`. Never wired into an npm script.
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/create-store.ts --name <店名> --address <住所> --phone <電話>
// Same pin as fill.ts: the client is built on the hard Dev Salon id, and core must resolve that business and hold
// the dev@karute.test card before anything is written. A store of that name already there → its id, no write.
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (values are never printed). Exit: 0 ok · 1 error/usage · 2 REFUSED (pin).
import { assertDevSalon, DEV_SALON_BUSINESS_ID, Refused } from './count-baseline'

const args = process.argv.slice(2)
const flag = (name: string) => { const v = args.includes(name) ? args[args.indexOf(name) + 1] : undefined; return v?.startsWith('--') ? undefined : v }

async function main(): Promise<number> {
  const [name, address, phone] = [flag('--name'), flag('--address'), flag('--phone')]
  if (!name || !address || !phone) return (console.log('usage: create-store.ts --name <店名> --address <住所> --phone <電話>'), 1)
  const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
  if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
  const { SynqedClient } = await import('@synqed-kk/client')
  const core = new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })
  try {
    await assertDevSalon(core)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    return (console.log(`REFUSED: ${e.message}`), 2)
  }
  const have = (await core.stores.list()).stores.find((s) => s.name === name)
  if (have) return (console.error('a store of that name already exists: nothing written'), console.log(have.id), 0)
  console.log((await core.stores.create({ name, address, phone, is_primary: false, active: true })).id)
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('create-store failed:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  },
)
