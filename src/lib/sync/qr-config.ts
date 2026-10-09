import type { SynqedClient, SyncConfig } from '@synqed-kk/client'

// CORE-43: core keeps one Quick Reserve config per Karute store (代官山 and
// 銀座 each crawl their own Quick Reserve store). A store's settings screen,
// its save and its 今すぐ同期 all act on the row labelled with that store —
// never on another store's row.
export async function qrConfigForStore(
  synqed: Pick<SynqedClient, 'sync'>,
  storeId: string,
): Promise<{ config: SyncConfig | null; configs: SyncConfig[] }> {
  const configs = await synqed.sync.listConfigs('QUICKRESERVE')
  return { config: configForStore(configs, storeId), configs }
}

/** The one lookup of a store's row among the business's configs. */
export function configForStore(configs: SyncConfig[], storeId: string): SyncConfig | null {
  return configs.find((c) => c.karute_store_id === storeId) ?? null
}
