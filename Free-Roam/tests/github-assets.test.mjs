import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGithubAsset } from '../js/assets/GithubAssets.js';

const avatarRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const pages = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';
const hfResolve = 'https://huggingface.co/buckets/Tony272009/Mappa/resolve/';
const hfTree = 'https://huggingface.co/buckets/Tony272009/Mappa/tree/';

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: (name) => normalized[String(name).toLowerCase()] ?? null };
}

function avatarRequests(name, size, { published = true, inRelease = true } = {}) {
  const seen = [];
  const request = async (url, options = {}) => {
    seen.push([url, options.method || 'GET']);
    if (url.includes('api.github.com')) {
      return {
        ok: true,
        status: 200,
        headers: headers(),
        json: async () => ({
          assets: inRelease ? [{ name, size, state: 'uploaded' }] : [],
        }),
      };
    }
    return { ok: published, status: published ? 200 : 404, headers: headers() };
  };
  return { request, seen };
}

function huggingFaceRequest(size, { ok = true } = {}) {
  const seen = [];
  const request = async (url, options = {}) => {
    seen.push([url, options.method || 'GET']);
    return {
      ok,
      status: ok ? 200 : 404,
      headers: headers(size ? { 'content-length': size } : {}),
    };
  };
  return { request, seen };
}

test('avatar continua a usare GitHub Release + mirror Pages', async () => {
  const mock = avatarRequests('eroe.glb', 50 * 1024 * 1024);
  const avatar = await resolveGithubAsset(`${avatarRelease}eroe.glb`, 'avatar', mock.request);

  assert.equal(avatar.fileSize, 50 * 1024 * 1024);
  assert.equal(avatar.assetUrl, `${pages}eroe.glb`);
  assert.deepEqual(mock.seen, [
    ['https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/free-roam-assets', 'GET'],
    [avatar.assetUrl, 'HEAD'],
  ]);
});

test('mappa usa direttamente Hugging Face Bucket e legge la dimensione senza scaricare il GLB', async () => {
  const direct = `${hfResolve}Quartiere_Chiesa_Dettagliato.glb`;
  const mock = huggingFaceRequest(816976060);

  const map = await resolveGithubAsset(direct, 'map', mock.request);

  assert.equal(map.fileSize, 816976060);
  assert.equal(map.assetUrl, direct);
  assert.equal(map.source, 'huggingface-bucket');
  assert.deepEqual(mock.seen, [[direct, 'HEAD']]);
});

test('accetta anche il link /tree/ copiato dalla UI e lo converte in /resolve/', async () => {
  const source = `${hfTree}Quartiere_Chiesa_Dettagliato.glb`;
  const direct = `${hfResolve}Quartiere_Chiesa_Dettagliato.glb`;
  const mock = huggingFaceRequest(816976060);

  const map = await resolveGithubAsset(source, 'map', mock.request);

  assert.equal(map.assetUrl, direct);
  assert.deepEqual(mock.seen, [[direct, 'HEAD']]);
});

test('rifiuta sorgenti mappa non Hugging Face, file mancanti e mappe oltre 1 GiB', async () => {
  await assert.rejects(
    resolveGithubAsset('https://github.com/gattomorto24/fantascuola/releases/download/maps/mappa.glb', 'map', huggingFaceRequest(100).request),
    /Hugging Face/,
  );

  await assert.rejects(
    resolveGithubAsset(`${hfResolve}mappa.glb`, 'map', huggingFaceRequest(100, { ok: false }).request),
    /HTTP 404/,
  );

  await assert.rejects(
    resolveGithubAsset(`${hfResolve}mappa.glb`, 'map', huggingFaceRequest(1024 * 1024 * 1024 + 1).request),
    /1024 MB/,
  );
});
