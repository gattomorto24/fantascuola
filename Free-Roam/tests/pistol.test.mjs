import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pistol } from '../js/player/Pistol.js';
import { ThirdPersonCamera } from '../js/camera/ThirdPersonCamera.js';
import { WorldManager } from '../js/world/WorldManager.js';
import { settings } from '../js/config/settings.js';

test('la pistola si estrae, spara con cadenza limitata e libera gli effetti', () => {
  const scene = new THREE.Scene();
  const player = new THREE.Group();
  scene.add(player);
  const pistol = new Pistol(scene, player);
  pistol.setDrawn(true);
  pistol.setAiming(true);
  assert.equal(pistol.group.visible, true);
  assert.equal(pistol.aiming, true);
  assert.equal(pistol.fireTo([0, 0.6, -20], { local: true }), true);
  assert.equal(pistol.fireTo([0, 0.6, -20], { local: true }), false);
  assert.equal(pistol.shotId, 1);
  assert.equal(pistol.effects.length, 1);
  pistol.update(0.2);
  assert.equal(pistol.effects.length, 0);
  pistol.setDrawn(false);
  assert.equal(pistol.group.visible, false);
  assert.equal(pistol.aiming, false);
  pistol.dispose();
  assert.equal(player.children.length, 0);
});

test('la mira avvicina la camera e restringe il campo visivo', () => {
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 260);
  const follow = new ThirdPersonCamera(camera, settings.camera);
  const player = new THREE.Vector3();
  const input = { cameraX: 0, cameraY: 0, zoom: 0, aiming: false };
  follow.update(0.016, input, player);
  const normalDistance = camera.position.length();
  follow.update(1, { ...input, aiming: true }, player);
  assert.ok(camera.fov < 55);
  assert.ok(camera.position.length() < normalDistance);
  follow.update(1, input, player);
  assert.ok(camera.fov > 64);
});

test('lo sparo incontra le collisioni della mappa', () => {
  const scene = new THREE.Scene();
  const world = new WorldManager(scene);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
  box.position.set(0, 1, -5);
  scene.add(box);
  world.collision.add(box);
  const hit = world.raycastShot(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), 20);
  assert.ok(hit);
  assert.ok(Math.abs(hit.z + 4.5) < 0.01);
  world.dispose();
  scene.remove(box);
  box.geometry.dispose();
  box.material.dispose();
});
