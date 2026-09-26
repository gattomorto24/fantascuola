import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { settings } from '../config/settings.js';

const loader = new GLTFLoader();

export async function validateGLBFile(file, kind) {
  const limit = kind === 'map' ? settings.assets.maxMapFileSize : settings.assets.maxAvatarFileSize;
  if (!(file instanceof File) || !/\.glb$/i.test(file.name)) throw new Error('Seleziona un file .glb valido.');
  if (file.size < 20 || file.size > limit) throw new Error(`Il GLB deve essere al massimo ${Math.round(limit / 1024 / 1024)} MB.`);
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) throw new Error('Il file non contiene un modello GLB valido.');
  return file;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function fetchFullGLB(url, onProgress, onStage = () => {}) {
  onStage('Download mappa completa · texture originali…');
  const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
  if (!response.ok) throw new Error(`Download GLB fallito: HTTP ${response.status}.`);

  const headerTotal = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader?.();

  // Se lo streaming non è disponibile, manteniamo comunque il percorso full-quality.
  if (!reader) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total: headerTotal || buffer.byteLength });
    return buffer;
  }

  const chunks = [];
  let loaded = 0;
  let lastYield = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;

    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total: headerTotal });

    // Il download resta identico; cediamo solo il main thread per mantenere
    // browser/UI reattivi mentre arrivano centinaia di MB.
    if (performance.now() - lastYield > 40) {
      onStage(`Download texture e geometria · ${Math.round(loaded / 1024 / 1024)} MB…`);
      await nextFrame();
      lastYield = performance.now();
    }
  }

  onStage('Assemblaggio GLB completo…');
  await nextFrame();

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    bytes.set(chunks[i], offset);
    offset += chunks[i].byteLength;
    // Evita un unico task lunghissimo durante la copia finale.
    if (i % 16 === 15) await nextFrame();
  }

  chunks.length = 0;
  return bytes.buffer;
}

async function parseFullGLB(buffer, resourcePath, onStage = () => {}) {
  onStage('Decodifica texture e materiali originali…');
  await nextFrame();

  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      resourcePath,
      (gltf) => resolve(gltf),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

export async function loadGLB(source, onProgress, options = {}) {
  const onStage = options.onStage || (() => {});
  const temporary = source instanceof File;

  if (temporary) {
    const url = URL.createObjectURL(source);
    try {
      // File locali: GLTFLoader conserva nativamente tutto il contenuto.
      return await loader.loadAsync(url, onProgress);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const baseHref = globalThis.location?.href || 'http://localhost/';
  const url = new URL(String(source), baseHref);
  const buffer = await fetchFullGLB(url.href, onProgress, onStage);

  // Per un GLB tutte le immagini embedded vengono risolte dal buffer. resourcePath
  // resta corretto anche nel caso di URI esterni presenti nel documento.
  const resourcePath = new URL('./', url).href;
  const gltf = await parseFullGLB(buffer, resourcePath, onStage);
  gltf.userData = {
    ...(gltf.userData || {}),
    fullQuality: true,
    downloadedBytes: buffer.byteLength,
  };
  return gltf;
}
