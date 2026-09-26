import * as THREE from 'three';

export const PIXEL_AVATAR_OPTIONS = Object.freeze({
  skinTone: Object.freeze([
    { id: 'light', label: 'Chiara', color: 0xf1c7a5 },
    { id: 'medium', label: 'Media', color: 0xd9a078 },
    { id: 'amber', label: 'Ambrata', color: 0xb8734f },
    { id: 'dark', label: 'Scura', color: 0x70452f },
  ]),
  hairColor: Object.freeze([
    { id: 'blonde', label: 'Biondo', color: 0xd9b760 },
    { id: 'light-brown', label: 'Castano chiaro', color: 0x9a673f },
    { id: 'brown', label: 'Castano', color: 0x5d3827 },
    { id: 'black', label: 'Nero', color: 0x18191c },
  ]),
  shirtColor: Object.freeze([
    { id: 'red', label: 'Rosso', color: 0xd83a45 },
    { id: 'yellow', label: 'Giallo', color: 0xe4b72e },
    { id: 'blue', label: 'Blu', color: 0x2877d7 },
  ]),
  pantsColor: Object.freeze([
    { id: 'red', label: 'Rosso', color: 0xb52d38 },
    { id: 'yellow', label: 'Giallo', color: 0xc99a1d },
    { id: 'blue', label: 'Blu', color: 0x245ca8 },
  ]),
  shoesColor: Object.freeze([
    { id: 'black', label: 'Nere', color: 0x17191e },
    { id: 'white', label: 'Bianche', color: 0xf1f3f5 },
  ]),
});

export const DEFAULT_PIXEL_AVATAR = Object.freeze({
  version: 1,
  type: 'pixel',
  skinTone: 'medium',
  hairStyle: 'basic',
  hairColor: 'brown',
  shirtColor: 'blue',
  pantsColor: 'red',
  shoesColor: 'white',
});

const geometries = new Map();
const materials = new Map();

function option(group, id) {
  return PIXEL_AVATAR_OPTIONS[group].find((item) => item.id === id) || PIXEL_AVATAR_OPTIONS[group][0];
}

export function normalizePixelAvatarConfig(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const safeId = (group, id, fallback) => PIXEL_AVATAR_OPTIONS[group].some((item) => item.id === id) ? id : fallback;
  return {
    version: 1,
    type: 'pixel',
    skinTone: safeId('skinTone', input.skinTone, DEFAULT_PIXEL_AVATAR.skinTone),
    hairStyle: 'basic',
    hairColor: safeId('hairColor', input.hairColor, DEFAULT_PIXEL_AVATAR.hairColor),
    shirtColor: safeId('shirtColor', input.shirtColor, DEFAULT_PIXEL_AVATAR.shirtColor),
    pantsColor: safeId('pantsColor', input.pantsColor, DEFAULT_PIXEL_AVATAR.pantsColor),
    shoesColor: safeId('shoesColor', input.shoesColor, DEFAULT_PIXEL_AVATAR.shoesColor),
  };
}

export function isPixelAvatarConfig(value) {
  if (!value || typeof value !== 'object' || value.type !== 'pixel' || value.version !== 1) return false;
  const normalized = normalizePixelAvatarConfig(value);
  return ['skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoesColor']
    .every((key) => normalized[key] === value[key]);
}

export function pixelAvatarLabel(group, id) {
  return option(group, id).label;
}

function geometry(w, h, d) {
  const key = `${w}:${h}:${d}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
  return geometries.get(key);
}

function material(color) {
  const key = String(color);
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.02,
    }));
  }
  return materials.get(key);
}

function box(parent, name, size, position, color) {
  const mesh = new THREE.Mesh(geometry(...size), material(color));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.sharedAvatarResource = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent, name, position) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

export function createPixelAvatar(configInput = DEFAULT_PIXEL_AVATAR) {
  const config = normalizePixelAvatarConfig(configInput);
  const skin = option('skinTone', config.skinTone).color;
  const hair = option('hairColor', config.hairColor).color;
  const shirt = option('shirtColor', config.shirtColor).color;
  const pants = option('pantsColor', config.pantsColor).color;
  const shoes = option('shoesColor', config.shoesColor).color;

  const root = new THREE.Group();
  root.name = 'PixelAvatar';
  root.userData.sharedAvatarResources = true;

  const body = pivot(root, 'body', [0, 0, 0]);
  const torso = pivot(body, 'torsoPivot', [0, 1.22, 0]);
  box(torso, 'torso', [0.66, 0.58, 0.34], [0, 0.17, 0], shirt);
  box(torso, 'shirtHem', [0.7, 0.12, 0.37], [0, -0.15, 0], shirt);
  box(body, 'pelvis', [0.58, 0.24, 0.34], [0, 0.96, 0], pants);
  box(body, 'neck', [0.18, 0.13, 0.18], [0, 1.68, 0], skin);

  const head = pivot(body, 'headPivot', [0, 1.93, 0]);
  box(head, 'head', [0.5, 0.48, 0.46], [0, 0, 0], skin);
  box(head, 'leftEar', [0.07, 0.16, 0.12], [-0.285, 0, 0], skin);
  box(head, 'rightEar', [0.07, 0.16, 0.12], [0.285, 0, 0], skin);
  box(head, 'nose', [0.07, 0.08, 0.055], [0, -0.015, -0.255], skin);
  box(head, 'leftEye', [0.065, 0.055, 0.03], [-0.115, 0.075, -0.247], 0x111216);
  box(head, 'rightEye', [0.065, 0.055, 0.03], [0.115, 0.075, -0.247], 0x111216);
  box(head, 'mouth', [0.11, 0.025, 0.024], [0, -0.105, -0.247], 0x5a2f2b);

  box(head, 'hairTop', [0.53, 0.12, 0.49], [0, 0.27, 0.015], hair);
  box(head, 'hairBack', [0.52, 0.29, 0.09], [0, 0.13, 0.255], hair);
  box(head, 'hairLeft', [0.09, 0.26, 0.4], [-0.255, 0.12, 0.03], hair);
  box(head, 'hairRight', [0.09, 0.26, 0.4], [0.255, 0.12, 0.03], hair);
  box(head, 'fringeA', [0.16, 0.10, 0.06], [-0.12, 0.205, -0.245], hair);
  box(head, 'fringeB', [0.18, 0.075, 0.06], [0.07, 0.225, -0.245], hair);

  const leftArm = pivot(body, 'leftArmPivot', [-0.43, 1.56, 0]);
  box(leftArm, 'leftUpperArm', [0.20, 0.37, 0.24], [0, -0.18, 0], shirt);
  const leftForearm = pivot(leftArm, 'leftForearmPivot', [0, -0.37, 0]);
  box(leftForearm, 'leftForearm', [0.18, 0.32, 0.20], [0, -0.16, 0], skin);
  box(leftForearm, 'leftHand', [0.19, 0.16, 0.20], [0, -0.39, -0.005], skin);

  const rightArm = pivot(body, 'rightArmPivot', [0.43, 1.56, 0]);
  box(rightArm, 'rightUpperArm', [0.20, 0.37, 0.24], [0, -0.18, 0], shirt);
  const rightForearm = pivot(rightArm, 'rightForearmPivot', [0, -0.37, 0]);
  box(rightForearm, 'rightForearm', [0.18, 0.32, 0.20], [0, -0.16, 0], skin);
  box(rightForearm, 'rightHand', [0.19, 0.16, 0.20], [0, -0.39, -0.005], skin);

  const leftLeg = pivot(body, 'leftLegPivot', [-0.19, 0.91, 0]);
  box(leftLeg, 'leftThigh', [0.25, 0.43, 0.3], [0, -0.215, 0], pants);
  const leftShin = pivot(leftLeg, 'leftShinPivot', [0, -0.43, 0]);
  box(leftShin, 'leftShin', [0.23, 0.39, 0.27], [0, -0.195, 0], pants);
  box(leftShin, 'leftShoe', [0.25, 0.16, 0.38], [0, -0.43, -0.055], shoes);

  const rightLeg = pivot(body, 'rightLegPivot', [0.19, 0.91, 0]);
  box(rightLeg, 'rightThigh', [0.25, 0.43, 0.3], [0, -0.215, 0], pants);
  const rightShin = pivot(rightLeg, 'rightShinPivot', [0, -0.43, 0]);
  box(rightShin, 'rightShin', [0.23, 0.39, 0.27], [0, -0.195, 0], pants);
  box(rightShin, 'rightShoe', [0.25, 0.16, 0.38], [0, -0.43, -0.055], shoes);

  const parts = { root, body, torso, head, leftArm, rightArm, leftForearm, rightForearm, leftLeg, rightLeg, leftShin, rightShin };
  let phase = 0;

  const update = (delta, state = 'Idle') => {
    const running = state === 'Running';
    const walking = state === 'Walking';
    const jumping = state === 'Jumping';
    const moving = running || walking;
    const rate = running ? 12 : walking ? 7.8 : 2;
    phase += delta * rate;

    let armSwing = 0;
    let legSwing = 0;
    if (moving) {
      const amount = running ? 0.82 : 0.52;
      legSwing = Math.sin(phase) * amount;
      armSwing = Math.sin(phase) * amount * 0.82;
    }

    leftArm.rotation.x = jumping ? -0.55 : armSwing;
    rightArm.rotation.x = jumping ? -0.55 : -armSwing;
    leftLeg.rotation.x = jumping ? 0.28 : -legSwing;
    rightLeg.rotation.x = jumping ? 0.28 : legSwing;
    leftShin.rotation.x = moving ? Math.max(0, Math.sin(phase + Math.PI) * 0.34) : 0;
    rightShin.rotation.x = moving ? Math.max(0, Math.sin(phase) * 0.34) : 0;
    leftForearm.rotation.x = moving ? -0.08 : 0;
    rightForearm.rotation.x = moving ? -0.08 : 0;

    torso.rotation.z = moving ? Math.sin(phase * 0.5) * (running ? 0.035 : 0.018) : 0;
    head.rotation.y = moving ? Math.sin(phase * 0.5) * 0.025 : Math.sin(phase * 0.25) * 0.035;
    body.position.y = jumping ? 0 : Math.sin(phase * 0.5) * (moving ? 0.012 : 0.006);
  };

  return { object: root, update, config, parts, sharedResources: true };
}
