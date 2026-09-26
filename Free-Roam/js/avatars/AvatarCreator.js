import * as THREE from 'three';
import {
  DEFAULT_PIXEL_AVATAR,
  PIXEL_AVATAR_OPTIONS,
  createPixelAvatar,
  normalizePixelAvatarConfig,
  pixelAvatarLabel,
} from './PixelAvatarRenderer.js';

const ORDER = ['skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoesColor'];

export class AvatarCreator {
  constructor(root, onSave = async () => {}) {
    this.root = root;
    this.onSave = onSave;
    this.config = normalizePixelAvatarConfig(DEFAULT_PIXEL_AVATAR);
    this.previewVisual = null;
    this.dragPointer = null;
    this.lastX = 0;
    this.raf = 0;

    this.preview = root?.querySelector('#avatar-preview');
    this.saveButton = root?.querySelector('#avatar-save');
    this.closeButton = root?.querySelector('#avatar-close');

    if (!root || !this.preview) return;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    this.camera.position.set(0, 1.45, 5.6);
    this.camera.lookAt(0, 1.15, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.preview.append(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x24364b, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    root.querySelectorAll('[data-avatar-prev],[data-avatar-next]').forEach((button) => {
      button.addEventListener('click', () => this.cycle(button.dataset.avatarPrev || button.dataset.avatarNext, button.hasAttribute('data-avatar-next') ? 1 : -1));
    });

    this.closeButton?.addEventListener('click', () => this.close());
    root.querySelector('[data-avatar-backdrop]')?.addEventListener('click', () => this.close());

    this.saveButton?.addEventListener('click', async () => {
      if (this.saveButton.disabled) return;
      this.saveButton.disabled = true;
      this.saveButton.textContent = 'SALVATAGGIO…';
      try {
        await this.onSave({ ...this.config });
        this.close();
      } finally {
        this.saveButton.disabled = false;
        this.saveButton.textContent = 'SALVA AVATAR';
      }
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (this.dragPointer !== null) return;
      this.dragPointer = event.pointerId;
      this.lastX = event.clientX;
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.dragPointer || !this.previewVisual) return;
      this.previewVisual.object.rotation.y += (event.clientX - this.lastX) * 0.012;
      this.lastX = event.clientX;
    });
    const end = (event) => { if (event.pointerId === this.dragPointer) this.dragPointer = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.preview);
  }

  cycle(key, direction) {
    if (!ORDER.includes(key)) return;
    const options = PIXEL_AVATAR_OPTIONS[key];
    const current = options.findIndex((item) => item.id === this.config[key]);
    const next = (current + direction + options.length) % options.length;
    this.config = normalizePixelAvatarConfig({ ...this.config, [key]: options[next].id });
    this.refresh();
  }

  open(config) {
    this.config = normalizePixelAvatarConfig(config);
    this.root.hidden = false;
    this.refresh();
    this.resize();
    this.render();
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  refresh() {
    for (const key of ORDER) {
      const label = this.root.querySelector(`[data-avatar-value="${key}"]`);
      if (label) label.textContent = pixelAvatarLabel(key, this.config[key]);
    }

    if (this.previewVisual) this.scene.remove(this.previewVisual.object);
    this.previewVisual = createPixelAvatar(this.config);
    this.previewVisual.object.rotation.y = 0.18;
    this.scene.add(this.previewVisual.object);
  }

  resize() {
    if (!this.renderer || !this.preview) return;
    const width = Math.max(1, this.preview.clientWidth);
    const height = Math.max(1, this.preview.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render() {
    if (this.root.hidden || !this.renderer) return;
    this.previewVisual?.update(1 / 60, 'Idle');
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.render());
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
