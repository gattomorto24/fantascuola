#!/usr/bin/env node
// Offline conversion of a textured GLB to independent, world-space mobile tiles.
import { open, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch { throw new Error('Installa le dipendenze in Free-Roam con npm install prima del preprocessing.'); }

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) {
  console.log('Uso: npm run build:mobile-map -- <mappa.glb> --source-url <URL resolve Hugging Face> [--output mobile-maps/<nome>.mobile] [--tile-size 16] [--texture-size 512] [--geometry-ratio 0.18] [--geometry-error 0.2] [--scale 1] [--rotation 0]');
  process.exit(argv.includes('--help') ? 0 : 1);
}
const input = resolve(argv[0]);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const sourceUrl = option('--source-url', '');
const tileSize = Number(option('--tile-size', 32));
const textureSize = Number(option('--texture-size', 512));
const scale = Number(option('--scale', 1));
const rotation = Number(option('--rotation', 0));
const geometryRatio = Number(option('--geometry-ratio', 0.18));
const geometryError = Number(option('--geometry-error', 0.2));
const output = resolve(option('--output', join(dirname(input), `${basename(input, '.glb')}.mobile`)));
if (!/^https:\/\/huggingface\.co\/buckets\/[^/]+\/[^/]+\/resolve\/.+\.glb$/i.test(sourceUrl)
  || !(tileSize >= 8 && tileSize <= 48) || !(textureSize >= 128 && textureSize <= 1024)
  || !(scale > 0 && scale <= 100) || !Number.isFinite(rotation)
  || !(geometryRatio > 0 && geometryRatio <= 1) || !(geometryError >= 0 && geometryError <= 5)) {
  throw new Error('Parametri non validi: servono source-url, tile-size 8-48, texture-size 128-1024, scale e rotation finiti.');
}

const CHUNK_VERTICES = 4096;
const VERTEX_FLOATS = 12; // POSITION 3, NORMAL 3, TEXCOORD_0 2, COLOR_0 4
const HEADER_BYTES = 20;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const align4 = (n) => (n + 3) & ~3;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function matrixMultiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    for (let k = 0; k < 4; k += 1) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function transformPoint(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function determinant3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9])
    + m[1] * (m[6] * m[8] - m[4] * m[10])
    + m[2] * (m[4] * m[9] - m[5] * m[8]);
}
function transformNormal(m, p) {
  const c0 = [m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8]];
  const c1 = [m[9] * m[2] - m[10] * m[1], m[10] * m[0] - m[8] * m[2], m[8] * m[1] - m[9] * m[0]];
  const c2 = [m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4]];
  const sign = Math.sign(determinant3(m)) || 1;
  const x = sign * (c0[0] * p[0] + c1[0] * p[1] + c2[0] * p[2]);
  const y = sign * (c0[1] * p[0] + c1[1] * p[1] + c2[1] * p[2]);
  const z = sign * (c0[2] * p[0] + c1[2] * p[1] + c2[2] * p[2]);
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
function clipPolygon(polygon, axis, boundary, keepGreater) {
  const inside = (v) => keepGreater ? v[axis] >= boundary : v[axis] <= boundary;
  const output = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ai = inside(a), bi = inside(b);
    if (ai) output.push(a);
    if (ai !== bi) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      output.push(a.map((value, j) => value + (b[j] - value) * t));
    }
  }
  return output;
}
export function clipTriangleToTile(triangle, cx, cz, size) {
  let poly = triangle;
  poly = clipPolygon(poly, 0, cx * size, true);
  if (poly.length < 3) return [];
  poly = clipPolygon(poly, 0, (cx + 1) * size, false);
  if (poly.length < 3) return [];
  poly = clipPolygon(poly, 2, cz * size, true);
  if (poly.length < 3) return [];
  poly = clipPolygon(poly, 2, (cz + 1) * size, false);
  const result = [];
  for (let i = 1; i < poly.length - 1; i += 1) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    const area = Math.hypot(
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    );
    if (area > 1e-8) result.push(a, b, c);
  }
  return result;
}

class TileWriter {
  constructor(x, z, tempDir) {
    this.x = x; this.z = z; this.tempDir = tempDir;
    this.groups = new Map();
  }
  group(material) {
    if (!this.groups.has(material)) this.groups.set(material, {
      file: join(this.tempDir, `${this.x}_${this.z}_${material}.bin`),
      buffer: Buffer.allocUnsafe(CHUNK_VERTICES * VERTEX_FLOATS * 4), count: 0, total: 0,
      min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    });
    return this.groups.get(material);
  }
  async write(material, vertices) {
    const group = this.group(material);
    for (const vertex of vertices) {
      const offset = group.count * VERTEX_FLOATS * 4;
      for (let i = 0; i < VERTEX_FLOATS; i += 1) group.buffer.writeFloatLE(vertex[i], offset + i * 4);
      for (let i = 0; i < 3; i += 1) {
        group.min[i] = Math.min(group.min[i], vertex[i]);
        group.max[i] = Math.max(group.max[i], vertex[i]);
      }
      group.count += 1;
      group.total += 1;
      if (group.count === CHUNK_VERTICES) await this.flush(group);
    }
  }
  async flush(group) {
    if (!group.count) return;
    await writeFile(group.file, group.buffer.subarray(0, group.count * VERTEX_FLOATS * 4), { flag: 'a' });
    group.count = 0;
  }
}

async function build() {
  await MeshoptSimplifier.ready;
  const source = await open(input, 'r');
  const tempDir = `${output}.tmp`;
  try {
    const head = Buffer.alloc(HEADER_BYTES);
    await source.read(head, 0, HEADER_BYTES, 0);
    if (head.readUInt32LE(0) !== GLB_MAGIC || head.readUInt32LE(4) !== 2 || head.readUInt32LE(16) !== JSON_CHUNK) throw new Error('Sorgente non GLB 2.0.');
    const jsonLength = head.readUInt32LE(12);
    const jsonBytes = Buffer.alloc(jsonLength);
    await source.read(jsonBytes, 0, jsonLength, HEADER_BYTES);
    const doc = JSON.parse(jsonBytes.toString('utf8'));
    const binHeader = Buffer.alloc(8);
    await source.read(binHeader, 0, 8, HEADER_BYTES + jsonLength);
    if (binHeader.readUInt32LE(4) !== BIN_CHUNK) throw new Error('GLB senza chunk binario.');
    const binStart = HEADER_BYTES + jsonLength + 8;
    const supportedExtensions = new Set(['KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_materials_unlit', 'EXT_texture_webp']);
    if (doc.extensionsRequired?.some((ext) => !supportedExtensions.has(ext))) throw new Error(`Estensione GLB richiesta non supportata: ${doc.extensionsRequired.join(', ')}`);
    if (doc.bufferViews?.some((view) => view.extensions)) throw new Error('BufferView compressa non supportata: esportare un GLB senza Meshopt.');
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
    const tileDir = join(output, 'tiles');
    await mkdir(tileDir, { recursive: true });
    const tiles = new Map();
    const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    async function viewBytes(index) {
      const view = doc.bufferViews[index];
      if (!view || Number(view.buffer || 0) !== 0) throw new Error('Sono supportati solo GLB con un buffer interno.');
      const bytes = Buffer.allocUnsafe(view.byteLength);
      await source.read(bytes, 0, bytes.length, binStart + (view.byteOffset || 0));
      return bytes;
    }
    async function accessor(index) {
      const a = doc.accessors[index];
      if (!a || a.sparse || a.bufferView === undefined || !componentBytes[a.componentType] || !componentCount[a.type]) throw new Error('Accessor GLB non supportato.');
      const bytes = await viewBytes(a.bufferView);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const components = componentCount[a.type];
      const stride = doc.bufferViews[a.bufferView].byteStride || components * componentBytes[a.componentType];
      const result = a.type === 'SCALAR' ? new Float64Array(a.count * components) : new Float32Array(a.count * components);
      for (let i = 0; i < a.count; i += 1) for (let j = 0; j < components; j += 1) {
        const at = (a.byteOffset || 0) + i * stride + j * componentBytes[a.componentType];
        let value;
        switch (a.componentType) {
          case 5120: value = view.getInt8(at); break;
          case 5121: value = view.getUint8(at); break;
          case 5122: value = view.getInt16(at, true); break;
          case 5123: value = view.getUint16(at, true); break;
          case 5125: value = view.getUint32(at, true); break;
          default: value = view.getFloat32(at, true);
        }
        if (a.normalized && a.componentType !== 5126) {
          const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[a.componentType];
          value = a.componentType === 5120 || a.componentType === 5122 ? Math.max(-1, value / max) : value / max;
        }
        result[i * components + j] = value;
      }
      return { data: result, components, count: a.count };
    }
    const images = new Map();
    async function baseTexture(materialIndex) {
      const sourceMaterial = doc.materials?.[materialIndex];
      const textureIndex = sourceMaterial?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (!Number.isInteger(textureIndex)) return null;
      const sourceTexture = doc.textures?.[textureIndex];
      const imageIndex = sourceTexture?.source ?? sourceTexture?.extensions?.EXT_texture_webp?.source;
      if (!Number.isInteger(imageIndex)) throw new Error('Texture baseColor non valida.');
      if (images.has(imageIndex)) return images.get(imageIndex);
      const image = doc.images[imageIndex];
      let bytes;
      if (Number.isInteger(image.bufferView)) bytes = await viewBytes(image.bufferView);
      else if (image.uri?.startsWith('data:')) bytes = Buffer.from(image.uri.split(',')[1], 'base64');
      else if (image.uri && !/^https?:/i.test(image.uri)) bytes = await readFile(resolve(dirname(input), image.uri));
      else throw new Error('Immagine esterna remota non supportata dal preprocessore.');
      const metadata = await sharp(bytes).metadata();
      const mimeType = metadata.hasAlpha ? 'image/png' : 'image/jpeg';
      const processed = await sharp(bytes)
        .resize(textureSize, textureSize, { fit: 'inside', withoutEnlargement: true })
        .toFormat(metadata.hasAlpha ? 'png' : 'jpeg', metadata.hasAlpha ? {} : { quality: 78, mozjpeg: true })
        .toBuffer();
      const value = { bytes: processed, mimeType };
      images.set(imageIndex, value);
      return value;
    }
    const sourceMaterials = doc.materials || [];
    const materialImages = new Map();
    for (let i = 0; i < sourceMaterials.length; i += 1) materialImages.set(i, await baseTexture(i));
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const rootMatrix = [c * scale, 0, -s * scale, 0, 0, scale, 0, 0, s * scale, 0, c * scale, 0, 0, 0, 0, 1];
    const scene = doc.scenes?.[doc.scene || 0];
    if (!scene) throw new Error('Scena GLB assente.');
    let triangleCount = 0;
    async function traverse(index, parent) {
      const node = doc.nodes[index];
      const matrix = matrixMultiply(parent, nodeMatrix(node));
      const flipWinding = determinant3(matrix) < 0;
      if (Number.isInteger(node.mesh)) {
        for (const primitive of doc.meshes[node.mesh].primitives || []) {
          if (primitive.extensions || (primitive.mode !== undefined && primitive.mode !== 4)) throw new Error('Primitive compresse o non triangolari non supportate.');
          const position = await accessor(primitive.attributes.POSITION);
          const normal = Number.isInteger(primitive.attributes.NORMAL) ? await accessor(primitive.attributes.NORMAL) : null;
          const material = Number.isInteger(primitive.material) ? primitive.material : -1;
          const textureInfo = sourceMaterials[material]?.pbrMetallicRoughness?.baseColorTexture;
          const uvTransform = textureInfo?.extensions?.KHR_texture_transform || null;
          const uvSet = uvTransform?.texCoord ?? textureInfo?.texCoord ?? 0;
          const uvIndex = primitive.attributes[`TEXCOORD_${uvSet}`];
          const uv = Number.isInteger(uvIndex) ? await accessor(uvIndex) : null;
          if (textureInfo && !uv) throw new Error(`Materiale ${material}: UV ${uvSet} assenti.`);
          const color = Number.isInteger(primitive.attributes.COLOR_0) ? await accessor(primitive.attributes.COLOR_0) : null;
          let indices = Number.isInteger(primitive.indices) ? (await accessor(primitive.indices)).data : null;
          const originalCount = indices?.length || position.count;
          if (geometryRatio < 1 && originalCount >= 300 && indices) {
            const attributes = new Float32Array(position.count * 5);
            for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
              const at = vertexIndex * 5;
              attributes[at] = uv ? uv.data[vertexIndex * uv.components] : 0;
              attributes[at + 1] = uv ? uv.data[vertexIndex * uv.components + 1] : 0;
              attributes[at + 2] = normal ? normal.data[vertexIndex * 3] : 0;
              attributes[at + 3] = normal ? normal.data[vertexIndex * 3 + 1] : 1;
              attributes[at + 4] = normal ? normal.data[vertexIndex * 3 + 2] : 0;
            }
            const target = Math.max(3, Math.floor(originalCount * geometryRatio / 3) * 3);
            const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
              Uint32Array.from(indices), position.data, 3, attributes, 5,
              [0.35, 0.35, 0.15, 0.15, 0.15], null,
              target, geometryError / scale, ['ErrorAbsolute', 'Prune'],
            );
            indices = simplified;
          }
          const count = indices?.length || position.count;
          if (count % 3 !== 0) throw new Error('Primitive con indici incompleti.');
          const vertex = (i) => {
            const p = transformPoint(matrix, position.data.subarray(i * 3, i * 3 + 3));
            const n = normal ? transformNormal(matrix, normal.data.subarray(i * 3, i * 3 + 3)) : [0, 1, 0];
            let t = uv ? [uv.data[i * uv.components], uv.data[i * uv.components + 1]] : [0, 0];
            if (uvTransform) {
              const [su, sv] = uvTransform.scale || [1, 1];
              const [ou, ov] = uvTransform.offset || [0, 0];
              const angle = uvTransform.rotation || 0;
              const u = t[0] * su, v = t[1] * sv;
              t = [ou + Math.cos(angle) * u - Math.sin(angle) * v, ov + Math.sin(angle) * u + Math.cos(angle) * v];
            }
            const col = color ? Array.from(color.data.subarray(i * color.components, i * color.components + color.components)) : [1, 1, 1, 1];
            if (col.length === 3) col.push(1);
            return [...p, ...n, ...t, ...col];
          };
          for (let i = 0; i < count; i += 3) {
            const tri = [vertex(indices ? indices[i] : i), vertex(indices ? indices[i + 1] : i + 1), vertex(indices ? indices[i + 2] : i + 2)];
            if (flipWinding) [tri[1], tri[2]] = [tri[2], tri[1]];
            if (!normal) {
              const a = tri[0], b = tri[1], c = tri[2];
              const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
              const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
              const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
              const length = Math.hypot(...face) || 1;
              for (const v of tri) for (let k = 0; k < 3; k += 1) v[k + 3] = face[k] / length;
            }
            const minX = Math.floor(Math.min(...tri.map((v) => v[0])) / tileSize);
            const maxX = Math.floor(Math.max(...tri.map((v) => v[0])) / tileSize);
            const minZ = Math.floor(Math.min(...tri.map((v) => v[2])) / tileSize);
            const maxZ = Math.floor(Math.max(...tri.map((v) => v[2])) / tileSize);
            for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
              const clipped = clipTriangleToTile(tri, x, z, tileSize);
              if (!clipped.length) continue;
              const key = `${x}:${z}`;
              if (!tiles.has(key)) tiles.set(key, new TileWriter(x, z, tempDir));
              await tiles.get(key).write(material, clipped);
            }
            triangleCount += 1;
          }
        }
      }
      for (const child of node.children || []) await traverse(child, matrix);
    }
    for (const node of scene.nodes || []) await traverse(node, rootMatrix);
    if (!tiles.size) throw new Error('La mappa non contiene triangoli visibili.');
    const manifestTiles = [];
    for (const tile of tiles.values()) {
      const chunks = [];
      const views = [], accessors = [], primitives = [], materials = [], textures = [], imageDefs = [];
      let cursor = 0;
      const append = (bytes) => {
        const offset = cursor;
        chunks.push(bytes);
        cursor += bytes.length;
        if (cursor % 4) { const padding = Buffer.alloc(4 - cursor % 4); chunks.push(padding); cursor += padding.length; }
        return offset;
      };
      for (const [sourceIndex, group] of tile.groups) {
        await tile.flush(group);
        const geometry = await readFile(group.file);
        const geometryOffset = append(geometry);
        const viewIndex = views.push({ buffer: 0, byteOffset: geometryOffset, byteLength: geometry.length, byteStride: VERTEX_FLOATS * 4, target: 34962 }) - 1;
        const attribute = (components, offset, type, min, max) => accessors.push({ bufferView: viewIndex, byteOffset: offset, componentType: 5126, count: group.total, type, ...(min ? { min, max } : {}) }) - 1;
        const attributes = {
          POSITION: attribute(3, 0, 'VEC3', group.min, group.max),
          NORMAL: attribute(3, 12, 'VEC3'),
          TEXCOORD_0: attribute(2, 24, 'VEC2'),
          COLOR_0: attribute(4, 32, 'VEC4'),
        };
        const sourceMaterial = sourceMaterials[sourceIndex] || {};
        const pbr = sourceMaterial.pbrMetallicRoughness || {};
        const material = {
          name: sourceMaterial.name || `Material ${sourceIndex}`,
          pbrMetallicRoughness: {
            baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
            metallicFactor: clamp(Number(pbr.metallicFactor || 0), 0, 0.3),
            roughnessFactor: clamp(Number(pbr.roughnessFactor ?? 0.85), 0.5, 1),
          },
          doubleSided: Boolean(sourceMaterial.doubleSided),
          alphaMode: sourceMaterial.alphaMode || 'OPAQUE',
        };
        if (sourceMaterial.extensions?.KHR_materials_unlit) material.extensions = { KHR_materials_unlit: {} };
        if (sourceMaterial.alphaCutoff !== undefined) material.alphaCutoff = sourceMaterial.alphaCutoff;
        const image = materialImages.get(sourceIndex);
        if (image) {
          const imageOffset = append(image.bytes);
          const imageView = views.push({ buffer: 0, byteOffset: imageOffset, byteLength: image.bytes.length }) - 1;
          const imageIndex = imageDefs.push({ bufferView: imageView, mimeType: image.mimeType }) - 1;
          const sourceTexture = doc.textures[sourceMaterial.pbrMetallicRoughness.baseColorTexture.index];
          const textureIndex = textures.push({ source: imageIndex, ...(sourceTexture.sampler !== undefined ? { sampler: sourceTexture.sampler } : {}) }) - 1;
          material.pbrMetallicRoughness.baseColorTexture = { index: textureIndex };
        }
        const materialIndex = materials.push(material) - 1;
        primitives.push({ attributes, material: materialIndex, mode: 4 });
        await rm(group.file, { force: true });
      }
      const bin = Buffer.concat(chunks, cursor);
      const tileDoc = { asset: { version: '2.0', generator: 'FantaScuola mobile map builder' }, scene: 0,
        scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
        buffers: [{ byteLength: bin.length }], bufferViews: views, accessors, materials,
        ...(imageDefs.length ? { images: imageDefs, textures, samplers: doc.samplers || [] } : {}),
        ...(materials.some((material) => material.extensions?.KHR_materials_unlit) ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
      };
      const json = Buffer.from(JSON.stringify(tileDoc));
      const jsonPadded = Buffer.alloc(align4(json.length), 0x20); json.copy(jsonPadded);
      const glb = Buffer.allocUnsafe(12 + 8 + jsonPadded.length + 8 + bin.length);
      glb.writeUInt32LE(GLB_MAGIC, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
      glb.writeUInt32LE(jsonPadded.length, 12); glb.writeUInt32LE(JSON_CHUNK, 16); jsonPadded.copy(glb, 20);
      const binHeaderAt = 20 + jsonPadded.length;
      glb.writeUInt32LE(bin.length, binHeaderAt); glb.writeUInt32LE(BIN_CHUNK, binHeaderAt + 4); bin.copy(glb, binHeaderAt + 8);
      const fingerprint = createHash('sha256').update(glb).digest('hex').slice(0, 12);
      const file = `tiles/${tile.x}_${tile.z}_${fingerprint}.glb`;
      await writeFile(join(output, file), glb);
      if (glb.length > 16 * 1024 * 1024) throw new Error(`Zona ${file}: ${(glb.length / 1048576).toFixed(1)} MB. Ripeti con --tile-size più piccolo.`);
      manifestTiles.push({ x: tile.x, z: tile.z, file, bytes: glb.length });
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(input)) hash.update(chunk);
    const manifest = {
      schema: 1, coordinateSpace: 'world', tileSize,
      source: { url: sourceUrl, sha256: hash.digest('hex'), scale, rotation },
      tiles: manifestTiles.sort((a, b) => a.x - b.x || a.z - b.z),
      generator: { textureSize, triangleCount },
    };
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const currentTiles = new Set(manifestTiles.map((tile) => basename(tile.file)));
    for (const name of await readdir(tileDir)) {
      if (/^-?\d+_-?\d+_[0-9a-f]{12}\.glb$/i.test(name) && !currentTiles.has(name)) {
        await rm(join(tileDir, name));
      }
    }
    console.log(`Creati ${manifestTiles.length} zone in ${output}. Pubblica la cartella con il sito Free Roam.`);
  } finally {
    await source.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build().catch((error) => { console.error(error); process.exitCode = 1; });
