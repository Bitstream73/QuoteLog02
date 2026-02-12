import { getDb } from '../../config/database.js';
import { WikiquoteProvider } from './wikiquoteProvider.js';
import { ChroniclingAmericaProvider } from './chroniclingAmericaProvider.js';
import { WaybackProvider } from './waybackProvider.js';
import { GovInfoProvider } from './govInfoProvider.js';
import { PresidencyProjectProvider } from './presidencyProjectProvider.js';

const providers = new Map();

export function registerProvider(provider) {
  providers.set(provider.key, provider);
}

// Register all built-in providers
registerProvider(new WikiquoteProvider());
registerProvider(new ChroniclingAmericaProvider());
registerProvider(new WaybackProvider());
registerProvider(new GovInfoProvider());
registerProvider(new PresidencyProjectProvider());

export function getAllProviders() {
  return [...providers.values()];
}

export function getProviderByKey(key) {
  return providers.get(key);
}

export function getEnabledProviders() {
  const db = getDb();
  const enabled = db.prepare(
    "SELECT provider_key FROM historical_sources WHERE enabled = 1 AND status != 'disabled'"
  ).all();
  return enabled.map(row => providers.get(row.provider_key)).filter(Boolean);
}
