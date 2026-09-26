import { settings } from '../config/settings.js';

const RELEASE_PREFIX = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const PAGES_PREFIX = 'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/';
const RELEASE_API = 'https://api.github.com/repos/gattomorto24/fantascuola/releases/tags/free-roam-assets';

export async function resolveGithubAsset(releaseUrl, kind, request = fetch) {
  let url;
  try { url = new URL(String(releaseUrl).trim()); }
  catch { throw new Error('Incolla il link di un asset GLB della Release free-roam-assets.'); }
  if (!url.href.startsWith(RELEASE_PREFIX) || url.search || url.hash || url.username || url.password) {
    throw new Error('Usa il link GLB della Release free-roam-assets di gattomorto24/fantascuola.');
  }
  const encodedName = url.href.slice(RELEASE_PREFIX.length);
  let fileName;
  try { fileName = decodeURIComponent(encodedName); }
  catch { throw new Error('Il nome del file GitHub non è valido.'); }
  if (!/^[A-Za-z0-9._-]+\.glb$/i.test(fileName)) {
    throw new Error('Il file della Release deve avere un nome semplice e terminare in .glb.');
  }
  const assetUrl = `${PAGES_PREFIX}${encodeURIComponent(fileName)}`;
  let release, response;
  try {
    const releaseResponse = await request(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!releaseResponse.ok) throw new Error('release');
    release = await releaseResponse.json();
  } catch { throw new Error('Release GitHub non disponibile. Controlla il link e riprova.'); }
  const asset = release.assets?.find((item) => item.name === fileName && item.state === 'uploaded');
  if (!asset) throw new Error('Questo GLB non è presente nella Release free-roam-assets.');
  const fileSize = Number(asset.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 20) throw new Error('Dimensione del file GitHub non verificabile.');
  const limit = kind === 'map' ? settings.assets.maxMapFileSize : settings.assets.maxAvatarFileSize;
  if (fileSize > limit) throw new Error(`Il GLB deve essere al massimo ${Math.round(limit / 1024 / 1024)} MB.`);
  try { response = await request(assetUrl, { method: 'HEAD', cache: 'no-store' }); }
  catch { throw new Error('Il file non è raggiungibile su GitHub Pages. Controlla la pubblicazione.'); }
  if (!response.ok) throw new Error('Il file non è ancora pubblicato su GitHub Pages. Attendi la workflow e riprova.');
  return { assetUrl, fileName, fileSize };
}
