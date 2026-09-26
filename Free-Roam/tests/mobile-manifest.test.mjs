import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileManifestUrl, validateMobileManifest } from '../js/world/MobileManifest.js';

const url = 'https://huggingface.co/buckets/a/b/resolve/world.glb';
const manifest = { schema: 1, coordinateSpace: 'world', tileSize: 32,
  source: { url, scale: 1, rotation: 0, sha256: 'a'.repeat(64) },
  tiles: [{ x: 0, z: 0, file: 'tiles/0_0.glb', bytes: 128 }],
};

test('URL e coordinate del manifest mobile coincidono con il GLB desktop', () => {
  assert.equal(mobileManifestUrl(url, 'https://example.test/fantascuola/Free-Roam/js/world/MobileManifest.js'),
    'https://example.test/fantascuola/Free-Roam/mobile-maps/world.mobile/manifest.json');
  assert.equal(validateMobileManifest(manifest, url, { scale: 1, rotation: 0 }), manifest);
  assert.throws(() => validateMobileManifest(manifest, url, { scale: 2, rotation: 0 }), /incompatibile/);
  assert.throws(() => validateMobileManifest({ ...manifest, tiles: [...manifest.tiles, manifest.tiles[0]] }, url), /duplicata/);
  assert.throws(() => validateMobileManifest({ ...manifest, schema: 2 }, url), /incompatibile/);
});
