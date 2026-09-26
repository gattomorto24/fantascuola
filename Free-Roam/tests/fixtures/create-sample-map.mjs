import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const output = process.argv[2];
if (!output) throw new Error('Specificare il percorso del GLB di test.');
const positions = new Float32Array([
  -16, 0, -16, 48, 0, -16, 48, 0, 48, -16, 0, 48,
  10, 0, 0, 10, 3, 0, 10, 3, 20, 10, 0, 20,
]);
const uv = new Float32Array([
  0, 0, 1, 0, 1, 1, 0, 1,
  0, 0, 0, 1, 1, 1, 1, 0,
]);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
const image = await sharp(Buffer.from([220, 60, 45, 255, 70, 155, 60, 255, 60, 90, 200, 255, 220, 200, 70, 255]),
  { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
const aligned = (n) => (n + 3) & ~3;
const segments = [Buffer.from(positions.buffer), Buffer.from(uv.buffer), Buffer.from(indices.buffer), image];
const offsets = [];
let length = 0;
for (const segment of segments) { offsets.push(length); length += aligned(segment.length); }
const bin = Buffer.alloc(length);
segments.forEach((segment, i) => segment.copy(bin, offsets[i]));
const doc = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: segments.map((segment, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: segment.length })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-16, 0, -16], max: [48, 3, 48] },
    { bufferView: 1, componentType: 5126, count: 8, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 12, type: 'SCALAR' },
  ],
  images: [{ bufferView: 3, mimeType: 'image/png' }], textures: [{ source: 0 }],
  materials: [{ name: 'Original textured surface', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }, doubleSided: true }],
};
const json = Buffer.from(JSON.stringify(doc));
const jsonPadded = Buffer.alloc(aligned(json.length), 0x20); json.copy(jsonPadded);
const glb = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(jsonPadded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonPadded.copy(glb, 20);
const at = 20 + jsonPadded.length;
glb.writeUInt32LE(bin.length, at); glb.writeUInt32LE(0x004e4942, at + 4); bin.copy(glb, at + 8);
await writeFile(output, glb);
