import { getDb } from '../../config/database.js';

const providers = new Map();

export function registerProvider(provider) {
  providers.set(provider.key, provider);
}

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
