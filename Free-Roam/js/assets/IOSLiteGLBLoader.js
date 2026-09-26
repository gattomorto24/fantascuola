import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const RANGE_CHUNK_BYTES = 8 * 1024 * 1024;

const loader = new GLTFLoader();
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function align4(value) {
  return (value + 3) & ~3;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isIOSLike() {
  const ua = String(globalThis.navigator?.userAgent || '');
  const platform = String(globalThis.navigator?.platform || '');
  const touchPoints = Number(globalThis.navigator?.maxTouchPoints || 0);

  return /iPad|iPhone|iPod/i.test(ua)
    || (platform === 'MacIntel' && touchPoints > 1);
}

const fullFileCache = new Map();
const OPFS_CACHE_DIR = 'free-roam-map-cache';
const OPFS_YIELD_BYTES = 16 * 1024 * 1024;
const OPFS_HEADROOM_BYTES = 96 * 1024 * 1024;

function cacheFileName(url) {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `map-${(hash >>> 0).toString(16)}.glb`;
}

async function nextFrame() {
  if (typeof requestAnimationFrame === 'function') {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function readCachedRange(source, start, end) {
  const safeEnd = Math.min(end + 1, source.size);

  if (source.kind === 'memory') {
    return source.bytes.subarray(start, safeEnd);
  }

  const slice = source.file.slice(start, safeEnd);
  return new Uint8Array(await slice.arrayBuffer());
}

async function streamResponseToOPFS(url, response, onProgress = () => {}) {
  if (!globalThis.navigator?.storage?.getDirectory || !response.body?.getReader) {
    return null;
  }

  const total = Number(response.headers.get('content-length')) || 0;

  try {
    const estimate = await globalThis.navigator.storage.estimate?.();
    const quota = Number(estimate?.quota || 0);
    const usage = Number(estimate?.usage || 0);
    if (total > 0 && quota > 0 && quota - usage < total + OPFS_HEADROOM_BYTES) {
      throw new Error(
        `Spazio locale insufficiente: servono circa ${Math.ceil((total + OPFS_HEADROOM_BYTES) / 1024 / 1024)} MB liberi per preparare la mappa.`,
      );
    }
  } catch (error) {
    if (error?.message?.startsWith('Spazio locale insufficiente')) throw error;
    console.warn('[Free Roam] Stima spazio OPFS non disponibile:', error);
  }

  try {
    await globalThis.navigator.storage.persist?.();
  } catch {}

  const root = await globalThis.navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(OPFS_CACHE_DIR, { create: true });
  const name = cacheFileName(url);
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const reader = response.body.getReader();

  let loaded = 0;
  let yieldedAt = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      await writable.write(value);
      loaded += value.byteLength;

      onProgress({
        lengthComputable: total > 0,
        loaded,
        total,
        fullDownloadFallback: true,
        diskBacked: true,
      });

      if (loaded - yieldedAt >= OPFS_YIELD_BYTES) {
        yieldedAt = loaded;
        await nextFrame();
      }
    }

    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    try { await directory.removeEntry(name); } catch {}
    throw error;
  }

  const file = await handle.getFile();
  return {
    kind: 'opfs',
    directory,
    name,
    file,
    size: file.size,
  };
}

async function consumeFullResponse(url, response, onProgress = () => {}) {
  const existing = fullFileCache.get(url);
  if (existing) {
    try { await response.body?.cancel(); } catch {}
    return existing;
  }

  const promise = (async () => {
    const total = Number(response.headers.get('content-length')) || 0;
    const diskSource = await streamResponseToOPFS(url, response, onProgress);
    if (diskSource) return diskSource;

    // Fallback soltanto per browser vecchi/privi di OPFS. Sui moderni iPhone
    // il percorso normale è sempre disk-backed, così l'intero GLB non vive in RAM.
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress({
      lengthComputable: true,
      loaded: bytes.byteLength,
      total: total || bytes.byteLength,
      fullDownloadFallback: true,
      diskBacked: false,
    });
    return { kind: 'memory', bytes, size: bytes.byteLength };
  })();

  fullFileCache.set(url, promise);

  try {
    return await promise;
  } catch (error) {
    fullFileCache.delete(url);
    throw error;
  }
}

async function releaseFullFile(url) {
  const cached = fullFileCache.get(url);
  fullFileCache.delete(url);
  if (!cached) return;

  try {
    const source = await cached;
    if (source?.kind === 'opfs') {
      await source.directory.removeEntry(source.name);
    }
  } catch {}
}

async function fetchRange(url, start, end, options = {}) {
  const cached = fullFileCache.get(url);
  if (cached) {
    return readCachedRange(await cached, start, end);
  }

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Range: `bytes=${start}-${end}` },
  });

  if (response.status === 206) {
    const contentRange = String(response.headers.get('content-range') || '');
    const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    const expectedLength = end - start + 1;
    const contentLength = Number(response.headers.get('content-length')) || 0;
    const looksLikeRealRange = match
      ? Number(match[1]) === start && Number(match[2]) <= end
      : (contentLength > 0 && contentLength <= expectedLength);

    if (looksLikeRealRange) {
      return new Uint8Array(await response.arrayBuffer());
    }

    options.onRangeUnsupportedStart?.();
    const source = await consumeFullResponse(url, response, options.onFullProgress);
    options.onRangeUnsupported?.(source.size);
    return readCachedRange(source, start, end);
  }

  if (response.ok && response.status === 200) {
    options.onRangeUnsupportedStart?.();
    const source = await consumeFullResponse(url, response, options.onFullProgress);
    options.onRangeUnsupported?.(source.size);
    return readCachedRange(source, start, end);
  }

  try { await response.body?.cancel(); } catch {}
  throw new Error(`Download parziale mappa fallito (HTTP ${response.status || 'errore'}).`);
}

function parseHeader(bytes) {
  if (bytes.byteLength < 20) throw new Error('Header GLB incompleto.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);

  if (magic !== GLB_MAGIC || version !== 2 || jsonType !== JSON_CHUNK) {
    throw new Error('Formato GLB non supportato.');
  }

  return { totalLength, jsonLength };
}

function materialColorFromName(name = '', index = 0) {
  const value = String(name).toLowerCase();

  if (/grass|erba|leaf|leaves|tree|veget|hedge|bush|palm/.test(value)) return [0.24, 0.48, 0.20, 1];
  if (/road|asphalt|street|strada|parking|pavement/.test(value)) return [0.23, 0.25, 0.27, 1];
  if (/roof|tile|tetto|terracotta/.test(value)) return [0.58, 0.25, 0.16, 1];
  if (/wood|trunk|bark|legno/.test(value)) return [0.31, 0.18, 0.10, 1];
  if (/glass|window|vetro/.test(value)) return [0.25, 0.45, 0.58, 1];
  if (/metal|fence|rail|gate|cancello/.test(value)) return [0.18, 0.20, 0.21, 1];
  if (/soil|earth|dirt|terra/.test(value)) return [0.39, 0.28, 0.15, 1];
  if (/wall|stucco|plaster|building|facade|muro/.test(value)) return [0.72, 0.64, 0.48, 1];

  // Molti export fotogrammetrici usano nomi generici (Material.001, ecc.).
  // Senza texture diventavano tutti quasi bianchi. Una palette deterministica
  // conserva invece contrasto e leggibilità senza aggiungere memoria texture.
  const palette = [
    [0.56, 0.50, 0.40, 1], [0.42, 0.47, 0.40, 1], [0.50, 0.42, 0.34, 1],
    [0.36, 0.40, 0.42, 1], [0.62, 0.55, 0.43, 1], [0.40, 0.46, 0.50, 1],
    [0.46, 0.38, 0.31, 1], [0.48, 0.51, 0.38, 1],
  ];
  return palette[index % palette.length];
}

function stripHeavyVisuals(source) {
  const doc = deepClone(source);

  delete doc.images;
  delete doc.textures;
  delete doc.samplers;
  delete doc.animations;
  delete doc.skins;
  delete doc.cameras;

  if (Array.isArray(doc.nodes)) {
    for (const node of doc.nodes) {
      delete node.skin;
      delete node.camera;
      delete node.weights;
      delete node.extensions;
    }
  }

  if (Array.isArray(doc.meshes)) {
    for (const mesh of doc.meshes) {
      for (const primitive of mesh.primitives || []) {
        delete primitive.extensions;
      }
    }
  }

  doc.materials = (doc.materials || []).map((sourceMaterial, index) => {
    const pbr = sourceMaterial?.pbrMetallicRoughness || {};
    const originalFactor = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : null;
    const hadBaseTexture = Boolean(pbr.baseColorTexture);
    const originalIsNeutral = originalFactor
      && originalFactor.length >= 3
      && originalFactor.slice(0, 3).every((value) => Number(value) >= 0.94);
    // Se la texture era solo il colore visivo, manteniamo bianco come moltiplicatore:
    // quando esiste COLOR_0, GLTFLoader applicherà il colore reale dei vertici.
    // Se COLOR_0 non esiste, sotto resta una tinta di fallback leggibile.
    const baseColorFactor = originalFactor || (
      hadBaseTexture
        ? [1, 1, 1, 1]
        : materialColorFromName(sourceMaterial?.name || `material-${index}`, index)
    );

    return {
      name: sourceMaterial?.name || `Materiale mobile ${index + 1}`,
      pbrMetallicRoughness: {
        baseColorFactor,
        metallicFactor: Math.min(Number(pbr.metallicFactor ?? 0), 0.15),
        roughnessFactor: Math.max(Number(pbr.roughnessFactor ?? 0.85), 0.72),
      },
      doubleSided: Boolean(sourceMaterial?.doubleSided),
      alphaMode: sourceMaterial?.alphaMode || 'OPAQUE',
      ...(sourceMaterial?.alphaCutoff !== undefined ? { alphaCutoff: sourceMaterial.alphaCutoff } : {}),
      ...(Array.isArray(sourceMaterial?.emissiveFactor) ? { emissiveFactor: sourceMaterial.emissiveFactor } : {}),
      extensions: { KHR_materials_unlit: {} },
    };
  });

  const usedExtensions = new Set(doc.extensionsUsed || []);
  doc.extensionsUsed = [
    ...[...usedExtensions].filter((name) => name === 'KHR_mesh_quantization'),
    'KHR_materials_unlit',
  ];

  const requiredExtensions = new Set(doc.extensionsRequired || []);
  doc.extensionsRequired = [...requiredExtensions].filter((name) => name === 'KHR_mesh_quantization');
  if (!doc.extensionsRequired.length) delete doc.extensionsRequired;

  return doc;
}

// Manteniamo gli attributi che descrivono i colori REALI senza caricare texture.
 // COLOR_0 è spesso il colore bakeato/fotogrammetrico per vertice: costa molto meno
 // delle immagini originali e permette all'iPhone di mostrare i colori della mappa
 // invece di una palette inventata. NORMAL resta escluso: il percorso mobile usa
 // materiali unlit, quindi non serve per l'illuminazione.
const MOBILE_VERTEX_ATTRIBUTES = new Set(['POSITION', 'COLOR_0']);

function collectUsedAccessors(doc) {
  const used = new Set();

  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      for (const [name, accessor] of Object.entries(primitive.attributes || {})) {
        if (MOBILE_VERTEX_ATTRIBUTES.has(name) && Number.isInteger(accessor)) used.add(accessor);
      }

      if (Number.isInteger(primitive.indices)) used.add(primitive.indices);
    }
  }

  return used;
}

function remapAccessors(doc) {
  const source = doc.accessors || [];
  const used = [...collectUsedAccessors(doc)].sort((a, b) => a - b);
  const map = new Map(used.map((oldIndex, newIndex) => [oldIndex, newIndex]));

  doc.accessors = used.map((index) => deepClone(source[index]));

  for (const mesh of doc.meshes || []) {
    delete mesh.weights;
    mesh.primitives = (mesh.primitives || []).filter((primitive) => {
      const attributes = primitive.attributes || {};
      if (!Number.isInteger(attributes.POSITION) || !map.has(attributes.POSITION)) return false;

      primitive.attributes = Object.fromEntries(
        Object.entries(attributes)
          .filter(([name, accessor]) => MOBILE_VERTEX_ATTRIBUTES.has(name) && map.has(accessor))
          .map(([name, accessor]) => [name, map.get(accessor)]),
      );

      if (Number.isInteger(primitive.indices)) {
        if (map.has(primitive.indices)) primitive.indices = map.get(primitive.indices);
        else delete primitive.indices;
      }

      delete primitive.targets;
      return true;
    });
  }

  return doc;
}

function collectBufferViews(doc) {
  const used = new Set();

  for (const accessor of doc.accessors || []) {
    if (Number.isInteger(accessor.bufferView)) used.add(accessor.bufferView);

    if (accessor.sparse) {
      if (Number.isInteger(accessor.sparse.indices?.bufferView)) used.add(accessor.sparse.indices.bufferView);
      if (Number.isInteger(accessor.sparse.values?.bufferView)) used.add(accessor.sparse.values.bufferView);
    }
  }

  return used;
}

function geometryBytes(doc, usedViews) {
  const views = doc.bufferViews || [];
  let total = 0;

  for (const index of usedViews) {
    const length = Number(views[index]?.byteLength || 0);
    if (Number.isFinite(length) && length > 0) total += align4(length);
  }

  return total;
}

export function prepareIOSLiteDocument(source) {
  const doc = remapAccessors(stripHeavyVisuals(source));
  const usedViews = collectBufferViews(doc);
  const totalGeometryBytes = geometryBytes(doc, usedViews);

  // Le primitive senza COLOR_0 non hanno un colore bakeato recuperabile senza
  // decodificare la texture originale. Diamo solo a quelle un fallback semantico;
  // quelle con COLOR_0 mantengono invece i colori autentici del GLB.
  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (Number.isInteger(primitive.attributes?.COLOR_0)) continue;
      const materialIndex = Number(primitive.material);
      const material = doc.materials?.[materialIndex];
      if (!material) continue;
      const pbr = material.pbrMetallicRoughness || (material.pbrMetallicRoughness = {});
      const factor = pbr.baseColorFactor;
      const neutral = !Array.isArray(factor) || factor.slice(0, 3).every((v) => Number(v) >= 0.94);
      if (neutral) pbr.baseColorFactor = materialColorFromName(material.name || `material-${materialIndex}`, materialIndex);
    }
  }

  if (!usedViews.size) throw new Error('La mappa non contiene geometria caricabile in modalità iPhone.');

  // Non rifiutiamo la mappa in base alla sola dimensione della geometria:
  // Free Roam deve mantenere lo stesso spazio/collisioni su desktop e mobile.
  // Su iOS alleggeriamo soltanto la rappresentazione visiva (texture/materiali),
  // preservando mesh, trasformazioni e coordinate della mappa originale.
  return { doc, usedViews, totalGeometryBytes };
}

function remapBufferViews(doc, usedViews) {
  const source = doc.bufferViews || [];
  const ordered = [...usedViews].sort((a, b) => {
    const ao = Number(source[a]?.byteOffset || 0);
    const bo = Number(source[b]?.byteOffset || 0);
    return ao - bo;
  });

  const map = new Map();
  const assignments = [];
  let cursor = 0;

  for (const oldIndex of ordered) {
    const view = source[oldIndex];
    if (!view || Number(view.buffer || 0) !== 0) {
      throw new Error('La modalità iPhone supporta solo GLB con un unico buffer interno.');
    }

    cursor = align4(cursor);
    const newIndex = assignments.length;
    map.set(oldIndex, newIndex);

    assignments.push({
      oldIndex,
      oldOffset: Number(view.byteOffset || 0),
      byteLength: Number(view.byteLength || 0),
      newOffset: cursor,
      definition: {
        ...deepClone(view),
        buffer: 0,
        byteOffset: cursor,
      },
    });

    cursor += Number(view.byteLength || 0);
  }

  for (const accessor of doc.accessors || []) {
    if (Number.isInteger(accessor.bufferView)) accessor.bufferView = map.get(accessor.bufferView);

    if (accessor.sparse) {
      if (Number.isInteger(accessor.sparse.indices?.bufferView)) {
        accessor.sparse.indices.bufferView = map.get(accessor.sparse.indices.bufferView);
      }
      if (Number.isInteger(accessor.sparse.values?.bufferView)) {
        accessor.sparse.values.bufferView = map.get(accessor.sparse.values.bufferView);
      }
    }
  }

  doc.bufferViews = assignments.map((item) => item.definition);
  doc.buffers = [{ byteLength: align4(cursor) }];

  return { assignments, binLength: align4(cursor) };
}

function mergeRanges(assignments, binStart, maxGap = 2048) {
  const sorted = assignments
    .map((item) => ({
      item,
      start: binStart + item.oldOffset,
      end: binStart + item.oldOffset + item.byteLength - 1,
    }))
    .sort((a, b) => a.start - b.start);

  const groups = [];

  for (const entry of sorted) {
    const last = groups.at(-1);

    if (!last || entry.start > last.end + maxGap + 1) {
      groups.push({ start: entry.start, end: entry.end, entries: [entry] });
    } else {
      last.end = Math.max(last.end, entry.end);
      last.entries.push(entry);
    }
  }

  return groups;
}

function createGLBContainer(doc, requestedBinLength) {
  const jsonRaw = encoder.encode(JSON.stringify(doc));
  const jsonLength = align4(jsonRaw.byteLength);
  const binLength = align4(requestedBinLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;

  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(jsonRaw, 20);
  bytes.fill(0x20, 20 + jsonRaw.byteLength, 20 + jsonLength);

  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);

  return {
    buffer: bytes.buffer,
    bytes,
    binDataStart: binHeader + 8,
  };
}

function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });
}

export async function loadIOSLiteGLB(url, onProgress = () => {}, onStage = () => {}) {
  onStage('iPhone · analisi mappa leggera…');

  let rangeFallback = false;
  let fullDownloadBytes = 0;
  const rangeOptions = {
    onFullProgress: onProgress,
    onRangeUnsupportedStart: () => {
      rangeFallback = true;
      onStage('iPhone · server senza Range: salvo la mappa sul dispositivo senza riempire la RAM…');
    },
    onRangeUnsupported: (size) => {
      rangeFallback = true;
      fullDownloadBytes = size;
      onStage('iPhone · mappa sorgente salvata, estraggo solo la geometria necessaria…');
    },
  };

  const headerBytes = await fetchRange(url, 0, 19, rangeOptions);
  const { totalLength, jsonLength } = parseHeader(headerBytes);

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength - 1;
  const jsonBytes = await fetchRange(url, jsonStart, jsonEnd, rangeOptions);
  const jsonText = decoder.decode(jsonBytes).replace(/[\u0000\u0020]+$/g, '');
  const sourceDoc = JSON.parse(jsonText);

  const binHeaderStart = jsonEnd + 1;
  const binHeader = await fetchRange(url, binHeaderStart, binHeaderStart + 7, rangeOptions);
  const binHeaderView = new DataView(binHeader.buffer, binHeader.byteOffset, binHeader.byteLength);
  const sourceBinLength = binHeaderView.getUint32(0, true);
  const sourceBinType = binHeaderView.getUint32(4, true);

  if (sourceBinType !== BIN_CHUNK) throw new Error('Chunk binario GLB non trovato.');

  const binStart = binHeaderStart + 8;
  const { doc, usedViews, totalGeometryBytes } = prepareIOSLiteDocument(sourceDoc);
  const { assignments, binLength } = remapBufferViews(doc, usedViews);

  onStage(
    `iPhone · geometria + colori vertex ${Math.round(totalGeometryBytes / 1024 / 1024)} MB, texture pesanti escluse…`,
  );

  const groups = mergeRanges(assignments, binStart);
  const totalDownload = groups.reduce((sum, group) => sum + (group.end - group.start + 1), 0);
  onStage('iPhone · preparo la mappa completa senza texture pesanti…');
  await new Promise((resolve) => requestAnimationFrame(resolve));

  let compact;
  try {
    compact = createGLBContainer(doc, binLength);
  } catch (error) {
    throw new Error(`Memoria insufficiente durante la preparazione della mappa iPhone: ${error.message || error}`);
  }
  let loaded = 0;

  for (const group of groups) {
    for (let chunkStart = group.start; chunkStart <= group.end; chunkStart += RANGE_CHUNK_BYTES) {
      const chunkEnd = Math.min(group.end, chunkStart + RANGE_CHUNK_BYTES - 1);
      const rangeBytes = await fetchRange(url, chunkStart, chunkEnd, rangeOptions);

      for (const { item, start, end } of group.entries) {
        const overlapStart = Math.max(chunkStart, start);
        const overlapEnd = Math.min(chunkEnd, end);
        if (overlapStart > overlapEnd) continue;

        const sourceOffset = overlapStart - chunkStart;
        const copyLength = overlapEnd - overlapStart + 1;
        const destinationOffset = compact.binDataStart
          + item.newOffset
          + (overlapStart - start);

        compact.bytes.set(
          rangeBytes.subarray(sourceOffset, sourceOffset + copyLength),
          destinationOffset,
        );
      }

      loaded += rangeBytes.byteLength;
      onProgress({
        lengthComputable: true,
        loaded,
        total: totalDownload,
        originalTotal: totalLength,
        sourceBinLength,
        mobileLite: true,
      });

      // Cedi periodicamente il main thread a Safari: evita che una mappa molto
      // grande faccia sembrare la pagina bloccata durante copia/preparazione.
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  onStage('iPhone · parsing geometria…');
  const gltf = await parseGLB(compact.buffer);

  gltf.userData = {
    ...(gltf.userData || {}),
    mobileLite: true,
    originalBytes: totalLength,
    downloadedBytes: rangeFallback ? (fullDownloadBytes || totalLength) : totalDownload,
    rangeFallback,
    textureless: true,
    vertexColorsPreserved: true,
  };

  // Non trattenere in RAM l'intero GLB dopo il parsing: su iPhone la memoria
  // è più importante del vantaggio di una cache che qui non verrà riutilizzata.
  await releaseFullFile(url);
  return gltf;
}
