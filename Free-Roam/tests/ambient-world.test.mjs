import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AmbientWorld } from '../js/world/AmbientWorld.js';
import { AMBIENT_SOURCE, MOVING_CARS, PARKED_CARS, PEDESTRIANS,
  matchesAmbientMap, sampleRoute } from '../js/world/AmbientMapData.js';
import { WorldCollision } from '../js/world/WorldCollision.js';

const sourceUrl = `https://huggingface.co/buckets/Tony272009/Mappa/resolve/${AMBIENT_SOURCE.file}`;

test('gli arredi sono vincolati alla mappa e alla stessa versione delle zone mobile', () => {
  const manifest = { asset_url: sourceUrl, scale: 1, rotation: 0 };
  assert.equal(matchesAmbientMap(manifest, AMBIENT_SOURCE.sha256), true);
  assert.equal(matchesAmbientMap(manifest, 'a'.repeat(64)), false);
  assert.equal(matchesAmbientMap({ ...manifest, rotation: 90 }), false);
  assert.equal(matchesAmbientMap({ ...manifest, asset_url: 'https://example.test/other.glb' }), false);
});

test('auto e passanti conservano coordinate globali e posizioni deterministiche', () => {
  const time = 1_780_000_000_000;
  for (const actor of [...MOVING_CARS, ...PEDESTRIANS]) {
    const a = sampleRoute(actor.path, actor.speed, actor.phase, time, PEDESTRIANS.includes(actor));
    const b = sampleRoute(actor.path, actor.speed, actor.phase, time, PEDESTRIANS.includes(actor));
    assert.deepEqual(a, b);
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z));
  }
  assert.ok(PARKED_CARS.some((car) => car.position[2] > 110));
  assert.ok(PEDESTRIANS.some((person) => person.path.some((point) => point[2] > 110)));
});

test('attiva vicino al giocatore, aggiunge collisione alle auto in sosta e libera lontano', () => {
  const scene = new THREE.Scene();
  const collision = new WorldCollision();
  const ambient = new AmbientWorld(scene, collision, { isMobile: true });
  const car = PARKED_CARS[0];
  try {
    ambient.update(0.25, { x: car.position[0], z: car.position[2] }, 0);
    assert.ok(ambient.active.has(car.id));
    assert.ok(collision.proxies.length > 0);
    const approach = new THREE.Vector3(car.position[0] - 3, car.position[1], car.position[2]);
    const stopped = collision.resolveHorizontalMovement(approach, new THREE.Vector3(3.5, 0, 0), 0.18, 1);
    assert.equal(stopped.x, approach.x);
    ambient.update(0.25, { x: 1000, z: 1000 }, 0);
    assert.equal(ambient.active.size, 0);
    assert.equal(collision.proxies.length, 0);
  } finally { ambient.dispose(); }
});

test('sul mobile un oggetto compare solo quando la sua zona è caricata', () => {
  const scene = new THREE.Scene();
  const collision = new WorldCollision();
  let ready = false;
  const ambient = new AmbientWorld(scene, collision, { isMobile: true, tileReady: () => ready });
  const car = PARKED_CARS[0];
  const player = { x: car.position[0], z: car.position[2] };
  try {
    ambient.update(0.25, player, 0);
    assert.equal(ambient.active.size, 0);
    ready = true;
    ambient.update(0.25, player, 0);
    assert.ok(ambient.active.has(car.id));
    ready = false;
    ambient.update(0.25, player, 0);
    assert.equal(ambient.active.size, 0);
  } finally { ambient.dispose(); }
});
