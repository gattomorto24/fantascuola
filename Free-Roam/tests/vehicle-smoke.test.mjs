import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VehicleSmoke, createSmokeMaterial } from '../js/world/VehicleSmoke.js';

test('il fumo si intensifica col danno, lascia una scia nel mondo e libera la geometria', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const material = createSmokeMaterial();
  const emitter = new VehicleSmoke(scene, root, material, 'car-test');
  try {
    emitter.update(100, 0);
    assert.equal(emitter.points.visible, false);
    emitter.update(20, 16);
    assert.equal(emitter.points.visible, true);
    assert.ok(emitter.opacities.some((value) => value > 0));
    const firstX = emitter.particles[0].position.x;
    root.position.x = 10;
    for (let time = 96; time <= 1216; time += 80) emitter.update(20, time);
    assert.ok(Math.abs(emitter.particles[0].position.x - firstX) < 1);
    assert.ok(emitter.particles.some((particle) => particle.age < particle.life && particle.position.x > 9));
    assert.ok(Math.max(...emitter.sizes) > 0.4);
    assert.ok(emitter.particles.filter((particle) => particle.age < particle.life).length <= emitter.count);
  } finally {
    emitter.dispose();
    material.dispose();
  }
  assert.equal(scene.children.includes(emitter.points), false);
});

test('la moto usa un budget ridotto senza cambiare materiale condiviso', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const material = createSmokeMaterial();
  const emitter = new VehicleSmoke(scene, root, material, 'moto-test', true, 8);
  try {
    emitter.update(50, 0);
    assert.equal(emitter.points.material, material);
    assert.equal(emitter.geometry.attributes.position.count, 8);
    assert.equal(emitter.points.visible, true);
  } finally { emitter.dispose(); material.dispose(); }
});
