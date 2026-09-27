import * as THREE from 'three';
import { NameTag } from './NameTag.js';
import { settings } from '../config/settings.js';
import { Pistol } from './Pistol.js?v=health-v1';

export class Player {
  constructor(scene, avatars, remote = false) {
    this.scene = scene;
    this.avatars = avatars;
    this.remote = remote;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.weapon = new Pistol(scene, this.root);
    this.health = 100;
    this.inVehicle = false;
    this.avatarId = 'default';
    this.avatarConfig = null;
    this.visualAvatarId = 'default';
    this.movementState = 'Idle';
    this.visual = null;
    this.avatarSelectionKey = '';
    this.nameTag = new NameTag(this.root);
  }

  setName(name) { this.nameTag.setName(name); }

  async setAvatar(selection, onProgress) {
    const requested = selection || 'default';
    const requestedKey = this.avatars.selectionKey(requested);
    if (this.visual && this.avatarSelectionKey === requestedKey) return this.visual;

    const token = this.avatarToken = (this.avatarToken || 0) + 1;
    const visual = await this.avatars.create(requested, this.remote, onProgress);
    if (token !== this.avatarToken) {
      this.avatars.disposeVisual(visual);
      return;
    }

    if (this.visual) {
      this.root.remove(this.visual.object);
      this.avatars.disposeVisual(this.visual);
    }

    this.visual = visual;
    visual.object.scale.setScalar(settings.player.avatarScale);
    this.nameTag.setHeight(visual.metrics?.nameTagY || 1.34);
    this.visualAvatarId = visual.avatarId;
    this.avatarId = visual.networkAvatarId;
    this.avatarConfig = visual.avatarConfig || null;
    this.avatarSelectionKey = visual.selectionKey || requestedKey;
    console.debug(`[Avatar] local = ${this.avatarId}:${this.avatarSelectionKey}`);
    this.root.add(visual.object);
    visual.object.visible = !this.inVehicle;
    return visual;
  }

  setVehiclePresence(inVehicle) {
    this.inVehicle = Boolean(inVehicle);
    if (this.visual?.object) this.visual.object.visible = !this.inVehicle;
    if (this.weapon.group) this.weapon.group.visible = !this.inVehicle && this.weapon.drawn;
    this.nameTag.setHeight(this.inVehicle ? 2.3 : this.visual?.metrics?.nameTagY || 1.34);
  }

  updateVisual(delta) {
    this.visual?.mixer?.update(delta);
    this.visual?.update?.(delta, this.movementState);
    this.weapon.update(delta);
  }

  dispose() {
    this.avatarToken = (this.avatarToken || 0) + 1;
    this.scene.remove(this.root);
    this.weapon.dispose();
    this.nameTag.dispose();
    this.avatars.disposeVisual(this.visual);
  }
}
