import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CombatState, findPlayerHit, plausibleHit } from '../js/player/Combat.js';

test('il proiettile colpisce il giocatore più vicino prima della parete', () => {
  const ray = new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const players = new Map([
    ['far', { hasSnapshot: true, health: 100, root: { position: new THREE.Vector3(0, 0, -8) } }],
    ['near', { hasSnapshot: true, health: 100, root: { position: new THREE.Vector3(0, 0, -4) } }],
  ]);
  assert.equal(findPlayerHit(ray, null, players)?.playerId, 'near');
  assert.equal(findPlayerHit(ray, new THREE.Vector3(0, 1, -2), players), null);
  players.get('near').health = 0;
  assert.equal(findPlayerHit(ray, null, players)?.playerId, 'far');
});

test('il ricevente controlla distanza, bersaglio e ostacoli', () => {
  const shot = {
    position: { x: 0, y: 0, z: 0 },
    shotOrigin: [0, 1, 2],
    shotTarget: [0, 1, -4],
  };
  const victim = new THREE.Vector3(0, 0, -4);
  assert.equal(plausibleHit(shot, victim, { raycastShot: () => null }), true);
  assert.equal(plausibleHit(shot, victim, { raycastShot: () => new THREE.Vector3(0, 1, 0) }), false);
  assert.equal(plausibleHit({ ...shot, shotOrigin: [30, 1, 2] }, victim, { raycastShot: () => null }), false);
  assert.equal(plausibleHit(shot, new THREE.Vector3(4, 0, -4), { raycastShot: () => null }), false);
});

test('quattro colpi tolgono 100 punti vita e il respawn protegge brevemente', () => {
  const state = new CombatState();
  for (let i = 0; i < 4; i += 1) assert.equal(state.hit(1000 + i * 400), true);
  assert.equal(state.health, 0);
  assert.equal(state.hit(3000), false);
  assert.equal(state.readyToRespawn(4699), false);
  assert.equal(state.readyToRespawn(4700), true);
  state.respawn(4700);
  assert.equal(state.health, 100);
  assert.equal(state.hit(4800), false);
  assert.equal(state.hit(6500), true);
});
