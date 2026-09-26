import * as THREE from 'three';
import { loadGLB } from '../assets/GLBLoader.js';
import { assetUrl } from '../config/paths.js';

const registry = new Map([['default', { id: 'default', name: 'Default / Placeholder', modelPath: null, thumbnail: null, animations: {} }]]);
export function registerAvatar(definition) {
  if (!definition?.id || !definition?.name || !definition?.modelPath) throw new Error('Definizione avatar incompleta');
  registry.set(definition.id, { thumbnail: null, animations: {}, ...definition });
}

function placeholder(remote) {
  const object = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.92, 4, 10), new THREE.MeshStandardMaterial({ color: remote ? 0xf3b96d : 0x67d8bd, roughness: 0.65 }));
  body.position.y = 0.9; object.add(body);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.055), new THREE.MeshStandardMaterial({ color: 0x173448 }));
  front.position.set(0, 1.16, -0.38); object.add(front);
  return object;
}
function pixelAvatar(remote) {
  const object = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.45), new THREE.MeshStandardMaterial({ color: remote ? 0xeab16b : 0x6ac8f4 }));
  body.position.y = 0.83; object.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshStandardMaterial({ color: 0xffdbaf }));
  head.position.y = 1.7; object.add(head);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.1, 0.035), new THREE.MeshStandardMaterial({ color: 0x263b53 }));
  face.position.set(0, 1.77, -0.33); object.add(face);
  return object;
}

export class AvatarManager {
  constructor(storage = null) { this.storage = storage; }
  setStorage(storage) { this.storage = storage; }
  async create(selection = 'default', remote = false, onProgress) {
    const reference = typeof selection === 'string' ? selection : selection?.type === 'local' ? 'local' : 'default';
    let source = null;
    let networkAvatarId = reference;
    try {
      if (reference === 'local') { source = selection.file; networkAvatarId = 'default'; }
      else if (reference.startsWith('published:')) {
        if (!this.storage) throw new Error('Storage avatar non disponibile.');
        const id = reference.slice('published:'.length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Riferimento avatar non valido.');
        const avatar = await this.storage.avatarById(id);
        source = await this.storage.signedUrl('free-roam-avatars', avatar.storage_path);
      } else if (registry.has(reference) && registry.get(reference).modelPath) {
        source = assetUrl(registry.get(reference).modelPath);
      }
      if (source) {
        const gltf = await loadGLB(source, onProgress);
        return { object: gltf.scene, mixer: gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null, clips: gltf.animations, avatarId: reference, networkAvatarId };
      }
      if (reference === 'pixel') return { object: pixelAvatar(remote), mixer: null, clips: [], avatarId: 'pixel', networkAvatarId: 'pixel' };
      if (reference !== 'default') throw new Error('Avatar sconosciuto.');
    } catch (error) {
      console.warn('[Free Roam] Avatar non caricato; uso placeholder:', error);
      return { object: placeholder(remote), mixer: null, clips: [], avatarId: 'default', networkAvatarId: 'default', warning: `Avatar non caricato: ${error.message || error}. Usato il placeholder.` };
    }
    return { object: placeholder(remote), mixer: null, clips: [], avatarId: 'default', networkAvatarId: 'default' };
  }
  disposeVisual(visual) {
    visual?.mixer?.stopAllAction();
    visual?.object?.traverse((node) => { node.geometry?.dispose(); if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose()); else node.material?.dispose(); });
  }
}
