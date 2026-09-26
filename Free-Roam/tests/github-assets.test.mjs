import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGithubAsset } from '../js/assets/GithubAssets.js';

const release = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const pages = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';

function mockRequests(name, size, { published = true, inRelease = true } = {}) {
  const seen = [];
  const request = async (url, options = {}) => {
    seen.push([url, options.method || 'GET']);
    if (url.includes('api.github.com')) return {
      ok: true,
      json: async () => ({ assets: inRelease ? [{ name, size, state: 'uploaded' }] : [] }),
    };
    return { ok: published };
  };
  return { request, seen };
}

test('accetta GLB della Release pubblicati su Pages entro i limiti', async () => {
  const avatarMock = mockRequests('eroe.glb', 50 * 1024 * 1024);
  const avatar = await resolveGithubAsset(`${release}eroe.glb`, 'avatar', avatarMock.request);
  assert.equal(avatar.fileSize, 50 * 1024 * 1024);
  assert.equal(avatar.assetUrl, `${pages}eroe.glb`);
  assert.deepEqual(avatarMock.seen, [
    ['https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/free-roam-assets', 'GET'],
    [avatar.assetUrl, 'HEAD'],
  ]);
  const map = await resolveGithubAsset(`${release}scuola.glb`, 'map', mockRequests('scuola.glb', 500 * 1024 * 1024).request);
  assert.equal(map.fileSize, 500 * 1024 * 1024);
});

test('rifiuta link esterni, asset mancanti, copie non pubblicate e file troppo grandi', async () => {
  await assert.rejects(resolveGithubAsset('https://example.com/eroe.glb', 'avatar'), /Release/);
  await assert.rejects(resolveGithubAsset(`${release}eroe.glb`, 'avatar', mockRequests('eroe.glb', 100, { inRelease: false }).request), /non è presente/);
  await assert.rejects(resolveGithubAsset(`${release}eroe.glb`, 'avatar', mockRequests('eroe.glb', 100, { published: false }).request), /non è ancora pubblicato/);
  await assert.rejects(resolveGithubAsset(`${release}eroe.glb`, 'avatar', mockRequests('eroe.glb', 50 * 1024 * 1024 + 1).request), /50 MB/);
  await assert.rejects(resolveGithubAsset(`${release}mappa.glb`, 'map', mockRequests('mappa.glb', 500 * 1024 * 1024 + 1).request), /500 MB/);
});
