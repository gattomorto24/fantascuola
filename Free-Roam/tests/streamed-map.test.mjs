import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StreamedMap } from '../js/world/StreamedMap.js';
import { WorldCollision } from '../js/world/WorldCollision.js';
import { MobileTileCache } from '../js/world/MobileTileCache.js';

const source = 'https://huggingface.co/buckets/a/b/resolve/world.glb';
const manifestUrl = source.replace('.glb', '.mobile/manifest.json');

test('il fetch nativo conserva il contesto Window richiesto da Safari', async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    requested = true;
    return Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  };
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 32, tiles: [{ x: 0, z: 0, file: 'tiles/0_0.glb', bytes: 4 }] }, manifestUrl,
    { parse: async () => ({ scene: new THREE.Group() }) });
  try {
    await stream.start(1, 1);
    assert.equal(requested, true);
  } finally {
    stream.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('carica una sola volta, indicizza collisioni e libera le zone lontane', async () => {
  const scene = new THREE.Scene();
  const collision = new WorldCollision();
  const disposed = [];
  const fetched = [];
  const tiles = [-1, 0, 1, 2, 3].map((x) => ({ x, z: 0, file: `tiles/${x}_0.glb`, bytes: 4 }));
  let parsed = 0;
  const stream = new StreamedMap(scene, collision,
    { schema: 1, coordinateSpace: 'world', tileSize: 32,
      source: { url: source, scale: 1, rotation: 0 }, tiles }, manifestUrl,
    {
      maxConcurrent: 1,
      maxWarmTiles: 0,
      fetcher: async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; },
      parse: async () => {
        parsed += 1;
        const group = new THREE.Group();
        const geometry = new THREE.BoxGeometry(32, 1, 32);
        const material = new THREE.MeshBasicMaterial();
        geometry.addEventListener('dispose', () => disposed.push('geometry'));
        material.addEventListener('dispose', () => disposed.push('material'));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((parsed - 1) * 32 + 16, -0.5, 16);
        group.add(mesh);
        return { scene: group };
      },
    });
  await stream.start(1, 1);
  assert.equal(stream.loaded.has('0:0'), true);
  assert.equal(collision.ready, true);
  assert.equal(collision.groundHeightAt(1, 1, 1, 3, 5), 0);
  const first = stream.request('1:0');
  assert.equal(first, stream.request('1:0'));
  await first;
  assert.equal(stream.canMoveTo(40, 1), true);
  assert.equal(fetched.filter((url) => url.endsWith('/1_0.glb')).length, 1);
  stream.update(112, 1);
  assert.equal(stream.loaded.has('0:0'), false);
  assert.ok(disposed.includes('geometry'));
  assert.ok(disposed.includes('material'));
  stream.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(collision.ready, false);
});

test('una zona fallita può essere richiesta di nuovo', async () => {
  let attempts = 0;
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 32, tiles: [{ x: 0, z: 0, file: 'tiles/0_0.glb', bytes: 4 }] }, manifestUrl,
    { fetcher: async () => ({ ok: ++attempts > 1, status: 503, arrayBuffer: async () => new ArrayBuffer(4) }),
      parse: async () => ({ scene: new THREE.Group() }) });
  await assert.rejects(stream.request('0:0'), /HTTP 503/);
  await stream.request('0:0');
  assert.equal(attempts, 2);
  stream.dispose();
});

test('la distanza visiva aumenta le zone richieste e poi libera quelle lontane', () => {
  const tiles = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) tiles.push({ x, z, file: `tiles/${x}_${z}.glb`, bytes: 4 });
  }
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 32, tiles }, manifestUrl);
  assert.equal(stream.tileRadius, 1);
  assert.equal(stream.nearbyKeys(0, 0, stream.tileRadius).length, 9);
  stream.setTileRadius(2);
  assert.equal(stream.tileRadius, 2);
  assert.equal(stream.nearbyKeys(0, 0, stream.tileRadius).length, 13);
  assert.equal(stream.nearbyKeys(0, 0, stream.tileRadius).includes('2:2'), false);
  stream.setTileRadius(1);
  assert.equal(stream.tileRadius, 1);
  assert.equal(stream.nearbyKeys(0, 0, stream.tileRadius).length, 9);
  stream.dispose();
});

test('una zona appena lasciata torna subito; dopo il rilascio viene riletta dai byte salvati', async () => {
  const bytes = new Map();
  const cache = { read: async (url) => bytes.get(url) || null,
    store: async (url, data) => { bytes.set(url, data); return true; } };
  let downloads = 0;
  let parses = 0;
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 16, tiles: [0, 1].map((x) => ({ x, z: 0, file: `tiles/${x}_0.glb`, bytes: 4 })) },
    manifestUrl, { maxWarmTiles: 1, maxWarmBytes: 4, byteCache: cache,
      fetcher: async () => { downloads += 1; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; },
      parse: async () => { parses += 1; return { scene: new THREE.Group() }; } });
  try {
    await stream.request('0:0');
    await Promise.all(stream.cacheWrites);
    stream.unload('0:0');
    await stream.request('0:0');
    assert.equal(downloads, 1);
    assert.equal(parses, 1);
    stream.unload('0:0');
    await stream.request('1:0');
    await Promise.all(stream.cacheWrites);
    stream.unload('1:0');
    assert.equal(stream.warm.has('0:0'), false);
    await stream.request('0:0');
    assert.equal(downloads, 2);
    assert.equal(parses, 3);
  } finally { stream.dispose(); }
});

test('la cache permanente verifica la dimensione, limita lo spazio e separa le versioni', async () => {
  const entries = new Map();
  const fakeCache = { match: async (url) => entries.get(url)?.clone(),
    put: async (url, response) => { entries.set(url, response.clone()); },
    delete: async (key) => entries.delete(typeof key === 'string' ? key : key.url),
    keys: async () => [...entries.keys()].map((url) => ({ url })) };
  const storage = { open: async () => fakeCache, keys: async () => [], delete: async () => true };
  const manifest = { source: { sha256: 'a'.repeat(64) }, tiles: [0, 1, 2]
    .map((x) => ({ x, z: 0, file: `tiles/${x}_0.glb`, bytes: 4 })) };
  const cache = new MobileTileCache(manifest, manifestUrl, { storage, maxBytes: 8 });
  const urls = manifest.tiles.map((tile) => new URL(tile.file, manifestUrl).href);
  for (const url of urls) await cache.store(url, new ArrayBuffer(4));
  assert.equal(await cache.read(urls[0], 4), null);
  assert.equal((await cache.read(urls[2], 4)).byteLength, 4);
  const reopened = new MobileTileCache(manifest, manifestUrl, { storage, maxBytes: 8 });
  assert.equal((await reopened.read(urls[2], 4)).byteLength, 4);
  assert.match(cache.name, /aaaaaaaa/);
  assert.notEqual(cache.name, new MobileTileCache({ ...manifest,
    source: { sha256: 'b'.repeat(64) } }, manifestUrl, { storage }).name);
});

test('il movimento richiede in anticipo una zona davanti al giocatore', () => {
  const tiles = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -1; z <= 1; z += 1) tiles.push({ x, z, file: `tiles/${x}_${z}.glb`, bytes: 4 });
  }
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 16, tiles }, manifestUrl,
    { byteCache: { read: async () => null, store: async () => true },
      fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }) });
  try {
    stream.update(1, 1);
    stream.update(1.4, 1);
    assert.equal(stream.pending.has('2:0'), true);
  } finally { stream.dispose(); }
});

test('una zona già visibile non sparisce appena si attraversa il confine', async () => {
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 16, tiles: [0, 1, 2, 3].map((x) =>
      ({ x, z: 0, file: `tiles/${x}_0.glb`, bytes: 4 })) }, manifestUrl,
    { byteCache: { read: async () => null, store: async () => true },
      fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
      parse: async () => ({ scene: new THREE.Group() }) });
  try {
    await stream.request('0:0');
    stream.update(32, 1);
    assert.equal(stream.loaded.has('0:0'), true);
    stream.update(160, 1);
    assert.equal(stream.loaded.has('0:0'), false);
    assert.equal(stream.warm.has('0:0'), true);
  } finally { stream.dispose(); }
});

test('scarica più zone in parallelo ma limita il parsing GLB a una volta', async () => {
  let downloads = 0;
  let parsing = 0;
  let peakParsing = 0;
  const stream = new StreamedMap(new THREE.Scene(), new WorldCollision(),
    { tileSize: 16, tiles: [0, 1, 2].map((x) =>
      ({ x, z: 0, file: `tiles/${x}_0.glb`, bytes: 4 })) }, manifestUrl,
    { byteCache: { read: async () => null, store: async () => true },
      fetcher: async () => { downloads += 1; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; },
      parse: async () => {
        parsing += 1;
        peakParsing = Math.max(peakParsing, parsing);
        await new Promise((resolve) => setImmediate(resolve));
        parsing -= 1;
        return { scene: new THREE.Group() };
      } });
  try {
    await Promise.all(['0:0', '1:0', '2:0'].map((key) => stream.request(key)));
    assert.equal(downloads, 3);
    assert.equal(peakParsing, 1);
  } finally { stream.dispose(); }
});
