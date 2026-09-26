import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { settings } from '../config/settings.js';

const loader = new GLTFLoader();
const CACHE_NAME = 'free-roam-glb-v1';

export async function validateGLBFile(file, kind) {
  const limit = kind === 'map' ? settings.assets.maxMapFileSize : settings.assets.maxAvatarFileSize;
  if (!(file instanceof File) || !/\.glb$/i.test(file.name)) throw new Error('Seleziona un file .glb valido.');
  if (file.size < 20 || file.size > limit) throw new Error(`Il GLB deve essere al massimo ${Math.round(limit / 1024 / 1024)} MB.`);
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) throw new Error('Il file non contiene un modello GLB valido.');
  return file;
}

function nextFrame() {
  return typeof requestAnimationFrame === 'function'
    ? new Promise((resolve) => requestAnimationFrame(resolve))
    : new Promise((resolve) => setTimeout(resolve, 0));
}

function loadWithThree(url, onProgress) {
  return loader.loadAsync(url, onProgress);
}

async function openCache() {
  if (!globalThis.caches?.open) return null;
  try { return await globalThis.caches.open(CACHE_NAME); } catch { return null; }
}

async function cachedResponse(url) {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {}
  return null;
}

async function fetchToCache(url, onProgress, onStage) {
  const existing = await cachedResponse(url);
  if (existing) {
    onStage('Mappa completa trovata nella cache locale…');
    return existing;
  }

  onStage('Download mappa completa su cache locale…');
  const response = await fetch(url, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Download GLB fallito: HTTP ${response.status}.`);

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader?.();
  if (!reader) return response;

  const chunks = [];
  let loaded = 0;
  let lastYield = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, lengthComputable: total > 0 });
    if (loaded - lastYield >= 8 * 1024 * 1024) {
      lastYield = loaded;
      onStage(`Salvataggio mappa · ${Math.round(loaded / 1024 / 1024)} MB…`);
      await nextFrame();
    }
  }

  const blob = new Blob(chunks, { type: 'model/gltf-binary' });
  chunks.length = 0;
  const stored = new Response(blob, {
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(blob.size),
    },
  });

  const cache = await openCache();
  if (cache) {
    try { await cache.put(url, stored.clone()); } catch (error) {
      console.warn('[Free Roam] Cache GLB non disponibile:', error);
    }
  }
  return stored;
}

async function loadFromCachedBlob(url, onProgress, onStage) {
  const response = await fetchToCache(url, onProgress, onStage);
  onStage('Apro la mappa completa dalla cache locale…');
  const blob = await response.blob();
  onProgress?.({ loaded: blob.size, total: blob.size, lengthComputable: true });
  await nextFrame();

  const objectUrl = URL.createObjectURL(blob);
  try {
    const gltf = await loadWithThree(objectUrl, onProgress);
    gltf.userData = {
      ...(gltf.userData || {}),
      fullQuality: true,
      strategy: 'cached-blob',
      downloadedBytes: blob.size,
    };
    return gltf;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadDirect(url, onProgress, onStage) {
  onStage('Caricamento diretto GLB completo…');
  const gltf = await loadWithThree(url, onProgress);
  gltf.userData = {
    ...(gltf.userData || {}),
    fullQuality: true,
    strategy: 'direct-three',
  };
  return gltf;
}

export async function loadGLB(source, onProgress, options = {}) {
  const onStage = options.onStage || (() => {});
  const temporary = source instanceof File;

  if (temporary) {
    const url = URL.createObjectURL(source);
    try {
      const gltf = await loadWithThree(url, onProgress);
      gltf.userData = { ...(gltf.userData || {}), fullQuality: true, strategy: 'local-file' };
      return gltf;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const baseHref = globalThis.location?.href || 'http://localhost/';
  const url = new URL(String(source), baseHref).href;
  const preferred = options.strategy || 'direct';

  if (preferred === 'cached') return loadFromCachedBlob(url, onProgress, onStage);
  return loadDirect(url, onProgress, onStage);
}

export async function clearGLBCache(url) {
  const cache = await openCache();
  if (!cache) return false;
  try { return await cache.delete(url); } catch { return false; }
}
