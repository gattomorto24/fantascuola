export function mobileManifestUrl(sourceUrl, moduleUrl = import.meta.url) {
  const url = new URL(sourceUrl);
  if (!/\.glb$/i.test(url.pathname)) throw new Error('URL della mappa GLB non valido.');
  const stem = decodeURIComponent(url.pathname.split('/').pop()).replace(/\.glb$/i, '');
  if (!/^[\w.-]+$/.test(stem)) throw new Error('Nome della mappa GLB non valido.');
  return new URL(`../../mobile-maps/${stem}.mobile/manifest.json`, moduleUrl).href;
}

export function validateMobileManifest(data, sourceUrl, transform = {}) {
  if (!data || data.schema !== 1 || data.coordinateSpace !== 'world'
    || !Number.isFinite(data.tileSize) || data.tileSize < 8 || data.tileSize > 48
    || !Array.isArray(data.tiles) || !data.tiles.length
    || data.source?.url !== sourceUrl
    || !/^[0-9a-f]{64}$/i.test(data.source?.sha256 || '')
    || Number(data.source?.scale) !== Number(transform.scale || 1)
    || Number(data.source?.rotation) !== Number(transform.rotation || 0)) {
    throw new Error('Manifest mobile incompatibile con la mappa attiva.');
  }
  const seen = new Set();
  for (const tile of data.tiles) {
    if (!Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.z)
      || typeof tile.file !== 'string' || !/^tiles\/[a-zA-Z0-9_-]+\.glb$/.test(tile.file)
      || !Number.isSafeInteger(tile.bytes) || tile.bytes <= 0 || tile.bytes > 16 * 1024 * 1024
      || seen.has(`${tile.x}:${tile.z}`)) {
      throw new Error('Manifest mobile: zona non valida o duplicata.');
    }
    seen.add(`${tile.x}:${tile.z}`);
  }
  return data;
}
