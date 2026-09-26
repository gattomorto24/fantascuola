import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGithubAsset } from '../js/assets/GithubAssets.js';

const avatarRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const mapRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/maps/';
const pages = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';

function mockRequests(name, size, {
  published = true,
  inRelease = true,
  browserDownloadUrl = null,
} = {}) {
  const seen = [];
  const request = async (url, options = {}) => {
    seen.push([url, options.method || 'GET']);
    if (url.includes('api.github.com')) {
      return {
        ok: true,
        json: async () => ({
          assets: inRelease ? [{
            name,
            size,
            state: 'uploaded',
            browser_download_url: browserDownloadUrl,
          }] : [],
        }),
      };
    }
    return { ok: published };
  };
  return { request, seen };
}

test('avatar continua a usare il mirror GitHub Pages', async () => {
  const avatarMock = mockRequests('eroe.glb', 50 * 1024 * 1024);
  const avatar = await resolveGithubAsset(`${avatarRelease}eroe.glb`, 'avatar', avatarMock.request);

  assert.equal(avatar.fileSize, 50 * 1024 * 1024);
  assert.equal(avatar.assetUrl, `${pages}eroe.glb`);
  assert.deepEqual(avatarMock.seen, [
    ['https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/free-roam-assets', 'GET'],
    [avatar.assetUrl, 'HEAD'],
  ]);
});

test('mappa usa direttamente la Release maps e accetta file fino a 1 GiB', async () => {
  const direct = `${mapRelease}Quartiere_Chiesa_Dettagliato.glb`;
  const mapMock = mockRequests(
    'Quartiere_Chiesa_Dettagliato.glb',
    816976060,
    { browserDownloadUrl: direct },
  );

  const map = await resolveGithubAsset(direct, 'map', mapMock.request);

  assert.equal(map.fileSize, 816976060);
  assert.equal(map.assetUrl, direct);
  assert.deepEqual(mapMock.seen, [
    ['https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/maps', 'GET'],
  ]);
});

test('rifiuta link esterni, tag sbagliati, asset mancanti e file troppo grandi', async () => {
  await assert.rejects(resolveGithubAsset('https://example.com/eroe.glb', 'avatar'), /Release/);

  await assert.rejects(
    resolveGithubAsset(`${avatarRelease}eroe.glb`, 'avatar', mockRequests('eroe.glb', 100, { inRelease: false }).request),
    /non è presente/,
  );

  await assert.rejects(
    resolveGithubAsset(`${avatarRelease}eroe.glb`, 'avatar', mockRequests('eroe.glb', 100, { published: false }).request),
    /non è ancora pubblicato/,
  );

  await assert.rejects(
    resolveGithubAsset(`${avatarRelease}eroe.glb`, 'avatar', mockRequests('eroe.glb', 50 * 1024 * 1024 + 1).request),
    /50 MB/,
  );

  await assert.rejects(
    resolveGithubAsset(`${avatarRelease}mappa.glb`, 'map', mockRequests('mappa.glb', 100).request),
    /Release maps/,
  );

  await assert.rejects(
    resolveGithubAsset(
      `${mapRelease}mappa.glb`,
      'map',
      mockRequests('mappa.glb', 1024 * 1024 * 1024 + 1, { browserDownloadUrl: `${mapRelease}mappa.glb` }).request,
    ),
    /1024 MB/,
  );
});
