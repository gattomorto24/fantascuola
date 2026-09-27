import * as THREE from 'three';
import { Player } from './Player.js?v=gameplay-v1';

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
    this.lastShotId = null;
  }

  applySnapshot(snapshot) {
    this.targetPosition.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    this.targetRotation = snapshot.rotation;
    this.movementState = snapshot.parkourState || snapshot.movementState;
    this.setName(snapshot.displayName);
    this.lastSeen = performance.now();
    this.weapon.setDrawn(snapshot.weaponDrawn === true);
    this.weapon.setAiming(snapshot.aiming === true);
    this.setVehiclePresence(Boolean(snapshot.vehicleId));
    this.health = Number.isFinite(snapshot.health) ? snapshot.health : 100;
    this.root.visible = this.health > 0;
    if (this.lastShotId !== null && snapshot.shotId !== this.lastShotId && snapshot.shotTarget) {
      this.weapon.fireTo(snapshot.shotTarget);
    }
    this.lastShotId = snapshot.shotId ?? 0;

    if (!this.hasSnapshot) {
      this.root.position.copy(this.targetPosition);
      this.root.rotation.y = this.targetRotation;
      this.hasSnapshot = true;
    }

    const remoteAvatar = snapshot.avatar || {
      type: snapshot.avatarId,
      version: 1,
      config: snapshot.avatarConfig,
    };
    const selection = remoteAvatar.type === 'pixel'
      ? { type: 'pixel', config: remoteAvatar.config }
      : snapshot.avatarId;
    const remoteAvatarKey = selection.type === 'pixel' ? JSON.stringify(selection.config) : snapshot.avatarId;
    console.debug(`[Avatar] remote ${snapshot.displayName} = ${selection.type}:${remoteAvatarKey}`);
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
