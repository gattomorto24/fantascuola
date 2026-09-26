import { settings } from '../config/settings.js';

const REPO_RELEASE_BASE = 'https://github.com/gattomorto24/fantascuola/releases/download/';
const RELEASE_API_BASE = 'https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/';
const AVATAR_TAG = 'free-roam-assets';
const MAP_TAG = 'maps';
const AVATAR_PAGES_PREFIX = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';

function releaseConfig(kind) {
  if (kind === 'map') {
    return {
      tag: MAP_TAG,
      useDirectReleaseAsset: true,
      label: 'mappa',
    };
  }

  return {
    tag: AVATAR_TAG,
    useDirectReleaseAsset: false,
    label: 'avatar',
  };
}

export async function resolveGithubAsset(releaseUrl, kind, request = fetch) {
  const config = releaseConfig(kind);
  const releasePrefix = `${REPO_RELEASE_BASE}${config.tag}/`;
  const releaseApi = `${RELEASE_API_BASE}${config.tag}`;

  let url;
  try {
    url = new URL(String(releaseUrl).trim());
  } catch {
    throw new Error(`Incolla il link di un asset GLB della Release ${config.tag}.`);
  }

  if (
    url.origin !== 'https://github.com' ||
    !url.href.startsWith(releasePrefix) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`Usa il link GLB della Release ${config.tag} di gattomorto24/fantascuola.`);
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
    throw new Error(`Release GitHub ${config.tag} non disponibile. Controlla il link e riprova.`);
  }

  const asset = release.assets?.find((item) => item.name === fileName && item.state === 'uploaded');
  if (!asset) {
    throw new Error(`Questo GLB non è presente nella Release ${config.tag}.`);
  }

  const fileSize = Number(asset.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 20) {
    throw new Error('Dimensione del file GitHub non verificabile.');
  }

  const limit = kind === 'map' ? settings.assets.maxMapFileSize : settings.assets.maxAvatarFileSize;
  if (fileSize > limit) {
    throw new Error(`Il GLB deve essere al massimo ${Math.round(limit / 1024 / 1024)} MB.`);
  }

  if (config.useDirectReleaseAsset) {
    const assetUrl = asset.browser_download_url || url.href;
    return { assetUrl, fileName, fileSize };
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

  return { assetUrl, fileName, fileSize };
}
