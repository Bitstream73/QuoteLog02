/**
 * Base class for historical source providers.
 * All providers must extend this class and implement fetchArticles() and testConnection().
 */
export class HistoricalProvider {
  constructor(key, name) {
    this.key = key;        // matches provider_key in historical_sources table
    this.name = name;
  }

  /**
   * Fetch historical articles not yet in the database.
   * @param {number} limit - Max articles to return this cycle
   * @param {object} db - better-sqlite3 database instance
   * @param {object} config - Provider-specific config from historical_sources.config JSON
   * @returns {Promise<Array<{url: string, title: string, text: string|null, published: string|null, sourceLabel: string}>>}
   */
  async fetchArticles(limit, db, config) {
    throw new Error('fetchArticles() must be implemented');
  }

  /**
   * Test if the provider can connect and return data.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }
}
