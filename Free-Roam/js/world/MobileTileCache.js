const CACHE_PREFIX = 'fantascuola-mobile-tiles-v1-';
const DEFAULT_LIMIT = 384 * 1024 * 1024;

// Cache Storage mantiene i GLB compressi sul dispositivo, non le texture nella GPU.
// Il nome include l'hash della mappa: un aggiornamento non riusa zone di un'altra versione.
export class MobileTileCache {
  constructor(manifest, manifestUrl, { storage = globalThis.caches, maxBytes = DEFAULT_LIMIT } = {}) {
    this.storage = storage;
    this.name = `${CACHE_PREFIX}${manifest.source?.sha256 || 'unknown'}`;
    this.maxBytes = maxBytes;
    this.bytesByUrl = new Map(manifest.tiles.map((tile) =>
      [new URL(tile.file, manifestUrl).href, tile.bytes]));
    this.cachePromise = null;
    this.writeTail = Promise.resolve();
  }

  async cache() {
    if (!this.storage?.open) return null;
    if (!this.cachePromise) this.cachePromise = (async () => {
      const names = await this.storage.keys?.() || [];
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== this.name)
        .map((name) => this.storage.delete(name).catch(() => {})));
      return this.storage.open(this.name);
    })().catch(() => null);
    return this.cachePromise;
  }

  async read(url, expectedBytes) {
    try {
      const cache = await this.cache();
      const response = await cache?.match(url);
      if (!response) return null;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === expectedBytes) return bytes;
      await cache.delete(url);
    } catch { /* Safari in modalità privata può negare Cache Storage. */ }
    return null;
  }

  store(url, bytes) {
    const task = this.writeTail.then(() => this.storeNow(url, bytes));
    this.writeTail = task.catch(() => {});
    return task;
  }

  async storeNow(url, bytes) {
    const cache = await this.cache();
    if (!cache || bytes.byteLength > this.maxBytes) return false;
    const put = () => cache.put(url, new Response(bytes, {
      headers: { 'Content-Type': 'model/gltf-binary' },
    }));
    try {
      await put();
    } catch {
      // La quota di WebKit varia per dispositivo. Libera i file meno recenti e riprova.
      const keys = await cache.keys().catch(() => []);
      for (const key of keys.slice(0, Math.max(1, Math.ceil(keys.length / 2)))) {
        await cache.delete(key).catch(() => {});
      }
      try { await put(); }
      catch { return false; }
    }
    await this.trim(cache, url);
    return true;
  }

  async trim(cache, protectedUrl) {
    const keys = await cache.keys();
    for (const key of keys) {
      if (!this.bytesByUrl.has(key.url)) await cache.delete(key);
    }
    let total = keys.reduce((sum, key) => sum + (this.bytesByUrl.get(key.url) || 0), 0);
    for (const key of keys) {
      if (total <= this.maxBytes) break;
      if (key.url === protectedUrl) continue;
      if (await cache.delete(key)) total -= this.bytesByUrl.get(key.url) || 0;
    }
  }
}
