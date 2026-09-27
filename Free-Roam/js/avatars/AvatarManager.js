import * as THREE from 'three';
import { loadGLB } from '../assets/GLBLoader.js';
import { assetUrl } from '../config/paths.js';
import { createPixelAvatar } from './PixelAvatarRenderer.js?v=animation-v1';
import { normalizePixelAvatarConfig } from './AvatarConfig.js';

const registry = new Map([['default', { id: 'default', name: 'Default / Placeholder', modelPath: null, thumbnail: null, animations: {} }]]);

export function registerAvatar(definition) {
  if (!definition?.id || !definition?.name || !definition?.modelPath) throw new Error('Definizione avatar incompleta');
  registry.set(definition.id, { thumbnail: null, animations: {}, ...definition });
}

function placeholder(remote) {
  const object = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.92, 4, 10), new THREE.MeshStandardMaterial({ color: remote ? 0xf3b96d : 0x67d8bd, roughness: 0.65 }));
  body.position.y = 0.9;
  object.add(body);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.055), new THREE.MeshStandardMaterial({ color: 0x173448 }));
  front.position.set(0, 1.16, -0.38);
  object.add(front);
  return object;
}

// Imported GLB avatars may provide their own clips. Keep pose selection separate
// from movement so an avatar without a matching clip remains fully playable.
export function createClipAnimator(mixer, clips) {
  const named = clips.map((clip) => ({ clip, name: clip.name.toLowerCase() }));
  const matches = (patterns) => named.find(({ name }) => patterns.some((pattern) => pattern.test(name)))?.clip;
  const idle = matches([/idle/, /breath/, /stand/]) || clips[0];
  const walk = matches([/walk/]);
  const run = matches([/run/, /sprint/]);
  const jump = matches([/jump/, /fall/]);
  const hang = matches([/hang/, /ledge.?idle/, /cling/]);
  const grab = matches([/ledge.?grab/, /wall.?grab/, /catch/]);
  const climb = matches([/wall.?climb/, /climbing/, /ladder/, /climb/]);
  const shimmy = matches([/shimmy/, /ledge.?move/]);
  const mantle = matches([/mantle/, /climb.?up/, /pull.?up/, /vault/]);
  let current = null;
  return (delta, state) => {
    const clip = state === 'Running' ? run || walk || idle
      : state === 'Walking' ? walk || idle
        : state === 'Jumping' ? jump || idle
          : state === 'LEDGE_GRAB' || state === 'FALLBACK_GRAB' ? grab || hang || climb || idle
            : state === 'HANGING' ? hang || climb || idle
              : state === 'SHIMMY' ? shimmy || hang || climb || idle
                : state === 'FALLBACK_CLIMB' ? climb || hang || idle
                  : state === 'CLIMB_UP' ? mantle || climb || idle : idle;
    if (clip !== current) {
      const previous = current && mixer.existingAction(current);
      const action = mixer.clipAction(clip);
      const oneShot = state === 'CLIMB_UP' && clip === mantle;
      action.reset().setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
      action.clampWhenFinished = state === 'CLIMB_UP' && clip === mantle;
      if (previous) action.fadeIn(0.16);
      action.play();
      previous?.fadeOut(0.16);
      current = clip;
    }
    mixer.update(delta);
  };
}

export class AvatarManager {
  constructor(storage = null) { this.storage = storage; }
  setStorage(storage) { this.storage = storage; }

  selectionKey(selection = 'default') {
    if (typeof selection === 'string') return selection;
    if (selection?.type === 'local') return `local:${selection.file?.name || 'file'}:${selection.file?.size || 0}`;
    if (selection?.type === 'pixel') return `pixel:${JSON.stringify(normalizePixelAvatarConfig(selection.config))}`;
    return JSON.stringify(selection || 'default');
  }

  async create(selection = 'default', remote = false, onProgress) {
    const reference = typeof selection === 'string'
      ? selection
      : selection?.type === 'local'
        ? 'local'
        : selection?.type === 'pixel'
          ? 'pixel'
          : 'default';

    let source = null;
    let networkAvatarId = reference;

    try {
      if (reference === 'pixel') {
        const pixel = createPixelAvatar(typeof selection === 'object' ? selection.config : undefined);
        return {
          object: pixel.object,
          mixer: null,
          clips: [],
          update: pixel.update,
          avatarId: 'pixel',
          networkAvatarId: 'pixel',
          avatarConfig: pixel.config,
          selectionKey: this.selectionKey({ type: 'pixel', config: pixel.config }),
          sharedResources: true,
          metrics: pixel.metrics || null,
        };
      }

      if (reference === 'local') {
        source = selection.file;
        networkAvatarId = 'default';
      } else if (reference.startsWith('published:')) {
        if (!this.storage) throw new Error('Storage avatar non disponibile.');
        const id = reference.slice('published:'.length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Riferimento avatar non valido.');
        const avatar = await this.storage.avatarById(id);
        source = avatar.asset_url || await this.storage.signedUrl('free-roam-avatars', avatar.storage_path);
      } else if (registry.has(reference) && registry.get(reference).modelPath) {
        source = assetUrl(registry.get(reference).modelPath);
      }

      if (source) {
        const gltf = await loadGLB(source, onProgress);
        const mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
        return {
          object: gltf.scene,
          mixer,
          clips: gltf.animations,
          update: mixer ? createClipAnimator(mixer, gltf.animations) : null,
          avatarId: reference,
          networkAvatarId,
          avatarConfig: null,
          selectionKey: this.selectionKey(selection),
          sharedResources: false,
        };
      }

      if (reference !== 'default') throw new Error('Avatar sconosciuto.');
    } catch (error) {
      console.warn('[Free Roam] Avatar non caricato; uso placeholder:', error);
      return {
        object: placeholder(remote),
        mixer: null,
        clips: [],
        avatarId: 'default',
        networkAvatarId: 'default',
        avatarConfig: null,
        selectionKey: 'default',
        sharedResources: false,
        warning: `Avatar non caricato: ${error.message || error}. Usato il placeholder.`,
      };
    }

    return {
      object: placeholder(remote),
      mixer: null,
      clips: [],
      avatarId: 'default',
      networkAvatarId: 'default',
      avatarConfig: null,
      selectionKey: 'default',
      sharedResources: false,
    };
  }

  disposeVisual(visual) {
    visual?.mixer?.stopAllAction();
    if (!visual?.object || visual.sharedResources) return;
    visual.object.traverse((node) => {
      node.geometry?.dispose();
      if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose());
      else node.material?.dispose();
    });
  }
}
