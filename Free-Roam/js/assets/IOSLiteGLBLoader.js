import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MOBILE_GEOMETRY_BUDGET = 280 * 1024 * 1024;
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

async function fetchRange(url, start, end) {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Range: `bytes=${start}-${end}` },
  });

  if (response.status !== 206) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('Il server della mappa non supporta il caricamento parziale richiesto da iPhone.');
  }

  return new Uint8Array(await response.arrayBuffer());
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

function materialColorFromName(name = '') {
  const value = String(name).toLowerCase();

  if (/grass|erba|leaf|leaves|tree|veget|hedge|bush|palm/.test(value)) return [0.35, 0.58, 0.30, 1];
  if (/road|asphalt|street|strada|parking|pavement/.test(value)) return [0.30, 0.32, 0.34, 1];
  if (/roof|tile|tetto|terracotta/.test(value)) return [0.56, 0.30, 0.23, 1];
  if (/wood|trunk|bark|legno/.test(value)) return [0.37, 0.24, 0.15, 1];
  if (/glass|window|vetro/.test(value)) return [0.44, 0.58, 0.64, 0.72];
  if (/metal|fence|rail|gate|cancello/.test(value)) return [0.24, 0.27, 0.28, 1];
  if (/soil|earth|dirt|terra/.test(value)) return [0.38, 0.31, 0.20, 1];
  if (/wall|stucco|plaster|building|facade|muro/.test(value)) return [0.72, 0.68, 0.58, 1];

  return [0.68, 0.69, 0.66, 1];
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
    const baseColorFactor = hadBaseTexture && (!originalFactor || originalIsNeutral)
      ? materialColorFromName(sourceMaterial?.name || `material-${index}`)
      : (originalFactor || [0.68, 0.69, 0.66, 1]);

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
    };
  });

  const usedExtensions = new Set(doc.extensionsUsed || []);
  doc.extensionsUsed = [...usedExtensions].filter((name) => name === 'KHR_mesh_quantization');
  if (!doc.extensionsUsed.length) delete doc.extensionsUsed;

  const requiredExtensions = new Set(doc.extensionsRequired || []);
  doc.extensionsRequired = [...requiredExtensions].filter((name) => name === 'KHR_mesh_quantization');
  if (!doc.extensionsRequired.length) delete doc.extensionsRequired;

  return doc;
}

function collectUsedAccessors(doc) {
  const used = new Set();

  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      for (const accessor of Object.values(primitive.attributes || {})) {
        if (Number.isInteger(accessor)) used.add(accessor);
      }

      if (Number.isInteger(primitive.indices)) used.add(primitive.indices);

      for (const target of primitive.targets || []) {
        for (const accessor of Object.values(target || {})) {
          if (Number.isInteger(accessor)) used.add(accessor);
        }
      }
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
    mesh.primitives = (mesh.primitives || []).filter((primitive) => {
      const attributes = primitive.attributes || {};
      if (!Number.isInteger(attributes.POSITION) || !map.has(attributes.POSITION)) return false;

      primitive.attributes = Object.fromEntries(
        Object.entries(attributes)
          .filter(([, accessor]) => map.has(accessor))
          .map(([name, accessor]) => [name, map.get(accessor)]),
      );

      if (Number.isInteger(primitive.indices)) {
        if (map.has(primitive.indices)) primitive.indices = map.get(primitive.indices);
        else delete primitive.indices;
      }

      if (Array.isArray(primitive.targets)) {
        primitive.targets = primitive.targets
          .map((target) => Object.fromEntries(
            Object.entries(target || {})
              .filter(([, accessor]) => map.has(accessor))
              .map(([name, accessor]) => [name, map.get(accessor)]),
          ))
          .filter((target) => Object.keys(target).length);
        if (!primitive.targets.length) delete primitive.targets;
      }

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

  if (!usedViews.size) throw new Error('La mappa non contiene geometria caricabile in modalità iPhone.');

  if (totalGeometryBytes > MOBILE_GEOMETRY_BUDGET) {
    throw new Error(
      `La sola geometria pesa ${Math.round(totalGeometryBytes / 1024 / 1024)} MB: serve una versione mobile della mappa più leggera.`,
    );
  }

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

  const headerBytes = await fetchRange(url, 0, 19);
  const { totalLength, jsonLength } = parseHeader(headerBytes);

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength - 1;
  const jsonBytes = await fetchRange(url, jsonStart, jsonEnd);
  const jsonText = decoder.decode(jsonBytes).replace(/[\u0000\u0020]+$/g, '');
  const sourceDoc = JSON.parse(jsonText);

  const binHeaderStart = jsonEnd + 1;
  const binHeader = await fetchRange(url, binHeaderStart, binHeaderStart + 7);
  const binHeaderView = new DataView(binHeader.buffer, binHeader.byteOffset, binHeader.byteLength);
  const sourceBinLength = binHeaderView.getUint32(0, true);
  const sourceBinType = binHeaderView.getUint32(4, true);

  if (sourceBinType !== BIN_CHUNK) throw new Error('Chunk binario GLB non trovato.');

  const binStart = binHeaderStart + 8;
  const { doc, usedViews, totalGeometryBytes } = prepareIOSLiteDocument(sourceDoc);
  const { assignments, binLength } = remapBufferViews(doc, usedViews);

  onStage(
    `iPhone · geometria ${Math.round(totalGeometryBytes / 1024 / 1024)} MB, texture escluse…`,
  );

  const groups = mergeRanges(assignments, binStart);
  const totalDownload = groups.reduce((sum, group) => sum + (group.end - group.start + 1), 0);
  const compact = createGLBContainer(doc, binLength);
  let loaded = 0;

  for (const group of groups) {
    for (let chunkStart = group.start; chunkStart <= group.end; chunkStart += RANGE_CHUNK_BYTES) {
      const chunkEnd = Math.min(group.end, chunkStart + RANGE_CHUNK_BYTES - 1);
      const rangeBytes = await fetchRange(url, chunkStart, chunkEnd);

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

      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  onStage('iPhone · parsing geometria…');
  const gltf = await parseGLB(compact.buffer);

  gltf.userData = {
    ...(gltf.userData || {}),
    mobileLite: true,
    originalBytes: totalLength,
    downloadedBytes: totalDownload,
    textureless: true,
  };

  return gltf;
}
