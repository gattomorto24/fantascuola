import * as THREE from 'three';
import { Player } from './Player.js';

export class RemotePlayer extends Player {
  constructor(scene, avatars, id, config) {
    super(scene, avatars, true);
    this.id = id;
    this.config = config;
    this.targetPosition = new THREE.Vector3();
    this.targetRotation = 0;
    this.hasSnapshot = false;
    this.lastSeen = performance.now();
    this.avatarRequestKey = '';
  }

  applySnapshot(snapshot) {
    this.targetPosition.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    this.targetRotation = snapshot.rotation;
    this.movementState = snapshot.movementState;
    this.setName(snapshot.displayName);
    this.lastSeen = performance.now();

    if (!this.hasSnapshot) {
      this.root.position.copy(this.targetPosition);
      this.root.rotation.y = this.targetRotation;
      this.hasSnapshot = true;
    }

    const selection = snapshot.avatarId === 'pixel'
      ? { type: 'pixel', config: snapshot.avatarConfig }
      : snapshot.avatarId;
    const requestKey = this.avatars.selectionKey(selection);

    if (requestKey !== this.avatarRequestKey) {
      this.avatarRequestKey = requestKey;
      this.setAvatar(selection).catch((error) => console.warn('[Free Roam] Avatar remoto:', error));
    }
  }

  update(delta) {
    if (!this.hasSnapshot) return;
    const alpha = 1 - Math.exp(-this.config.interpolation * delta);
    this.root.position.lerp(this.targetPosition, alpha);
    const diff = Math.atan2(Math.sin(this.targetRotation - this.root.rotation.y), Math.cos(this.targetRotation - this.root.rotation.y));
    this.root.rotation.y += diff * alpha;
    this.updateVisual(delta);
  }
}
