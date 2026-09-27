export const GRAPHICS_QUALITY = Object.freeze({
  low: { label: 'Bassa', pixelRatio: 1, anisotropy: 1 },
  medium: { label: 'Media', pixelRatio: 1.25, anisotropy: 2 },
  high: { label: 'Alta', pixelRatio: 1.5, anisotropy: 4 },
  ultra: { label: 'Ultra', pixelRatio: 2, anisotropy: 8 },
});

export const VIEW_DISTANCE = Object.freeze({
  near: { label: 'Vicina', mobile: 42, desktop: 95, tiles: 1 },
  normal: { label: 'Normale', mobile: 58, desktop: 150, tiles: 1 },
  far: { label: 'Lontana', mobile: 78, desktop: 210, tiles: 2 },
  ultra: { label: 'Massima', mobile: 100, desktop: 260, tiles: 2 },
});

const STORAGE_KEY = 'free-roam-graphics-v1';

export function normalizeGraphicsSettings(value) {
  return {
    quality: Object.prototype.hasOwnProperty.call(GRAPHICS_QUALITY, value?.quality) ? value.quality : 'low',
    distance: Object.prototype.hasOwnProperty.call(VIEW_DISTANCE, value?.distance) ? value.distance : 'normal',
  };
}

export function loadGraphicsSettings(storage = null) {
  try { return normalizeGraphicsSettings(JSON.parse((storage || globalThis.localStorage)?.getItem(STORAGE_KEY) || 'null')); }
  catch { return normalizeGraphicsSettings(null); }
}

export function saveGraphicsSettings(value, storage = null) {
  const normalized = normalizeGraphicsSettings(value);
  try { (storage || globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(normalized)); }
  catch { /* Private browsing can deny storage. */ }
  return normalized;
}
