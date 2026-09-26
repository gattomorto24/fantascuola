import * as THREE from 'three';
import { cleanDisplayName } from '../utils/text.js';

export class NameTag {
  constructor(root) { this.root = root; this.name = ''; this.sprite = null; }
  setName(value) {
    const name = cleanDisplayName(value) || 'Giocatore';
    if (name === this.name) return;
    this.dispose(); this.name = name;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(13, 31, 48, .85)'; context.beginPath(); context.roundRect(8, 16, 496, 96, 26); context.fill();
    context.fillStyle = '#f5fbff'; context.font = '700 40px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(name, 256, 65, 450);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(material); this.sprite.position.y = 2.5; this.sprite.scale.set(1.9, 0.475, 1); this.root.add(this.sprite);
  }
  dispose() {
    if (!this.sprite) return;
    this.root.remove(this.sprite); this.sprite.material.map.dispose(); this.sprite.material.dispose(); this.sprite = null;
  }
}
