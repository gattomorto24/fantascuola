import * as THREE from 'three';
import { NameTag } from './NameTag.js';
export class Player {
  constructor(scene, avatars, remote = false) {
    this.scene = scene; this.avatars = avatars; this.remote = remote;
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.avatarId = 'default'; this.visualAvatarId = 'default'; this.movementState = 'Idle'; this.visual = null;
    this.nameTag = new NameTag(this.root);
  }
  setName(name) { this.nameTag.setName(name); }
  async setAvatar(selection, onProgress) {
    const requested = selection || 'default';
    if (this.visual && typeof requested === 'string' && this.visualAvatarId === requested) return this.visual;
    const token = this.avatarToken = (this.avatarToken || 0) + 1;
    const visual = await this.avatars.create(requested, this.remote, onProgress);
    if (token !== this.avatarToken) { this.avatars.disposeVisual(visual); return; }
    if (this.visual) { this.root.remove(this.visual.object); this.avatars.disposeVisual(this.visual); }
    this.visual = visual; this.visualAvatarId = visual.avatarId; this.avatarId = visual.networkAvatarId; this.root.add(visual.object);
    return visual;
  }
  updateVisual(delta) { this.visual?.mixer?.update(delta); }
  dispose() { this.avatarToken = (this.avatarToken || 0) + 1; this.scene.remove(this.root); this.nameTag.dispose(); this.avatars.disposeVisual(this.visual); }
}
