import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { validateMobileManifest } from '../js/world/MobileManifest.js';

const directory = new URL('../mobile-maps/Quartiere_Chiesa_Dettagliato.mobile/', import.meta.url);

test('gli asset reali coprono lo spawn e tutte le zone sono pubblicabili', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  validateMobileManifest(manifest, manifest.source.url, { scale: 1, rotation: 0 });
  assert.equal(manifest.tileSize, 16);
  assert.ok(manifest.tiles.length > 100);
  const center = manifest.tiles.find((tile) => tile.x === 0 && tile.z === 0);
  assert.ok(center, 'zona di spawn assente');

  for (const tile of manifest.tiles) {
    const file = new URL(tile.file, directory);
    assert.equal((await stat(file)).size, tile.bytes, `dimensione di ${tile.file}`);
  }

  const glb = await readFile(new URL(center.file, directory));
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const scene = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  assert.ok(scene.meshes[0].primitives.length > 0);
  assert.ok(scene.images.length > 0, 'la zona di spawn deve mantenere le texture originali');
  for (const primitive of scene.meshes[0].primitives) {
    const position = scene.accessors[primitive.attributes.POSITION];
    assert.ok(position.min[0] >= -0.001 && position.max[0] <= 16.001);
    assert.ok(position.min[2] >= -0.001 && position.max[2] <= 16.001);
  }
});
