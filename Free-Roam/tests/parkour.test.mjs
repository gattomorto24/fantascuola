import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldCollision } from '../js/world/WorldCollision.js';
import { ClimbDetector } from '../js/player/ClimbDetector.js';
import { ParkourController } from '../js/player/ParkourController.js';
import { PlayerController } from '../js/player/PlayerController.js';
import { settings } from '../js/config/settings.js';
import { MultiplayerManager, validSnapshot } from '../js/multiplayer/MultiplayerManager.js';
import { DEFAULT_PIXEL_AVATAR } from '../js/avatars/AvatarConfig.js';
import { createPixelAvatar } from '../js/avatars/PixelAvatarRenderer.js';

function wallWorld(height = 1.4, noClimb = false) {
  const scene = new THREE.Scene();
  const collision = new WorldCollision();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, height, 1), new THREE.MeshBasicMaterial());
  wall.position.set(0, height / 2, -1);
  wall.userData.noClimb = noClimb;
  scene.add(wall);
  collision.add(wall);
  return { scene, collision, customMapLoaded: true, streamedMap: null, wall,
    groundHeightAt: () => 0,
    resolveHorizontalMovement: (position, movement) => position.clone().add(movement),
    spawn: [0, 0, 0] };
}

test('preferisce il bordo geometrico alla scalata fallback e conserva coordinate del tetto', () => {
  const world = wallWorld();
  const detector = new ClimbDetector(world);
  const target = detector.scan(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, -4), new THREE.Vector3(0, 0, -1));
  assert.equal(target?.kind, 'ledge');
  assert.ok(Math.abs(target.top.point.y - 1.4) < 0.001);
  assert.ok(Math.abs(target.hang.z + 0.19) < 0.01);
  assert.ok(target.stand.z < -0.5);
});

test('una parete alta senza bordo raggiungibile produce solo fallback; oggetti marcati noClimb sono esclusi', () => {
  const world = wallWorld(5);
  const detector = new ClimbDetector(world);
  const pose = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  assert.equal(detector.scan(pose, forward, forward, forward)?.kind, 'wall');
  world.wall.userData.noClimb = true;
  assert.equal(detector.scan(pose, forward, forward, forward), null);
  const low = wallWorld(0.5);
  assert.equal(new ClimbDetector(low).scan(pose, forward, forward, forward), null);
});

test('senza mappa il movimento e il salto ordinari restano disponibili', () => {
  const world = wallWorld();
  world.customMapLoaded = false;
  const player = { root: new THREE.Group(), movementState: 'Idle', updateVisual() {} };
  const controller = new PlayerController(player, world, settings.player);
  controller.update(0.016, { moveX: 0, moveY: 1, sprint: true, jump: true }, 0);
  assert.ok(player.root.position.z < 0);
  assert.ok(controller.velocity.y > 0);
  assert.equal(controller.parkour.active, false);
  assert.equal(player.movementState, 'Jumping');
});

test('il controller prende il bordo durante il salto e termina sopra il tetto senza cambiare lo spazio globale', () => {
  const world = wallWorld();
  const player = { root: new THREE.Group(), movementState: 'Idle', updateVisual() {} };
  const controller = new PlayerController(player, world, settings.player);
  controller.update(0.016, { moveX: 0, moveY: 1, sprint: true, jump: true }, 0);
  assert.equal(controller.parkour.state, 'LEDGE_GRAB');
  for (let i = 0; i < 25; i += 1) controller.update(0.016, { moveX: 0, moveY: 0, jump: false }, 0);
  assert.equal(controller.parkour.state, 'HANGING');
  controller.update(0.016, { moveX: 0, moveY: 1, jump: true }, 0);
  assert.equal(controller.parkour.state, 'CLIMB_UP');
  for (let i = 0; i < 90 && controller.parkour.state !== 'LANDING'; i += 1) {
    controller.update(0.016, { moveX: 0, moveY: 0, jump: false }, 0);
  }
  assert.ok(player.root.position.y >= 1.3);
  assert.ok(player.root.position.z < -0.5);
  assert.equal(controller.parkour.active, false);
});

test('fallback resta attaccato alla parete, non sale senza parete e il salto indietro ha cooldown', () => {
  const world = wallWorld(5);
  const player = { root: new THREE.Group(), movementState: 'Idle', updateVisual() {} };
  const controller = { player, velocity: new THREE.Vector3(0, -1, -4), grounded: false };
  const parkour = new ParkourController(controller, world);
  assert.equal(parkour.tryAcquire(0.016, { moveX: 0, moveY: 1 }, new THREE.Vector3(0, 0, -1), 0), true);
  assert.equal(parkour.state, 'FALLBACK_GRAB');
  for (let i = 0; i < 20; i += 1) parkour.update(0.016, { moveX: 0, moveY: 1, jump: false });
  assert.equal(parkour.state, 'FALLBACK_CLIMB');
  assert.ok(player.root.position.y > 0);
  assert.ok(Math.abs(player.root.position.z + 0.18) < 0.15);
  parkour.update(0.016, { moveX: 0, moveY: -1, jump: true });
  assert.equal(parkour.state, 'WALL_JUMP');
  assert.ok(controller.velocity.z > 0);
  assert.ok(parkour.cooldown > 0);
});

test('una zona rimossa lascia la presa; lo stato parkour viaggia come estensione opzionale crossplay', () => {
  const world = wallWorld();
  const player = { root: new THREE.Group(), movementState: 'LEDGE_GRAB', parkourState: 'LEDGE_GRAB',
    avatarId: 'pixel', avatarConfig: DEFAULT_PIXEL_AVATAR, health: 100, weapon: {}, updateVisual() {} };
  const controller = { player, velocity: new THREE.Vector3(0, -1, -4), grounded: false };
  const parkour = new ParkourController(controller, world);
  assert.equal(parkour.tryAcquire(0.016, { moveX: 0, moveY: 1 }, new THREE.Vector3(0, 0, -1), 0), true);
  const network = new MultiplayerManager(null, { userId: 'test', displayName: 'Test' }, player, null,
    {}, () => {});
  const snapshot = network.snapshot();
  assert.equal(snapshot.movementState, 'Jumping');
  assert.equal(snapshot.parkourState, 'LEDGE_GRAB');
  assert.equal(validSnapshot(snapshot), true);
  world.collision.remove(world.wall);
  parkour.update(0.016, { moveX: 0, moveY: 0, jump: false });
  assert.equal(parkour.active, false);
});

test('scalando una parete senza appigli prende il bordo e arriva in piedi sul tetto', () => {
  const world = wallWorld(3);
  const player = { root: new THREE.Group(), movementState: 'Idle', updateVisual() {} };
  const controller = { player, velocity: new THREE.Vector3(0, -1, -4), grounded: false };
  const parkour = new ParkourController(controller, world);
  assert.equal(parkour.tryAcquire(0.016, {}, new THREE.Vector3(0, 0, -1), 0), true);
  const seen = new Set();
  let maxStep = 0;
  for (let i = 0; i < 250 && parkour.state !== 'LANDING'; i += 1) {
    const previous = player.root.position.clone();
    parkour.update(0.016, { moveX: 0, moveY: 1, jump: false });
    maxStep = Math.max(maxStep, previous.distanceTo(player.root.position));
    seen.add(parkour.state);
  }
  assert.ok(seen.has('FALLBACK_CLIMB'));
  assert.ok(seen.has('LEDGE_GRAB'));
  assert.ok(seen.has('HANGING'));
  assert.ok(seen.has('CLIMB_UP'));
  assert.equal(parkour.state, 'LANDING');
  assert.ok(Math.abs(player.root.position.y - 3.025) < 0.02);
  assert.ok(maxStep < 0.2);
});

test('l’avatar alza le mani davanti al muro, porta un ginocchio sul bordo e torna in posa neutra', () => {
  const avatar = createPixelAvatar();
  for (let i = 0; i < 20; i += 1) avatar.update(0.016, 'HANGING');
  assert.ok(avatar.parts.leftArm.rotation.x > 1.8);
  assert.ok(avatar.parts.rightArm.rotation.x > 1.8);
  for (let i = 0; i < 14; i += 1) avatar.update(0.016, 'CLIMB_UP', 0.58);
  assert.ok(avatar.parts.leftLeg.rotation.x > 0.75);
  for (let i = 0; i < 30; i += 1) avatar.update(0.016, 'Idle');
  assert.ok(Math.abs(avatar.parts.leftArm.rotation.x) < 0.1);
  assert.ok(Math.abs(avatar.parts.leftLeg.rotation.x) < 0.1);
});
