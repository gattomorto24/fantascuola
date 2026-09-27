import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldManager } from '../js/world/WorldManager.js';
import { AMBIENT_SOURCE } from '../js/world/AmbientMapData.js';

function planeGLB() {
  const positions = Buffer.from(new Float32Array([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 2, 1, 0, 3, 2]).buffer);
  const bin = Buffer.alloc(positions.length + indices.length);
  positions.copy(bin); indices.copy(bin, positions.length);
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ doubleSided: true }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-10, 0, -10], max: [10, 0, 10] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }],
  };
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc((json.length + 3) & ~3, 0x20); json.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  const at = 20 + padded.length;
  glb.writeUInt32LE(bin.length, at); glb.writeUInt32LE(0x004e4942, at + 4); bin.copy(glb, at + 8);
  return glb;
}

test('WorldManager usa le zone sul mobile, con collisioni e spawn globali', async () => {
  const source = `https://huggingface.co/buckets/Tony272009/Mappa/resolve/${AMBIENT_SOURCE.file}`;
  const mobile = source.replace('.glb', '.mobile/manifest.json');
  const tile = planeGLB();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === mobile) return { ok: true, json: async () => ({ schema: 1, coordinateSpace: 'world', tileSize: 32,
      source: { url: source, scale: 1, rotation: 0, sha256: AMBIENT_SOURCE.sha256 },
      tiles: [{ x: 0, z: 0, file: 'tiles/0_0.glb', bytes: tile.length }],
    }) };
    if (url.endsWith('/tiles/0_0.glb')) return { ok: true, arrayBuffer: async () => tile.buffer.slice(tile.byteOffset, tile.byteOffset + tile.length) };
    throw new Error(`URL inatteso: ${url}`);
  };
  const world = new WorldManager(new THREE.Scene());
  try {
    const result = await world.loadWorld({ id: 'map', enabled: true, name: 'Scuola', asset_url: source,
      metadata: { mobile_manifest_url: mobile }, spawn: [1, 1, 1], scale: 1, rotation: 0 }, {}, () => {}, () => {}, { isMobile: true });
    assert.equal(result.fallback, false);
    assert.equal(world.ground.visible, false);
    assert.equal(world.spawn[0], 1);
    assert.equal(world.groundHeightAt(1, 1, 1, 3, 5), 0);
    assert.equal(world.streamedMap.loaded.size, 1);
    assert.ok(world.ambient);
  } finally { world.dispose(); globalThis.fetch = oldFetch; }
});

test('WorldManager mantiene il caricamento GLB completo sul desktop', async () => {
  const oldRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const world = new WorldManager(new THREE.Scene());
  let called = false;
  world.mapLoader.load = async () => {
    called = true;
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(10, 1, 10), new THREE.MeshBasicMaterial()));
    world.mapLoader.object = root;
    world.scene.add(root);
    return root;
  };
  try {
    const result = await world.loadWorld({ enabled: true,
      asset_url: `https://huggingface.co/buckets/Tony272009/Mappa/resolve/${AMBIENT_SOURCE.file}`,
      spawn: [0, 1, 0] }, {}, () => {}, () => {}, { isMobile: false });
    assert.equal(called, true);
    assert.equal(result.fallback, false);
    assert.equal(world.streamedMap, null);
    assert.equal(world.collision.ready, true);
    assert.ok(world.ambient);
  } finally { world.dispose(); globalThis.requestAnimationFrame = oldRaf; }
});
