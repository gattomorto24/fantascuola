import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateMobileManifest } from './MobileManifest.js';
import { MobileTileCache } from './MobileTileCache.js';

const loader = new GLTFLoader();

function tileKey(x, z) { return `${x}:${z}`; }

export function disposeTile(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) {
    texture.dispose();
    texture.source?.data?.close?.();
  }
  for (const material of materials) material.dispose();
}

export { validateMobileManifest };

export class StreamedMap {
  constructor(scene, collision, manifest, manifestUrl, options = {}) {
    this.scene = scene;
    this.collision = collision;
    this.manifest = manifest;
    this.baseUrl = new URL(manifestUrl);
    this.tiles = new Map(manifest.tiles.map((tile) => [tileKey(tile.x, tile.z), tile]));
    this.loaded = new Map();
    this.warm = new Map();
    this.warmBytes = 0;
    this.pending = new Map();
    this.failures = new Map();
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.parseBarrier = Promise.resolve();
    this.maxWarmTiles = options.maxWarmTiles ?? 2;
    this.maxWarmBytes = options.maxWarmBytes ?? 24 * 1024 * 1024;
    this.maxVisibleTiles = options.maxVisibleTiles ?? 13;
    this.maxVisibleBytes = options.maxVisibleBytes ?? 72 * 1024 * 1024;
    this.visibleDistance = options.visibleDistance ?? 58;
    this.byteCache = options.byteCache || new MobileTileCache(manifest, manifestUrl);
    this.cacheWrites = new Set();
    this.tileRadius = 1;
    this.anisotropy = 1;
    // WebKit requires Window.fetch to be called with Window as its receiver.
    this.fetcher = options.fetcher || ((...args) => globalThis.fetch(...args));
    this.parse = options.parse || ((bytes) => loader.parseAsync(bytes, this.baseUrl.href));
    this.disposed = false;
    this.center = null;
    this.lastRecheck = 0;
    this.motionAnchor = null;
    this.heading = null;
    this.focus = null;
    this.deferPump = false;
    this.onError = options.onError || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.initialKey = null;
  }

  cell(x, z) {
    return [Math.floor(x / this.manifest.tileSize), Math.floor(z / this.manifest.tileSize)];
  }

  hasLoaded(x, z) {
    const [cx, cz] = this.cell(x, z);
    return !this.tiles.has(tileKey(cx, cz)) || this.loaded.has(tileKey(cx, cz));
  }

  canMoveTo(x, z) {
    const [cx, cz] = this.cell(x, z);
    const key = tileKey(cx, cz);
    return this.loaded.has(key);
  }

  request(key, priority = false) {
    if (this.disposed) return Promise.reject(new Error('Mappa chiusa.'));
    if (this.loaded.has(key)) return Promise.resolve(this.loaded.get(key));
    const ready = this.warm.get(key);
    if (ready) {
      this.warm.delete(key);
      this.warmBytes -= this.tiles.get(key).bytes;
      this.scene.add(ready);
      this.collision.add(ready);
      this.loaded.set(key, ready);
      return Promise.resolve(ready);
    }
    if (this.pending.has(key)) {
      const existing = this.pending.get(key);
      if (priority && !existing.started) {
        this.queue = this.queue.filter((job) => job !== existing);
        this.queue.unshift(existing);
      }
      return existing.promise;
    }
    const tile = this.tiles.get(key);
    if (!tile) return Promise.resolve(null);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const job = { key, tile, promise, resolve, reject, controller: new AbortController(), started: false };
    this.pending.set(key, job);
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    if (!this.deferPump) this.pump();
    return promise;
  }

  pump() {
    while (!this.disposed && this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      if (this.pending.get(job.key) !== job) continue;
      job.started = true;
      this.active += 1;
      this.loadJob(job).finally(() => { this.active -= 1; this.pump(); });
    }
  }

  async parseOne(bytes, job) {
    const previous = this.parseBarrier;
    let release;
    this.parseBarrier = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      if (job.controller.signal.aborted) return null;
      return await this.parse(bytes);
    } finally { release(); }
  }

  async loadJob(job) {
    let root;
    try {
      const url = new URL(job.tile.file, this.baseUrl);
      let bytes = await this.byteCache.read(url.href, job.tile.bytes);
      const fromCache = Boolean(bytes);
      if (job.controller.signal.aborted) { job.resolve(null); return; }
      if (!bytes) {
        const response = await this.fetcher(url.href, { signal: job.controller.signal, cache: 'force-cache' });
        if (!response.ok) throw new Error(`Zona ${job.key}: HTTP ${response.status}`);
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const target = new Uint8Array(job.tile.bytes);
          let loaded = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (loaded + value.byteLength > target.byteLength) throw new Error(`Zona ${job.key}: dimensione inattesa.`);
            target.set(value, loaded);
            loaded += value.byteLength;
            if (job.key === this.initialKey) this.onProgress(loaded, job.tile.bytes);
          }
          if (loaded !== target.byteLength) throw new Error(`Zona ${job.key}: download incompleto.`);
          bytes = target.buffer;
        } else {
          bytes = await response.arrayBuffer();
          if (job.key === this.initialKey) this.onProgress(bytes.byteLength, job.tile.bytes);
        }
      } else if (job.key === this.initialKey) this.onProgress(bytes.byteLength, job.tile.bytes);
      if (bytes.byteLength !== job.tile.bytes) throw new Error(`Zona ${job.key}: dimensione inattesa.`);
      const gltf = await this.parseOne(bytes, job);
      if (!gltf && job.controller.signal.aborted) { job.resolve(null); return; }
      root = gltf.scene;
      if (!root) throw new Error(`Zona ${job.key}: scena assente.`);
      if (this.disposed || this.pending.get(job.key) !== job) {
        disposeTile(root);
        job.resolve(null);
        return;
      }
      root.updateMatrixWorld(true);
      this.applyTextureQuality(root);
      this.scene.add(root);
      this.collision.add(root);
      this.loaded.set(job.key, root);
      this.failures.delete(job.key);
      this.pending.delete(job.key);
      job.resolve(root);
      if (!fromCache) {
        const write = this.byteCache.store(url.href, bytes).catch(() => false);
        this.cacheWrites.add(write);
        write.finally(() => this.cacheWrites.delete(write));
      }
    } catch (error) {
      if (root) { this.scene.remove(root); this.collision.remove(root); disposeTile(root); }
      if (this.pending.get(job.key) === job) this.pending.delete(job.key);
      if (!job.controller.signal.aborted) {
        const count = (this.failures.get(job.key)?.count || 0) + 1;
        this.failures.set(job.key, { count, error,
          nextRetryAt: Date.now() + Math.min(30000, 1000 * 2 ** Math.min(count - 1, 5)) });
      }
      job.reject(error);
    }
  }

  unload(key) {
    const job = this.pending.get(key);
    if (job) {
      this.pending.delete(key);
      job.controller.abort();
      job.resolve(null);
    }
    const root = this.loaded.get(key);
    if (!root) return;
    this.loaded.delete(key);
    this.collision.remove(root);
    this.scene.remove(root);
    const bytes = this.tiles.get(key)?.bytes || 0;
    if (!this.disposed && this.maxWarmTiles > 0 && bytes <= this.maxWarmBytes) {
      this.warm.set(key, root);
      this.warmBytes += bytes;
      while (this.warm.size > this.maxWarmTiles || this.warmBytes > this.maxWarmBytes) {
        const oldest = this.warm.keys().next().value;
        this.warmBytes -= this.tiles.get(oldest)?.bytes || 0;
        disposeTile(this.warm.get(oldest));
        this.warm.delete(oldest);
      }
    } else disposeTile(root);
  }

  nearbyKeys(cx, cz, radius) {
    const result = [];
    for (let distance = 0; distance <= radius * 2; distance += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (radius > 1 && Math.abs(dx) + Math.abs(dz) > radius) continue;
          if (Math.abs(dx) + Math.abs(dz) !== distance) continue;
          const key = tileKey(cx + dx, cz + dz);
          if (this.tiles.has(key)) result.push(key);
        }
      }
    }
    return result;
  }

  applyTextureQuality(root) {
    root.traverse((node) => {
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture && value.anisotropy !== this.anisotropy) {
            value.anisotropy = this.anisotropy;
            value.needsUpdate = true;
          }
        }
      }
    });
  }

  setQuality(anisotropy) {
    this.anisotropy = anisotropy;
    for (const root of this.loaded.values()) this.applyTextureQuality(root);
  }

  setTileRadius(radius) {
    const next = Math.max(1, Math.min(2, Math.round(radius)));
    if (next === this.tileRadius) return;
    this.tileRadius = next;
    this.center = null;
    this.focus = null;
  }

  setVisibleDistance(distance) {
    this.visibleDistance = distance;
    this.focus = null;
  }

  async start(x, z) {
    const [cx, cz] = this.cell(x, z);
    const centerKey = tileKey(cx, cz);
    if (!this.tiles.has(centerKey)) throw new Error('Il punto di spawn non è coperto dalla mappa mobile.');
    this.initialKey = centerKey;
    try { await this.request(centerKey, true); }
    finally { this.initialKey = null; }
    if (!this.loaded.has(centerKey)) throw new Error('Zona di spawn non caricata.');
    this.update(x, z);
  }

  async ensureAt(x, z) {
    const [cx, cz] = this.cell(x, z);
    const key = tileKey(cx, cz);
    if (!this.tiles.has(key)) throw new Error(`Zona di spawn ${key} assente nel manifest mobile.`);
    await this.request(key, true);
    if (!this.loaded.has(key)) throw new Error(`Zona di spawn ${key} non caricata.`);
    this.update(x, z);
  }

  update(x, z) {
    if (this.disposed) return;
    const [cx, cz] = this.cell(x, z);
    const now = Date.now();
    if (!this.motionAnchor) this.motionAnchor = { x, z, at: now };
    const motionX = x - this.motionAnchor.x;
    const motionZ = z - this.motionAnchor.z;
    const moved = Math.hypot(motionX, motionZ);
    if (moved >= 0.28) {
      this.heading = moved < this.manifest.tileSize * 3
        ? { x: motionX / moved, z: motionZ / moved } : null;
      this.motionAnchor = { x, z, at: now };
    } else if (now - this.motionAnchor.at > 1200) this.heading = null;
    let forwardKey = null;
    if (this.heading) {
      const majorX = Math.abs(this.heading.x) >= Math.abs(this.heading.z);
      forwardKey = tileKey(cx + (majorX ? Math.sign(this.heading.x) * 2 : 0),
        cz + (majorX ? 0 : Math.sign(this.heading.z) * 2));
      if (!this.tiles.has(forwardKey)) forwardKey = null;
    }
    const prioritize = () => {
      const distance = (job) => {
        const size = this.manifest.tileSize;
        const aheadX = x + (this.heading?.x || 0) * size * 0.8;
        const aheadZ = z + (this.heading?.z || 0) * size * 0.8;
        const dx = aheadX - Math.max(job.tile.x * size, Math.min(aheadX, (job.tile.x + 1) * size));
        const dz = aheadZ - Math.max(job.tile.z * size, Math.min(aheadZ, (job.tile.z + 1) * size));
        return dx * dx + dz * dz;
      };
      this.queue.sort((a, b) => distance(a) - distance(b));
    };
    const focus = `${tileKey(cx, cz)}|${forwardKey || ''}`;
    if (this.focus === focus && now - this.lastRecheck < 1200) {
      prioritize();
      return;
    }
    this.center = tileKey(cx, cz);
    this.focus = focus;
    this.lastRecheck = now;
    const wanted = new Set(this.nearbyKeys(cx, cz, this.tileRadius));
    if (forwardKey) wanted.add(forwardKey);
    const distanceToTile = (key) => {
      const tile = this.tiles.get(key);
      const size = this.manifest.tileSize;
      const dx = x - Math.max(tile.x * size, Math.min(x, (tile.x + 1) * size));
      const dz = z - Math.max(tile.z * size, Math.min(z, (tile.z + 1) * size));
      return Math.hypot(dx, dz);
    };
    const keep = new Set(wanted);
    let keepBytes = [...wanted].reduce((sum, key) => sum + (this.tiles.get(key)?.bytes || 0), 0);
    const recent = [...this.loaded.keys()].filter((key) => !wanted.has(key))
      .sort((a, b) => distanceToTile(a) - distanceToTile(b));
    for (const key of recent) {
      const bytes = this.tiles.get(key)?.bytes || 0;
      if (distanceToTile(key) > Math.min(this.visibleDistance * 0.8, this.manifest.tileSize * 3)
        || keep.size >= this.maxVisibleTiles || keepBytes + bytes > this.maxVisibleBytes) continue;
      keep.add(key);
      keepBytes += bytes;
    }
    for (const key of [...this.loaded.keys(), ...this.pending.keys()]) {
      if (!keep.has(key)) this.unload(key);
    }
    this.deferPump = true;
    for (const key of wanted) {
      if ((this.failures.get(key)?.nextRetryAt || 0) <= now) this.request(key).catch(this.onError);
    }
    this.deferPump = false;
    prioritize();
    this.pump();
  }

  dispose() {
    this.disposed = true;
    for (const key of [...this.pending.keys(), ...this.loaded.keys()]) this.unload(key);
    for (const root of this.warm.values()) disposeTile(root);
    this.warm.clear();
    this.warmBytes = 0;
    this.queue.length = 0;
  }
}
