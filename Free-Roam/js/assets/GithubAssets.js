import { settings } from '../config/settings.js';

const REPO_RELEASE_BASE = 'https://github.com/gattomorto24/fantascuola/releases/download/';
const RELEASE_API_BASE = 'https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/';
const AVATAR_TAG = 'free-roam-assets';
const AVATAR_PAGES_PREFIX = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';

function parseContentLength(response) {
  const linked = Number(response.headers?.get?.('x-linked-size'));
  if (Number.isSafeInteger(linked) && linked > 0) return linked;

  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isSafeInteger(length) && length > 0) return length;

  const range = String(response.headers?.get?.('content-range') || '');
  const match = range.match(/\/(\d+)$/);
  const total = Number(match?.[1]);
  if (Number.isSafeInteger(total) && total > 0) return total;

  return null;
}

function parseHuggingFaceMapUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error('Incolla il link pubblico del GLB nel Bucket Hugging Face.');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'huggingface.co' ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Usa un link pubblico https://huggingface.co/buckets/... del Bucket Hugging Face.');
  }

  const match = url.pathname.match(/^\/buckets\/([^/]+)\/([^/]+)\/(resolve|tree)\/(.+\.glb)$/i);
  if (!match) {
    throw new Error('Il link deve puntare a un file .glb dentro un Bucket Hugging Face.');
  }

  const [, owner, bucket, mode, encodedPath] = match;
  const cleanPath = encodedPath.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  const direct = new URL(`https://huggingface.co/buckets/${owner}/${bucket}/resolve/${cleanPath}`);
  const fileName = decodeURIComponent(encodedPath.split('/').pop());

  if (!fileName || !/\.glb$/i.test(fileName)) {
    throw new Error('Il file Hugging Face deve terminare in .glb.');
  }

  if (mode.toLowerCase() === 'tree') {
    // I link copiati dall'interfaccia Bucket usano /tree/. Per Three.js
    // serve invece l'endpoint raw /resolve/.
  }

  return { url: direct, fileName };
}

async function resolveHuggingFaceMapAsset(sourceUrl, request = fetch) {
  const { url, fileName } = parseHuggingFaceMapUrl(sourceUrl);
  let response;

  try {
    response = await request(url.href, { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new Error('Il file Hugging Face non è raggiungibile. Controlla che il Bucket sia pubblico.');
  }

  if (!response.ok) {
    throw new Error(`Hugging Face ha risposto con HTTP ${response.status || 'errore'} per questo GLB.`);
  }

  let fileSize = parseContentLength(response);

  if (!fileSize) {
    try {
      const probe = await request(url.href, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      if (probe.ok || probe.status === 206) fileSize = parseContentLength(probe);
    } catch {
      // La dimensione non è indispensabile per usare la mappa.
    }
  }

  const limit = settings.assets.maxMapFileSize;
  if (fileSize && fileSize > limit) {
    throw new Error(`Il GLB deve essere al massimo ${Math.round(limit / 1024 / 1024)} MB.`);
  }

  return {
    assetUrl: url.href,
    fileName,
    fileSize,
    source: 'huggingface-bucket',
  };
}

async function resolveGithubAvatarAsset(releaseUrl, request = fetch) {
  const releasePrefix = `${REPO_RELEASE_BASE}${AVATAR_TAG}/`;
  const releaseApi = `${RELEASE_API_BASE}${AVATAR_TAG}`;

  let url;
  try {
    url = new URL(String(releaseUrl).trim());
  } catch {
    throw new Error(`Incolla il link di un asset GLB della Release ${AVATAR_TAG}.`);
  }

  if (
    url.origin !== 'https://github.com' ||
    !url.href.startsWith(releasePrefix) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`Usa il link GLB della Release ${AVATAR_TAG} di gattomorto24/fantascuola.`);
  }

  const encodedName = url.href.slice(releasePrefix.length);
  let fileName;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
    throw new Error('Il nome del file GitHub non è valido.');
  }

  if (!/^[A-Za-z0-9._-]+\.glb$/i.test(fileName)) {
    throw new Error('Il file della Release deve avere un nome semplice e terminare in .glb.');
  }

  let release;
  try {
    const releaseResponse = await request(releaseApi, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!releaseResponse.ok) throw new Error('release');
    release = await releaseResponse.json();
  } catch {
    throw new Error(`Release GitHub ${AVATAR_TAG} non disponibile. Controlla il link e riprova.`);
  }

  const asset = release.assets?.find((item) => item.name === fileName && item.state === 'uploaded');
  if (!asset) throw new Error(`Questo GLB non è presente nella Release ${AVATAR_TAG}.`);

  const fileSize = Number(asset.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 20) {
    throw new Error('Dimensione del file GitHub non verificabile.');
  }

  if (fileSize > settings.assets.maxAvatarFileSize) {
    throw new Error(`Il GLB deve essere al massimo ${Math.round(settings.assets.maxAvatarFileSize / 1024 / 1024)} MB.`);
  }

  const assetUrl = `${AVATAR_PAGES_PREFIX}${encodeURIComponent(fileName)}`;
  let response;
  try {
    response = await request(assetUrl, { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new Error('Il file non è raggiungibile su GitHub Pages. Controlla la pubblicazione.');
  }
  if (!response.ok) {
    throw new Error('Il file non è ancora pubblicato su GitHub Pages. Attendi la workflow e riprova.');
  }

  return { assetUrl, fileName, fileSize, source: 'github-release' };
}

export async function resolveGithubAsset(sourceUrl, kind, request = fetch) {
  if (kind === 'map') return resolveHuggingFaceMapAsset(sourceUrl, request);
  return resolveGithubAvatarAsset(sourceUrl, request);
}
