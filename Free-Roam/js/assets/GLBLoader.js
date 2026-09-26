import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { settings } from '../config/settings.js';

const loader = new GLTFLoader();
export async function validateGLBFile(file, kind) {
  const limit = kind === 'map' ? settings.assets.maxMapFileSize : settings.assets.maxAvatarFileSize;
  if (!(file instanceof File) || !/\.glb$/i.test(file.name)) throw new Error('Seleziona un file .glb valido.');
  if (file.size < 20 || file.size > limit) throw new Error(`Il GLB deve essere inferiore a ${Math.round(limit / 1024 / 1024)} MB.`);
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) throw new Error('Il file non contiene un modello GLB valido.');
  return file;
}
export async function loadGLB(source, onProgress) {
  let url = source;
  const temporary = source instanceof File;
  if (temporary) url = URL.createObjectURL(source);
  try { return await loader.loadAsync(url, onProgress); }
  finally { if (temporary) URL.revokeObjectURL(url); }
}
