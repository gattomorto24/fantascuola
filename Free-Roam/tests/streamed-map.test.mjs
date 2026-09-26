import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StreamedMap } from '../js/world/StreamedMap.js';
import { WorldCollision } from '../js/world/WorldCollision.js';

const source = 'https://huggingface.co/buckets/a/b/resolve/world.glb';
const manifestUrl = source.replace('.glb', '.mobile/manifest.json');

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
